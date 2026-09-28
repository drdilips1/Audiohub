package app.inkwell.books;

import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.k2fsa.sherpa.onnx.FeatureConfig;
import com.k2fsa.sherpa.onnx.OfflineModelConfig;
import com.k2fsa.sherpa.onnx.OfflineMoonshineModelConfig;
import com.k2fsa.sherpa.onnx.OfflineRecognizer;
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig;
import com.k2fsa.sherpa.onnx.OfflineStream;
import com.k2fsa.sherpa.onnx.OfflineWhisperModelConfig;
import com.k2fsa.sherpa.onnx.SileroVadModelConfig;
import com.k2fsa.sherpa.onnx.SpeechSegment;
import com.k2fsa.sherpa.onnx.Vad;
import com.k2fsa.sherpa.onnx.VadModelConfig;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Live transcript for audiobooks: decodes the audio stream (independently of
 * the player), finds speech with Silero VAD and transcribes each stretch with an
 * offline sherpa-onnx recognizer (Moonshine for English, Whisper for Hindi and
 * other languages). Runs on the phone, a little ahead of what's playing, and
 * emits "segment" events { job, start, end, text } in seconds of the track.
 */
@CapacitorPlugin(name = "InkwellTranscribe")
public class InkwellTranscribePlugin extends Plugin {

    private static final int SR = 16000;
    private static final String VAD_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx";

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile String currentJob = null;
    private volatile double playPos = 0;
    private OfflineRecognizer recognizer;
    private String loadedModel = null;

    private File modelsDir() {
        // Models are unpacked by InkwellVoices.download into files/voices/<id>.
        return new File(getContext().getFilesDir(), "voices");
    }

