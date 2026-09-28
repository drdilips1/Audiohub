package app.inkwell.books;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.session.MediaSession;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * Native audiobook player (Media3 / ExoPlayer). Plays any http(s) source —
 * including plain-http LAN servers, large .m4b files and debrid links — with a
 * background service, notification and lock-screen controls.
 *
 * Events: "state", "progress", "ended", "error", "remote".
 */
@OptIn(markerClass = UnstableApi.class)
@CapacitorPlugin(name = "InkwellPlayer")
public class InkwellPlayerPlugin extends Plugin {

    private static final Map<String, String> requestHeaders = new HashMap<>();

    private final Handler main = new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    private MediaSession session;
    private boolean ticking = false;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (player == null) {
                ticking = false;
                return;
            }
            emitProgress();
            if (player.isPlaying()) {
                main.postDelayed(this, 500);
            } else {
                ticking = false;
            }
        }
    };

    // ---------------------------------------------------------------- setup

    private void ensurePlayer() {
        if (player != null) return;

        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setUserAgent("Inkwell/1.2 (Android) ExoPlayer")
            .setConnectTimeoutMs(20000)
            .setReadTimeoutMs(30000);
        DataSource.Factory upstream = new DefaultDataSource.Factory(getContext(), http);
        DataSource.Factory withHeaders = new ResolvingDataSource.Factory(upstream, dataSpec -> {
            if (requestHeaders.isEmpty()) return dataSpec;
            return dataSpec.withAdditionalHeaders(new HashMap<>(requestHeaders));
        });

        // Seek by bitrate in big MP3s without a seek table, so resuming mid-book
        // doesn't have to read the file from the start.
        DefaultExtractorsFactory extractors = new DefaultExtractorsFactory().setConstantBitrateSeekingEnabled(true).setConstantBitrateSeekingAlwaysEnabled(true);
        // Start playing after 1s of audio instead of 2.5s; speech needs little buffer.
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder().setBufferDurationsMs(15000, 60000, 1000, 2000).build();

        player = new ExoPlayer.Builder(getContext())
            .setMediaSourceFactory(new DefaultMediaSourceFactory(withHeaders, extractors))
            .setLoadControl(loadControl)
            .setAudioAttributes(
                new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(),
                true
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build();

        player.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                emitState();
                updateSleepWatch(isPlaying);
                if (isPlaying && !ticking) {
                    ticking = true;
                    main.post(tick);
                }
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                emitState();
                if (state == Player.STATE_READY) emitProgress();
                if (state == Player.STATE_ENDED) notifyListeners("ended", new JSObject());
            }

            @Override
            public void onPlaybackSuppressionReasonChanged(int reason) {
                emitState();
            }

            @Override
            public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
                emitState();
            }

            @Override
            public void onPlayerError(@NonNull PlaybackException error) {
                JSObject o = new JSObject();
                o.put("code", error.getErrorCodeName());
                o.put("message", describe(error));
                notifyListeners("error", o);
            }
        });

        // Headset / notification / lock-screen "next" and "previous" become
        // skip forward / back in the web layer (chapters are handled in-app).
        Player forwarding = new ForwardingPlayer(player) {
            @Override
            public Player.Commands getAvailableCommands() {
                return super.getAvailableCommands()
                    .buildUpon()
                    .add(Player.COMMAND_SEEK_TO_NEXT)
                    .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                    .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                    .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                    .build();
            }

            @Override
            public boolean isCommandAvailable(int command) {
                return command == Player.COMMAND_SEEK_TO_NEXT ||
                    command == Player.COMMAND_SEEK_TO_PREVIOUS ||
                    command == Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM ||
                    command == Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM ||
                    super.isCommandAvailable(command);
            }

            @Override
            public void seekToNext() {
                remote("next");
            }

            @Override
            public void seekToNextMediaItem() {
                remote("next");
            }

            @Override
            public void seekToPrevious() {
                remote("previous");
            }

            @Override
            public void seekToPreviousMediaItem() {
                remote("previous");
            }
        };

        Intent open = new Intent(getContext(), MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent activity = PendingIntent.getActivity(
            getContext(),
            0,
            open,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        session = new MediaSession.Builder(getContext(), forwarding).setSessionActivity(activity).build();
        PlaybackService.session = session;
        getContext().startService(new Intent(getContext(), PlaybackService.class));
    }

    private static String describe(PlaybackException error) {
        Throwable cause = error.getCause();
        while (cause != null) {
            if (cause instanceof HttpDataSource.InvalidResponseCodeException) {
                int code = ((HttpDataSource.InvalidResponseCodeException) cause).responseCode;
                if (code == 401 || code == 403) return "The server refused access (HTTP " + code + "). Try signing in again.";
                if (code == 404) return "The file was not found on the server (HTTP 404).";
                return "The server answered HTTP " + code + ".";
            }
            if (cause instanceof HttpDataSource.CleartextNotPermittedException) {
                return "Plain-http connections are blocked on this device.";
            }
            if (cause instanceof HttpDataSource.HttpDataSourceException) {
                return "Could not reach the server — check your connection" +
                    (cause.getMessage() != null ? " (" + cause.getMessage() + ")" : "") + ".";
            }
            cause = cause.getCause();
        }
        switch (error.errorCode) {
            case PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED:
            case PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED:
                return "This file format can't be played (" + error.getErrorCodeName() + ").";
            case PlaybackException.ERROR_CODE_DECODER_INIT_FAILED:
            case PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED:
                return "This audio codec isn't supported on this device.";
            default:
                return error.getMessage() != null ? error.getMessage() + " (" + error.getErrorCodeName() + ")" : error.getErrorCodeName();
        }
    }

    // --------------------------------------------------------------- events

    private void remote(String action) {
        JSObject o = new JSObject();
        o.put("action", action);
        notifyListeners("remote", o);
    }

    /** Last known playback position (s) and when it was read, for the transcript worker. */
    static volatile double lastPosition = 0;
    static volatile long lastPositionAt = 0;

    private JSObject snapshot() {
        JSObject o = new JSObject();
        if (player == null) return o;
        long dur = player.getDuration();
        lastPosition = player.getCurrentPosition() / 1000.0;
        lastPositionAt = System.currentTimeMillis();
        o.put("position", player.getCurrentPosition() / 1000.0);
        o.put("duration", dur == C.TIME_UNSET ? 0 : dur / 1000.0);
        o.put("buffered", player.getBufferedPosition() / 1000.0);
        o.put("playing", player.isPlaying());
        o.put("playWhenReady", player.getPlayWhenReady());
        o.put("buffering", player.getPlaybackState() == Player.STATE_BUFFERING);
        o.put("ended", player.getPlaybackState() == Player.STATE_ENDED);
        o.put("idle", player.getPlaybackState() == Player.STATE_IDLE);
        o.put("suppressed", player.getPlaybackSuppressionReason() != Player.PLAYBACK_SUPPRESSION_REASON_NONE);
        return o;
    }

    private void emitState() {
        notifyListeners("state", snapshot());
    }

    private void emitProgress() {
        notifyListeners("progress", snapshot());
    }

    // -------------------------------------------------------------- methods

    private interface PlayerAction {
        void run(PluginCall call);
    }

    private void onMain(PluginCall call, PlayerAction action) {
        main.post(() -> {
            try {
                ensurePlayer();
                action.run(call);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        });
    }

    @PluginMethod
    public void load(PluginCall call) {
        onMain(call, c -> {
            String url = c.getString("url");
            if (url == null || url.isEmpty()) {
                c.reject("Missing url");
                return;
            }
            requestHeaders.clear();
            JSObject headers = c.getObject("headers");
            if (headers != null) {
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    String v = headers.optString(k, null);
                    if (v != null) requestHeaders.put(k, v);
                }
            }
            MediaMetadata.Builder meta = new MediaMetadata.Builder()
                .setTitle(c.getString("title", ""))
                .setArtist(c.getString("artist", ""))
                .setAlbumTitle(c.getString("album", ""));
            String art = c.getString("artwork");
            if (art != null && !art.isEmpty()) meta.setArtworkUri(Uri.parse(art));

            MediaItem item = new MediaItem.Builder().setUri(url).setMediaMetadata(meta.build()).build();
            double position = c.getDouble("position", 0.0);
            player.setMediaItem(item, (long) (position * 1000));
            player.setPlaybackParameters(new PlaybackParameters(c.getFloat("rate", 1f)));
            player.setVolume(1f);
            player.prepare();
            player.setPlayWhenReady(c.getBoolean("autoplay", true));
            c.resolve();
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        onMain(call, c -> {
            if (player.getPlaybackState() == Player.STATE_IDLE) player.prepare();
            if (player.getPlaybackState() == Player.STATE_ENDED) player.seekTo(0);
            // After a call some apps never hand audio focus back; pausing and playing
            // again makes the player ask for focus afresh instead of staying silent.
            if (player.getPlayWhenReady() && player.getPlaybackSuppressionReason() != Player.PLAYBACK_SUPPRESSION_REASON_NONE) player.pause();
            player.play();
            c.resolve();
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        onMain(call, c -> {
            player.pause();
            c.resolve();
        });
    }

    @PluginMethod
    public void seek(PluginCall call) {
        onMain(call, c -> {
            player.seekTo((long) (c.getDouble("position", 0.0) * 1000));
            emitProgress();
            c.resolve();
        });
    }

    @PluginMethod
    public void setRate(PluginCall call) {
        onMain(call, c -> {
            player.setPlaybackParameters(new PlaybackParameters(c.getFloat("rate", 1f)));
            c.resolve();
        });
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        onMain(call, c -> {
            player.setVolume(c.getFloat("volume", 1f));
            c.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        onMain(call, c -> {
            player.stop();
            player.clearMediaItems();
            emitState();
            c.resolve();
        });
    }

    @PluginMethod
    public void getState(PluginCall call) {
        onMain(call, c -> c.resolve(snapshot()));
    }

    // ------------------------------------------------------------ sleep detection
    // While a book plays, watch the accelerometer. If the phone lies perfectly
    // still for the chosen time, the listener has most likely fallen asleep:
    // fade out, pause, and rewind to where the stillness began. Any movement
    // during the fade cancels it.

    private boolean sleepDetect = false;
    private long stillMs = 15 * 60_000L;
    private SensorManager sensors;
    private boolean watching = false;
    private long lastMove = 0;
    private long moveItem = -1;
    private long movePos = 0;
    private float lx, ly, lz;
    private boolean haveLast = false;
    private boolean fading = false;
    private float fadeFrom = 1f;

    private final SensorEventListener motion = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent e) {
            float x = e.values[0], y = e.values[1], z = e.values[2];
            if (haveLast) {
                float d = Math.abs(x - lx) + Math.abs(y - ly) + Math.abs(z - lz);
                // Breathing on a mattress stays well under this; picking the phone up or turning over doesn't.
                if (d > 0.9f) main.post(() -> moved());
            }
            lx = x;
            ly = y;
            lz = z;
            haveLast = true;
        }

        @Override
        public void onAccuracyChanged(Sensor s, int a) {}
    };

    private void moved() {
        lastMove = System.currentTimeMillis();
        if (player != null) {
            moveItem = player.getCurrentMediaItemIndex();
            movePos = player.getCurrentPosition();
        }
        if (fading) {
            fading = false;
            main.removeCallbacks(fadeStep);
            if (player != null) player.setVolume(fadeFrom);
        }
    }

    private final Runnable stillCheck = new Runnable() {
        @Override
        public void run() {
            if (!watching || player == null) return;
            if (!fading && player.isPlaying() && System.currentTimeMillis() - lastMove > stillMs) {
                fading = true;
                fadeFrom = player.getVolume();
                main.post(fadeStep);
            }
            main.postDelayed(this, 15_000);
        }
    };

    private int fadeTicks = 0;
    private final Runnable fadeStep = new Runnable() {
        @Override
        public void run() {
            if (!fading || player == null) return;
            fadeTicks++;
            player.setVolume(Math.max(0f, fadeFrom * (1f - fadeTicks / 20f)));
            if (fadeTicks < 20) {
                main.postDelayed(this, 1000);
                return;
            }
            fadeTicks = 0;
            fading = false;
            player.pause();
            player.setVolume(fadeFrom);
            // Back to where the phone went still (a little earlier, to catch the context).
            if (moveItem == player.getCurrentMediaItemIndex()) player.seekTo(Math.max(0, movePos - 30_000));
            JSObject d = new JSObject();
            d.put("position", player.getCurrentPosition() / 1000.0);
            d.put("minutes", stillMs / 60_000);
            notifyListeners("autosleep", d, true);
        }
    };

    private void updateSleepWatch(boolean playing) {
        boolean want = sleepDetect && playing;
        if (want == watching) return;
        if (sensors == null) sensors = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        Sensor acc = sensors == null ? null : sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        if (want && acc != null) {
            haveLast = false;
            moved();
            sensors.registerListener(motion, acc, SensorManager.SENSOR_DELAY_NORMAL);
            watching = true;
            main.postDelayed(stillCheck, 15_000);
        } else if (!want && watching) {
            sensors.unregisterListener(motion);
            watching = false;
            main.removeCallbacks(stillCheck);
            if (fading) {
                fading = false;
                main.removeCallbacks(fadeStep);
                fadeTicks = 0;
                if (player != null) player.setVolume(fadeFrom);
            }
        }
    }

    /** Turn sleep detection on/off; minutes = how long the phone must lie still. */
    @PluginMethod
    public void setSleepDetect(PluginCall call) {
        onMain(call, c -> {
            sleepDetect = Boolean.TRUE.equals(c.getBoolean("on", false));
            Double m = c.getDouble("minutes", 15.0);
            stillMs = (long) (Math.max(3.0, m == null ? 15.0 : m) * 60_000);
            updateSleepWatch(player.isPlaying());
            c.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        main.removeCallbacks(tick);
        if (watching && sensors != null) sensors.unregisterListener(motion);
        main.removeCallbacks(stillCheck);
        main.removeCallbacks(fadeStep);
        if (session != null) {
            session.release();
            session = null;
            PlaybackService.session = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
    }
}
