package app.inkwell.books;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.PlaybackParams;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * Read-aloud engine that lives outside the web view (like the Paper to Audio app):
 * it renders a few pieces ahead, plays them in order and moves on by itself, so
 * reading continues with the screen off or the app closed (kept alive by
 * ReadAloudService). Voices: Microsoft neural (online), the downloaded built-in
 * voice, or the phone's own TTS — falling back in that order when one fails.
 * State lives on the main thread; listeners are called there.
 */
public final class ReadAloudEngine {

    private ReadAloudEngine() {}

    /** How to voice the text. */
    public static final class VoiceSpec {
        public String engine = "edge"; // edge | builtin | system
        public String edgeVoice = "en-US-AndrewMultilingualNeural";
        public SherpaVoice.Spec builtin; // may be null
        public String systemEngine = "";
        public String systemVoice = "";
    }

    private static final class Piece {
        final int para;
        final String text;

        Piece(int para, String text) {
            this.para = para;
            this.text = text;
        }
    }

    private static final int LOOKAHEAD = 3;

    private static Context app;
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final CopyOnWriteArraySet<Runnable> listeners = new CopyOnWriteArraySet<>();
    // Three at a time: each Microsoft piece waits on the network, not the CPU, so
    // rendering one after another left gaps between short pieces.
    private static final ExecutorService renderer = Executors.newFixedThreadPool(3, r -> new Thread(() -> {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND);
        r.run();
    }, "kathava-read-render"));
    private static final ExecutorService waiter = Executors.newCachedThreadPool();

    private static List<Piece> pieces = new ArrayList<>();
    private static int total = 0; // paragraphs
    private static int pos = 0; // current piece
    private static int session = 0;
    private static boolean playing = false;
    private static boolean finished = false;
    private static String uid = "";
    private static String title = "";
    private static List<int[]> chapterStarts = new ArrayList<>(); // [para]
    private static List<String> chapterTitles = new ArrayList<>();
    private static float rate = 1f;
    private static VoiceSpec voice = new VoiceSpec();
    private static boolean edgeDown = false; // switched to the offline voice this session
    private static String lastError = "";
    private static String voiceNote = "";
    private static int failures = 0;

    private static final Map<Integer, Future<File>> ready = new HashMap<>();
    private static MediaPlayer player;
    private static boolean playerReady = false;

    // ---------------------------------------------------------------- state
    public static void addListener(Runnable r) {
        listeners.add(r);
    }

    public static void removeListener(Runnable r) {
        listeners.remove(r);
    }

    private static void changed() {
        for (Runnable r : listeners) r.run();
    }

    public static boolean isPlaying() {
        return playing;
    }

    public static boolean isActive() {
        return !pieces.isEmpty();
    }

    public static String uid() {
        return uid;
    }

    public static String title() {
        return title;
    }

    public static int para() {
        return pieces.isEmpty() ? 0 : pieces.get(Math.min(pos, pieces.size() - 1)).para;
    }

    public static int total() {
        return total;
    }

    public static boolean finished() {
        return finished;
    }

    public static String lastError() {
        return lastError;
    }

    public static String voiceNote() {
        return voiceNote;
    }

    public static float rate() {
        return rate;
    }

    /** Title of the chapter the current paragraph is in (for the notification). */
    public static String chapter() {
        int p = para();
        String best = "";
        for (int i = 0; i < chapterStarts.size(); i++) if (chapterStarts.get(i)[0] <= p) best = chapterTitles.get(i);
        return best;
    }

    // ---------------------------------------------------------------- control
    /** Start reading [paras] from paragraph [from]. */
    public static void start(Context ctx, String bookUid, String bookTitle, List<String> paras, int from, List<int[]> chStarts, List<String> chTitles, VoiceSpec v, float speed) {
        app = ctx.getApplicationContext();
        stopInternal(false);
        uid = bookUid == null ? "" : bookUid;
        title = bookTitle == null ? "" : bookTitle;
        chapterStarts = chStarts;
        chapterTitles = chTitles;
        voice = v;
        rate = speed > 0 ? speed : 1f;
        edgeDown = false;
        voiceNote = "";
        lastError = "";
        failures = 0;
        finished = false;
        total = paras.size();
        // Pieces of about a paragraph (Microsoft voices render long text quickly) or
        // a couple of sentences (on-device voices are slower).
        int max = "edge".equals(v.engine) ? 700 : 320;
        List<Piece> list = new ArrayList<>();
        for (int i = 0; i < paras.size(); i++) {
            String t = paras.get(i) == null ? "" : paras.get(i).trim();
            // Lines with nothing to say (a "---" divider, table bars) make the voice
            // service return no audio, which stalled the reading.
            if (t.isEmpty() || !t.matches("(?s).*[\\p{L}\\p{N}].*")) continue;
            // The very first piece is kept short (about a sentence) so the voice starts
            // within a second or two; the rest render while it plays.
            if (list.isEmpty() && i >= from && t.length() > 160) {
                List<String> first = EdgeTts.splitLong(t, 160);
                list.add(new Piece(i, first.get(0)));
                String rest = t.substring(Math.min(t.length(), t.indexOf(first.get(0)) + first.get(0).length())).trim();
                if (!rest.isEmpty()) for (String s : EdgeTts.splitLong(rest, max)) list.add(new Piece(i, s));
                continue;
            }
            for (String s : EdgeTts.splitLong(t, max)) list.add(new Piece(i, s));
        }
        pieces = list;
        pos = firstPieceOf(from);
        if (pieces.isEmpty()) {
            lastError = "Nothing to read here";
            changed();
            return;
        }
        play();
    }

    private static int firstPieceOf(int paraIndex) {
        for (int i = 0; i < pieces.size(); i++) if (pieces.get(i).para >= paraIndex) return i;
        return Math.max(0, pieces.size() - 1);
    }

    public static void play() {
        if (pieces.isEmpty()) return;
        if (finished) {
            finished = false;
            pos = 0;
        }
        playing = true;
        lastError = "";
        requestFocus();
        registerNoisy();
        ReadAloudService.start(app);
        if (player != null && playerReady) {
            try {
                applyRate(player);
                player.start();
                changed();
                return;
            } catch (Exception ignored) {
            }
        }
        playCurrent();
        changed();
    }

    public static void pause() {
        playing = false;
        if (player != null && playerReady) {
            try {
                player.pause();
            } catch (Exception ignored) {
            }
        }
        changed();
    }

    public static void toggle() {
        if (playing) pause();
        else play();
    }

    /** Jump to a paragraph (keeps playing if it was). */
    public static void seek(int paraIndex) {
        if (pieces.isEmpty()) return;
        pos = firstPieceOf(Math.max(0, paraIndex));
        finished = false;
        releasePlayer();
        trimQueue();
        if (playing) playCurrent();
        changed();
    }

    public static void next() {
        seek(para() + 1);
    }

    public static void previous() {
        seek(Math.max(0, para() - 1));
    }

    public static void setRate(float r) {
        rate = r > 0 ? r : 1f;
        if (player != null && playerReady && playing) applyRate(player);
        changed();
    }

    public static void stop() {
        stopInternal(true);
    }

    private static void stopInternal(boolean notify) {
        session++;
        playing = false;
        releasePlayer();
        synchronized (ready) {
            for (Future<File> f : ready.values()) f.cancel(true);
            ready.clear();
        }
        pieces = new ArrayList<>();
        abandonFocus();
        unregisterNoisy();
        if (app != null) {
            deleteTree(new File(app.getCacheDir(), "readaloud"));
            ReadAloudService.stop(app);
        }
        if (notify) changed();
    }

    // ---------------------------------------------------------------- playback
    private static void playCurrent() {
        if (pieces.isEmpty() || !playing) return;
        final int s = session;
        final int p = pos;
        for (int i = p; i < Math.min(pieces.size(), p + 1 + LOOKAHEAD); i++) prepare(i);
        final Future<File> f;
        synchronized (ready) {
            f = ready.get(p);
        }
        if (f == null) return;
        waiter.execute(() -> {
            File file = null;
            String err = null;
            try {
                file = f.get(3, TimeUnit.MINUTES);
            } catch (Exception e) {
                Throwable c = e.getCause() != null ? e.getCause() : e;
                err = c.getMessage() != null ? c.getMessage() : c.toString();
            }
            final File got = file;
            final String error = err;
            main.post(() -> {
                if (s != session || p != pos || !playing) return;
                if (got == null) {
                    // Skip a piece that won't render; give up if nothing works.
                    lastError = error == null ? "Couldn't read this part" : error;
                    if (++failures >= 4) {
                        playing = false;
                        changed();
                        return;
                    }
                    advance();
                    return;
                }
                startPlayer(got, s, p);
            });
        });
    }

    private static void startPlayer(File file, int s, int p) {
        releasePlayer();
        MediaPlayer mp = new MediaPlayer();
        player = mp;
        try {
            mp.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            mp.setWakeMode(app, PowerManager.PARTIAL_WAKE_LOCK);
            mp.setDataSource(file.getAbsolutePath());
            mp.setOnCompletionListener(m -> {
                if (s == session && p == pos) advance();
            });
            mp.setOnErrorListener((m, what, extra) -> {
                if (s == session && p == pos) {
                    lastError = "Couldn't play this part";
                    if (++failures >= 4) {
                        playing = false;
                        changed();
                    } else advance();
                }
                return true;
            });
            mp.prepare();
            playerReady = true;
            applyRate(mp);
            mp.start();
            failures = 0;
            if (!lastError.isEmpty()) {
                lastError = "";
                changed();
            }
        } catch (Exception e) {
            lastError = e.getMessage() == null ? "Couldn't play this part" : e.getMessage();
            if (++failures >= 4) {
                playing = false;
                changed();
            } else advance();
        }
    }

    private static void advance() {
        int before = para();
        pos++;
        if (pos >= pieces.size()) {
            pos = pieces.size() - 1;
            playing = false;
            finished = true;
            releasePlayer();
            abandonFocus();
            changed();
            return;
        }
        trimQueue();
        playCurrent();
        if (para() != before) changed();
    }

    private static void applyRate(MediaPlayer mp) {
        if (Build.VERSION.SDK_INT >= 23 && Math.abs(rate - 1f) > 0.01f) {
            try {
                PlaybackParams pp = mp.getPlaybackParams();
                mp.setPlaybackParams(pp.setSpeed(rate));
            } catch (Exception ignored) {
            }
        }
    }

    private static void releasePlayer() {
        playerReady = false;
        if (player != null) {
            try {
                player.release();
            } catch (Exception ignored) {
            }
        }
        player = null;
    }

    // ---------------------------------------------------------------- rendering
    /** Drop queued renders that are no longer near the reading position. */
    private static void trimQueue() {
        synchronized (ready) {
            Iterator<Map.Entry<Integer, Future<File>>> it = ready.entrySet().iterator();
            while (it.hasNext()) {
                Map.Entry<Integer, Future<File>> e = it.next();
                if (e.getKey() < pos || e.getKey() > pos + LOOKAHEAD) {
                    e.getValue().cancel(true);
                    it.remove();
                }
            }
        }
    }

    private static void prepare(int i) {
        synchronized (ready) {
            if (ready.containsKey(i)) return;
            final int s = session;
            final String text = pieces.get(i).text;
            ready.put(i, renderer.submit(() -> {
                if (s != session) throw new Exception("stopped");
                File dir = new File(app.getCacheDir(), "readaloud/" + s);
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                return render(text, dir, i);
            }));
        }
    }

    private static File render(String text, File dir, int i) throws Exception {
        String engine = voice.engine;
        if ("edge".equals(engine) && !edgeDown) {
            try {
                File out = new File(dir, i + ".mp3");
                byte[] mp3 = EdgeTts.synthesize(text, voice.edgeVoice, 0);
                try (FileOutputStream fo = new FileOutputStream(out)) {
                    fo.write(mp3);
                }
                return out;
            } catch (Exception e) {
                // A piece that came back silent is skipped; only a real outage
                // (no internet / service down) switches to an offline voice.
                if (String.valueOf(e.getMessage()).contains("no audio")) throw e;
                edgeDown = true;
                voiceNote = "Microsoft voices unavailable (" + e.getMessage() + ") — using an offline voice";
                main.post(ReadAloudEngine::changed);
            }
        }
        // Offline voices render one piece at a time.
        synchronized (OFFLINE_LOCK) {
            if (("builtin".equals(engine) || "edge".equals(engine)) && voice.builtin != null && SherpaVoice.installed(app, voice.builtin.id)) {
                File out = new File(dir, i + ".wav");
                SherpaVoice.render(app, voice.builtin, text, 1f, out);
                return out;
            }
            return renderSystem(text, new File(dir, i + ".wav"));
        }
    }

    private static final Object OFFLINE_LOCK = new Object();

    // ---------------------------------------------------------------- phone TTS
    private static TextToSpeech sys;
    private static String sysEngine = null;

    private static File renderSystem(String text, File out) throws Exception {
        TextToSpeech t = systemTts();
        final CountDownLatch done = new CountDownLatch(1);
        final String[] err = {null};
        final String id = "p" + System.nanoTime();
        t.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String u) {}

            @Override
            public void onDone(String u) {
                if (id.equals(u)) done.countDown();
            }

            @Override
            public void onError(String u) {
                err[0] = "The phone voice failed";
                done.countDown();
            }
        });
        Bundle params = new Bundle();
        if (t.synthesizeToFile(text, params, out, id) != TextToSpeech.SUCCESS) throw new Exception("The phone voice failed");
        if (!done.await(2, TimeUnit.MINUTES)) throw new Exception("The phone voice timed out");
        if (err[0] != null) throw new Exception(err[0]);
        return out;
    }

    private static TextToSpeech systemTts() throws Exception {
        String want = voice.systemEngine == null ? "" : voice.systemEngine;
        if (sys != null && want.equals(sysEngine)) return sys;
        if (sys != null) sys.shutdown();
        final CountDownLatch ready = new CountDownLatch(1);
        final int[] status = {TextToSpeech.ERROR};
        TextToSpeech.OnInitListener l = st -> {
            status[0] = st;
            ready.countDown();
        };
        sys = want.isEmpty() ? new TextToSpeech(app, l) : new TextToSpeech(app, l, want);
        sysEngine = want;
        if (!ready.await(20, TimeUnit.SECONDS) || status[0] != TextToSpeech.SUCCESS) throw new Exception("The phone's voice engine didn't start");
        if (voice.systemVoice != null && !voice.systemVoice.isEmpty()) {
            try {
                for (Voice v : sys.getVoices()) if (v.getName().equals(voice.systemVoice)) sys.setVoice(v);
            } catch (Exception ignored) {
            }
        } else sys.setLanguage(Locale.getDefault());
        return sys;
    }

    // ---------------------------------------------------------------- audio focus & noisy
    private static AudioFocusRequest focusRequest;
    private static final AudioManager.OnAudioFocusChangeListener focusListener = change -> main.post(() -> {
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            if (playing) pause();
        }
    });

    private static void requestFocus() {
        AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setOnAudioFocusChangeListener(focusListener)
                .build();
            am.requestAudioFocus(focusRequest);
        } else {
            am.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        }
    }

    private static void abandonFocus() {
        if (app == null) return;
        AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            if (focusRequest != null) am.abandonAudioFocusRequest(focusRequest);
        } else am.abandonAudioFocus(focusListener);
    }

    private static BroadcastReceiver noisy;

    private static void registerNoisy() {
        if (noisy != null) return;
        noisy = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                if (playing) pause(); // headphones unplugged
            }
        };
        IntentFilter f = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(noisy, f, Context.RECEIVER_NOT_EXPORTED);
        else app.registerReceiver(noisy, f);
    }

    private static void unregisterNoisy() {
        if (noisy == null || app == null) return;
        try {
            app.unregisterReceiver(noisy);
        } catch (Exception ignored) {
        }
        noisy = null;
    }

    private static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