    @PluginMethod
    public void start(PluginCall call) {
        String job = call.getString("job", "");
        String url = call.getString("url");
        String model = call.getString("model", "");
        String type = call.getString("type", "moonshine");
        String language = call.getString("language", "en");
        double startSec = call.getDouble("start", 0.0);
        double ahead = call.getDouble("ahead", 90.0);
        JSObject hdrs = call.getObject("headers", new JSObject());
        if (url == null || model.isEmpty()) {
            call.reject("Missing url or model");
            return;
        }
        Map<String, String> headers = new HashMap<>();
        Iterator<String> keys = hdrs.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            headers.put(k, hdrs.optString(k, ""));
        }
        currentJob = job;
        playPos = startSec;
        call.resolve();
        worker.execute(() -> run(job, url, headers, model, type, language, startSec, ahead));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        currentJob = null;
        call.resolve();
    }

    /** Current playback position, so decoding stays only a little ahead of it. */
    @PluginMethod
    public void position(PluginCall call) {
        playPos = call.getDouble("pos", playPos);
        call.resolve();
    }

    @PluginMethod
    public void release(PluginCall call) {
        currentJob = null;
        worker.execute(() -> {
            if (recognizer != null) {
                recognizer.release();
                recognizer = null;
                loadedModel = null;
            }
            call.resolve();
        });
    }

    // ---------------------------------------------------------------- worker

    private double currentPos() {
        double p = playPos;
        if (System.currentTimeMillis() - InkwellPlayerPlugin.lastPositionAt < 5000) p = InkwellPlayerPlugin.lastPosition;
        return p;
    }

    private boolean alive(String job) {
        return job.equals(currentJob);
    }

    private void status(String job, String state, String message) {
        JSObject o = new JSObject();
        o.put("job", job);
        o.put("state", state);
        if (message != null) o.put("message", message);
        notifyListeners("status", o);
    }

    private void run(String job, String url, Map<String, String> headers, String model, String type, String language, double startSec, double ahead) {
        if (!alive(job)) return;
        MediaExtractor ex = new MediaExtractor();
        MediaCodec codec = null;
        Vad vad = null;
        try {
            status(job, "loading", null);
            OfflineRecognizer rec = recognizer(model, type, language);
            vad = new Vad(null, vadConfig());
            if (!alive(job)) return;

            if (url.startsWith("http")) ex.setDataSource(url, headers);
            else ex.setDataSource(getContext(), Uri.parse(url), null);
            int track = -1;
            MediaFormat fmt = null;
            for (int i = 0; i < ex.getTrackCount(); i++) {
                MediaFormat f = ex.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    track = i;
                    fmt = f;
                    break;
                }
            }
            if (track < 0) throw new Exception("No audio track in this file");
            ex.selectTrack(track);
            if (startSec > 0) ex.seekTo((long) (startSec * 1e6), MediaExtractor.SEEK_TO_PREVIOUS_SYNC);

            codec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME));
            codec.configure(fmt, null, null, 0);
            codec.start();
            status(job, "running", null);

            int inRate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            int channels = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            boolean floatPcm = false;
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean inputDone = false;
            boolean outputDone = false;
            double base = -1; // track time (s) of the first 16 kHz sample fed to the VAD
            long fed = 0; // 16 kHz samples fed so far
            Resampler rs = new Resampler(inRate);
            float[] window = new float[512];
            int wn = 0;

            while (!outputDone && alive(job)) {
                // Stay a bounded distance ahead of playback. The app's screen may be
                // closed, so also read the position straight from the player.
                while (alive(job) && base >= 0 && base + fed / (double) SR > currentPos() + ahead) {
                    Thread.sleep(400);
                }
                if (!inputDone) {
                    int ii = codec.dequeueInputBuffer(10000);
                    if (ii >= 0) {
                        ByteBuffer buf = codec.getInputBuffer(ii);
                        int n = buf == null ? -1 : ex.readSampleData(buf, 0);
                        if (n < 0) {
                            codec.queueInputBuffer(ii, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            codec.queueInputBuffer(ii, 0, n, ex.getSampleTime(), 0);
                            ex.advance();
                        }
                    }
                }
                int oi = codec.dequeueOutputBuffer(info, 10000);
                if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat of = codec.getOutputFormat();
                    if (of.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                        inRate = of.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                        rs = new Resampler(inRate);
                    }
                    if (of.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channels = of.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                    if (of.containsKey(MediaFormat.KEY_PCM_ENCODING)) floatPcm = of.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT;
                    continue;
                }
                if (oi < 0) continue;
                if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true;
                ByteBuffer out = codec.getOutputBuffer(oi);
                if (out != null && info.size > 0) {
                    if (base < 0) base = info.presentationTimeUs / 1e6;
                    out.position(info.offset);
                    out.limit(info.offset + info.size);
                    float[] mono = toMono(out.slice().order(ByteOrder.nativeOrder()), channels, floatPcm);
                    float[] s16 = rs.push(mono);
                    for (float v : s16) {
                        window[wn++] = v;
                        if (wn == window.length) {
                            vad.acceptWaveform(window.clone());
                            fed += wn;
                            wn = 0;
                            drain(job, vad, rec, base);
                        }
                    }
                }
                codec.releaseOutputBuffer(oi, false);
            }
            if (alive(job)) {
                vad.flush();
                drain(job, vad, rec, base);
                status(job, "done", null);
            }
        } catch (InterruptedException ignored) {
            // stopped
        } catch (Exception e) {
            if (alive(job)) status(job, "error", e.getMessage() != null ? e.getMessage() : e.toString());
        } finally {
            try {
                if (codec != null) {
                    codec.stop();
                    codec.release();
                }
            } catch (Exception ignored) {}
            ex.release();
            if (vad != null) vad.release();
        }
    }

    /** Transcribe every finished speech segment the VAD has. */
    private void drain(String job, Vad vad, OfflineRecognizer rec, double base) {
        while (!vad.empty()) {
            SpeechSegment seg = vad.front();
            vad.pop();
            if (!alive(job)) return;
            float[] samples = seg.getSamples();
            OfflineStream st = rec.createStream();
            st.acceptWaveform(samples, SR);
            rec.decode(st);
            String text = rec.getResult(st).getText();
            st.release();
            if (text == null || text.trim().isEmpty()) continue;
            double start = base + seg.getStart() / (double) SR;
            JSObject o = new JSObject();
            o.put("job", job);
            o.put("start", start);
            o.put("end", start + samples.length / (double) SR);
            o.put("text", text.trim());
            notifyListeners("segment", o);
        }
    }

    private static float[] toMono(ByteBuffer b, int channels, boolean floatPcm) {
        int ch = Math.max(1, channels);
        if (floatPcm) {
            java.nio.FloatBuffer fb = b.asFloatBuffer();
            int frames = fb.remaining() / ch;
            float[] out = new float[frames];
            for (int i = 0; i < frames; i++) {
                float sum = 0;
                for (int c = 0; c < ch; c++) sum += fb.get(i * ch + c);
                out[i] = sum / ch;
            }
            return out;
        }
        java.nio.ShortBuffer sb = b.asShortBuffer();
        int frames = sb.remaining() / ch;
        float[] out = new float[frames];
        for (int i = 0; i < frames; i++) {
            int sum = 0;
            for (int c = 0; c < ch; c++) sum += sb.get(i * ch + c);
            out[i] = sum / (32768f * ch);
        }
        return out;
    }

    /** Streaming linear resampler to 16 kHz. */
    private static final class Resampler {
        private final double step;
        private double pos = 0; // position in input samples, relative to `prev`
        private float prev = 0;

        Resampler(int inRate) {
            step = inRate / (double) SR;
        }

        /**
         * Output sample k sits at virtual input index (pos - 1), where virtual
         * index -1 is the last sample of the previous buffer. pos stays in
         * [0, in.length) inside the loop, so every array index is valid.
         */
        float[] push(float[] in) {
            if (in.length == 0) return in;
            if (step == 1.0) {
                prev = in[in.length - 1];
                return in;
            }
            int cap = (int) Math.ceil(in.length / step) + 2;
            float[] out = new float[cap];
            int n = 0;
            while (pos < in.length && n < cap) {
                int i = (int) pos;
                double f = pos - i;
                float a = i == 0 ? prev : in[i - 1];
                float b = in[i];
                out[n++] = (float) (a + (b - a) * f);
                pos += step;
            }
            pos -= in.length;
            if (pos < 0) pos = 0;
            prev = in[in.length - 1];
            float[] r = new float[n];
            System.arraycopy(out, 0, r, 0, n);
            return r;
        }
    }

    // ----------------------------------------------------------------- models

    private VadModelConfig vadConfig() throws Exception {
        File f = new File(modelsDir(), "silero_vad.onnx");
        if (!f.exists() || f.length() < 100000) fetch(VAD_URL, f);
        SileroVadModelConfig s = new SileroVadModelConfig();
        s.setModel(f.getAbsolutePath());
        s.setThreshold(0.5f);
        s.setMinSilenceDuration(0.3f);
        s.setMinSpeechDuration(0.25f);
        s.setMaxSpeechDuration(12.0f);
        s.setWindowSize(512);
        VadModelConfig c = new VadModelConfig();
        c.setSileroVadModelConfig(s);
        c.setSampleRate(SR);
        c.setNumThreads(1);
        return c;
    }

    private OfflineRecognizer recognizer(String model, String type, String language) throws Exception {
        String key = model + "|" + type + "|" + language;
        if (recognizer != null && key.equals(loadedModel)) return recognizer;
        if (recognizer != null) {
            recognizer.release();
            recognizer = null;
            loadedModel = null;
        }
        File dir = new File(modelsDir(), model);
        if (!new File(dir, ".ready").exists()) throw new Exception("The transcript model isn't downloaded yet");
        OfflineModelConfig mc = new OfflineModelConfig();
        mc.setNumThreads(Math.max(2, Math.min(4, Runtime.getRuntime().availableProcessors())));
        mc.setProvider("cpu");
        mc.setDebug(false);
        File tokens = find(dir, "tokens.txt", "tokens.txt");
        if (tokens == null) throw new Exception("Transcript model is missing tokens.txt");
        mc.setTokens(tokens.getAbsolutePath());
        if ("whisper".equals(type)) {
            OfflineWhisperModelConfig w = new OfflineWhisperModelConfig();
            w.setEncoder(need(find(dir, "encoder", ".onnx")).getAbsolutePath());
            w.setDecoder(need(find(dir, "decoder", ".onnx")).getAbsolutePath());
            w.setLanguage(language);
            w.setTask("transcribe");
            mc.setWhisper(w);
        } else {
            OfflineMoonshineModelConfig m = new OfflineMoonshineModelConfig();
            m.setPreprocessor(need(find(dir, "preprocess", ".onnx")).getAbsolutePath());
            m.setEncoder(need(find(dir, "encode", ".onnx")).getAbsolutePath());
            m.setUncachedDecoder(need(find(dir, "uncached_decode", ".onnx")).getAbsolutePath());
            m.setCachedDecoder(need(find(dir, "cached_decode", ".onnx")).getAbsolutePath());
            mc.setMoonshine(m);
        }
        FeatureConfig feat = new FeatureConfig();
        feat.setSampleRate(SR);
        feat.setFeatureDim(80);
        OfflineRecognizerConfig cfg = new OfflineRecognizerConfig();
        cfg.setFeatConfig(feat);
        cfg.setModelConfig(mc);
        recognizer = new OfflineRecognizer(null, cfg);
        loadedModel = key;
        return recognizer;
    }

    private static File need(File f) throws Exception {
        if (f == null) throw new Exception("Transcript model files are incomplete — remove and download it again");
        return f;
    }

    /**
     * Find a model file whose name starts with (or contains) `part` and ends with
     * `suffix`, preferring int8 builds. "encode" must not match "uncached_decode".
     */
    private static File find(File dir, String part, String suffix) {
        File best = null;
        File[] kids = dir.listFiles();
        if (kids == null) return null;
        for (File k : kids) {
            String n = k.getName();
            if (!n.endsWith(suffix)) continue;
            boolean match;
            if (part.equals("encode")) match = n.startsWith("encode") || n.contains("-encode") || n.contains("_encode");
            else if (part.equals("cached_decode")) match = n.startsWith("cached_decode");
            else match = n.contains(part);
            if (part.equals("decoder") && n.contains("encoder")) match = false;
            if (!match) continue;
            if (best == null || (n.contains("int8") && !best.getName().contains("int8"))) best = k;
        }
        return best;
    }

    private static void fetch(String url, File dest) throws Exception {
        String current = url;
        HttpURLConnection conn = null;
        for (int i = 0; i < 6; i++) {
            conn = (HttpURLConnection) new URL(current).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(60000);
            int code = conn.getResponseCode();
            if (code >= 300 && code < 400 && conn.getHeaderField("Location") != null) {
                current = new URL(new URL(current), conn.getHeaderField("Location")).toString();
                conn.disconnect();
                continue;
            }
            if (code != 200) throw new Exception("Could not download the speech detector (HTTP " + code + ")");
            break;
        }
        //noinspection ResultOfMethodCallIgnored
        dest.getParentFile().mkdirs();
        File tmp = new File(dest.getPath() + ".part");
        try (InputStream in = new BufferedInputStream(conn.getInputStream()); OutputStream out = new FileOutputStream(tmp)) {
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        if (!tmp.renameTo(dest)) throw new Exception("Could not save the speech detector");
    }
}
