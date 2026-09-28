package app.inkwell.books;

import android.content.Context;
import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsKittenModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig;
import java.io.File;

/**
 * The downloaded built-in voice (sherpa-onnx), shared by the Voices plugin and
 * the read-aloud engine. One model is kept loaded; calls are serialized.
 */
public final class SherpaVoice {

    private SherpaVoice() {}

    /** Which voice package and how to load it. */
    public static final class Spec {
        public String id = "";
        public String type = "vits";
        public String model = "model.onnx";
        public String lexicon = "";
        public String lang = "";
        public int speaker = 0;
    }

    private static OfflineTts tts;
    private static String loadedId;

    public static File voicesDir(Context c) {
        File d = new File(c.getFilesDir(), "voices");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    public static boolean installed(Context c, String id) {
        return id != null && !id.isEmpty() && new File(new File(voicesDir(c), id), ".ready").exists();
    }

    private static OfflineTts load(Context c, Spec s) throws Exception {
        if (tts != null && s.id.equals(loadedId)) return tts;
        release();
        File dir = new File(voicesDir(c), s.id);
        if (!new File(dir, ".ready").exists()) throw new Exception("This voice isn't downloaded yet");
        String model = new File(dir, s.model == null || s.model.isEmpty() ? "model.onnx" : s.model).getAbsolutePath();
        String tokens = new File(dir, "tokens.txt").getAbsolutePath();
        File espeak = new File(dir, "espeak-ng-data");
        String dataDir = espeak.exists() ? espeak.getAbsolutePath() : "";

        OfflineTtsModelConfig mc = new OfflineTtsModelConfig();
        mc.setNumThreads(Math.max(2, Math.min(4, Runtime.getRuntime().availableProcessors())));
        mc.setProvider("cpu");
        mc.setDebug(false);
        if ("kokoro".equals(s.type)) {
            OfflineTtsKokoroModelConfig k = new OfflineTtsKokoroModelConfig();
            k.setModel(model);
            k.setVoices(new File(dir, "voices.bin").getAbsolutePath());
            k.setTokens(tokens);
            k.setDataDir(dataDir);
            if (s.lexicon != null && !s.lexicon.isEmpty()) {
                StringBuilder sb = new StringBuilder();
                for (String part : s.lexicon.split(",")) {
                    if (sb.length() > 0) sb.append(',');
                    sb.append(new File(dir, part.trim()).getAbsolutePath());
                }
                k.setLexicon(sb.toString());
            }
            if (s.lang != null) k.setLang(s.lang);
            mc.setKokoro(k);
        } else if ("kitten".equals(s.type)) {
            OfflineTtsKittenModelConfig k = new OfflineTtsKittenModelConfig();
            k.setModel(model);
            k.setVoices(new File(dir, "voices.bin").getAbsolutePath());
            k.setTokens(tokens);
            k.setDataDir(dataDir);
            mc.setKitten(k);
        } else {
            OfflineTtsVitsModelConfig v = new OfflineTtsVitsModelConfig();
            v.setModel(model);
            v.setTokens(tokens);
            v.setDataDir(dataDir);
            mc.setVits(v);
        }
        OfflineTtsConfig cfg = new OfflineTtsConfig();
        cfg.setModel(mc);
        cfg.setMaxNumSentences(2);
        tts = new OfflineTts(null, cfg);
        loadedId = s.id;
        return tts;
    }

    /** Render text to a WAV file; returns its length in seconds. */
    public static synchronized double render(Context c, Spec s, String text, float speed, File out) throws Exception {
        OfflineTts t = load(c, s);
        File parent = out.getParentFile();
        //noinspection ResultOfMethodCallIgnored
        if (parent != null) parent.mkdirs();
        GeneratedAudio audio = t.generate(text, s.speaker, speed);
        if (audio.getSamples().length == 0) throw new Exception("The voice produced no audio for this text");
        File tmp = new File(out.getAbsolutePath() + ".tmp");
        if (!audio.save(tmp.getAbsolutePath())) throw new Exception("Could not save the audio file");
        //noinspection ResultOfMethodCallIgnored
        tmp.renameTo(out);
        return audio.getSamples().length / (double) audio.getSampleRate();
    }

    /** Free the model (e.g. before deleting its files). */
    public static synchronized void release() {
        if (tts != null) tts.release();
        tts = null;
        loadedId = null;
    }

    public static synchronized void releaseIf(String id) {
        if (id != null && id.equals(loadedId)) release();
    }
}
