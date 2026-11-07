package app.inkwell.books;

import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaLibraryService;
import androidx.media3.session.MediaSession;

/**
 * Keeps audiobook playback alive in the background and owns the media
 * notification / lock-screen controls. The player and session are created by
 * {@link InkwellPlayerPlugin}; this service only publishes the session.
 *
 * A library service, so Android Auto can show the app ({@link CarLibrary}). When the car opens
 * it with the app closed (no player yet), the service makes a small one of its own for
 * downloaded books; it steps aside as soon as the app starts its player.
 */
@OptIn(markerClass = UnstableApi.class)
public class PlaybackService extends MediaLibraryService {

    @Nullable
    static MediaLibrarySession session;
    @Nullable
    private static PlaybackService running;
    // The car-only player (the app closed), and its session.
    @Nullable
    private static ExoPlayer ownPlayer;
    @Nullable
    private static MediaLibrarySession ownSession;
    private final Handler main = new Handler(Looper.getMainLooper());

    // While a downloaded book plays from the car without the app: note where it is, for the app.
    private final Runnable keepPlace = new Runnable() {
        @Override
        public void run() {
            savePlace();
            if (ownPlayer != null && ownPlayer.isPlaying()) main.postDelayed(this, 15000);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        running = this;
        if (session != null) {
            addSession(session);
        }
    }

    @Nullable
    @Override
    public MediaLibrarySession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        // The app is running: its own player serves the car. Else (app closed) a car-only one.
        if (session == null && !InkwellPlayerPlugin.ensureForCar()) makeOwn();
        return session;
    }

    private void makeOwn() {
        ownPlayer = new ExoPlayer.Builder(this)
            .setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .build();
        ownPlayer.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                savePlace();
                if (isPlaying) main.postDelayed(keepPlace, 15000);
            }
        });
        ownSession = new MediaLibrarySession.Builder(this, ownPlayer, new CarLibrary(this)).build();
        session = ownSession;
    }

    private static void savePlace() {
        ExoPlayer p = ownPlayer;
        PlaybackService s = running;
        if (p == null || s == null || CarLibrary.carBook == null || p.getMediaItemCount() == 0) return;
        CarCatalog.saveProgress(s, CarLibrary.carBook, p.getCurrentMediaItemIndex(), p.getCurrentPosition() / 1000.0);
    }

    /** The app started its own player: the car-only one stops and lets go. */
    static void useAppSession(MediaLibrarySession appSession) {
        PlaybackService s = running;
        if (ownSession != null) {
            savePlace();
            if (s != null) s.removeSession(ownSession);
            ownSession.release();
            ownSession = null;
        }
        if (ownPlayer != null) {
            ownPlayer.release();
            ownPlayer = null;
        }
        CarLibrary.carBook = null;
        session = appSession;
        if (s != null && appSession != null) s.addSession(appSession);
    }

    @Override
    public void onDestroy() {
        savePlace();
        if (ownSession != null) {
            ownSession.release();
            ownSession = null;
            if (session != null && session.getPlayer() == ownPlayer) session = null;
        }
        if (ownPlayer != null) {
            ownPlayer.release();
            ownPlayer = null;
        }
        running = null;
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        MediaSession s = session;
        if (s == null) {
            stopSelf();
            return;
        }
        Player p = s.getPlayer();
        if (!p.getPlayWhenReady() || p.getMediaItemCount() == 0 || p.getPlaybackState() == Player.STATE_ENDED) {
            stopSelf();
        }
    }
}
