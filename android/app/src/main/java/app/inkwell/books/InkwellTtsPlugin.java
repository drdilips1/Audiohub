package app.inkwell.books;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Free, on-device voices via Android's text-to-speech system. Works with any
 * installed engine — Google Speech Services, Samsung, or free neural engines
 * such as HayaiTTS / SherpaTTS (Kokoro, Piper). Can speak directly or render
 * a section of a book to a WAV file for the audiobook player.
 */
@CapacitorPlugin(name = "InkwellTts")
public class InkwellTtsPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private TextToSpeech tts;
    private String ttsEngine = null; // package the current instance was created for ("" = system default)
    private boolean ready = false;
    private final List<Runnable> waiting = new ArrayList<>();
    private final Map<String, PluginCall> pending = new ConcurrentHashMap<>();

    // ------------------------------------------------------------ engine setup

    private interface Ready {
        void run(TextToSpeech t);
    }

    private void withEngine(String engine, PluginCall call, Ready then) {
        String want = engine == null ? "" : engine;
        main.post(() -> {
            if (tts != null && want.equals(ttsEngine)) {
                if (ready) then.run(tts);
                else waiting.add(() -> then.run(tts));
                return;
            }
            if (tts != null) {
                try {
                    tts.stop();
                    tts.shutdown();
                } catch (Exception ignored) {}
            }
            ready = false;
            waiting.clear();
            waiting.add(() -> then.run(tts));
            ttsEngine = want;
            TextToSpeech.OnInitListener onInit = status -> main.post(() -> {
                if (status != TextToSpeech.SUCCESS) {
                    waiting.clear();
                    call.reject("That voice engine could not start (is it installed and set up?)");
                    return;
                }
                ready = true;
                tts.setOnUtteranceProgressListener(listener);
                List<Runnable> run = new ArrayList<>(waiting);
                waiting.clear();
                for (Runnable r : run) r.run();
            });
            tts = want.isEmpty() ? new TextToSpeech(getContext(), onInit) : new TextToSpeech(getContext(), onInit, want);
        });
    }

    private final UtteranceProgressListener listener = new UtteranceProgressListener() {
        @Override
        public void onStart(String id) {}

        @Override
        public void onDone(String id) {
            PluginCall c = pending.remove(id);
            if (c == null) return;
            JSObject o = new JSObject();
            String path = c.getString("_path");
            if (path != null) o.put("uri", "file://" + path);
            c.resolve(o);
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onError(String id) {
            PluginCall c = pending.remove(id);
            if (c != null) c.reject("The voice engine failed to synthesise this text");
        }

        @Override
        public void onError(String id, int code) {
            PluginCall c = pending.remove(id);
            if (c != null) c.reject("The voice engine failed (error " + code + ")");
        }

        @Override
        public void onStop(String id, boolean interrupted) {
            PluginCall c = pending.remove(id);
            if (c != null) c.reject("stopped");
        }
    };

    private void applyVoice(TextToSpeech t, PluginCall call) {
        String voiceName = call.getString("voice");
        if (voiceName != null && !voiceName.isEmpty()) {
            Set<Voice> voices = t.getVoices();
            if (voices != null) {
                for (Voice v : voices) {
                    if (v.getName().equals(voiceName)) {
                        t.setVoice(v);
                        break;
                    }
                }
            }
        }
        t.setSpeechRate(call.getFloat("rate", 1f));
        t.setPitch(call.getFloat("pitch", 1f));
    }

    // ----------------------------------------------------------------- methods

    @PluginMethod
    public void getEngines(PluginCall call) {
        withEngine("", call, t -> {
            JSArray arr = new JSArray();
            for (TextToSpeech.EngineInfo e : t.getEngines()) {
                JSObject o = new JSObject();
                o.put("name", e.name);
                o.put("label", e.label);
                arr.put(o);
            }
            JSObject r = new JSObject();
            r.put("engines", arr);
            r.put("defaultEngine", t.getDefaultEngine());
            call.resolve(r);
        });
    }

    @PluginMethod
    public void getVoices(PluginCall call) {
        withEngine(call.getString("engine", ""), call, t -> {
            JSArray arr = new JSArray();
            Set<Voice> voices = t.getVoices();
            if (voices != null) {
                for (Voice v : voices) {
                    Set<String> feats = v.getFeatures();
                    if (feats != null && feats.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                    JSObject o = new JSObject();
                    Locale l = v.getLocale();
                    o.put("name", v.getName());
                    o.put("lang", l != null ? l.toLanguageTag() : "");
                    o.put("langLabel", l != null ? l.getDisplayName() : "");
                    o.put("quality", v.getQuality());
                    o.put("network", v.isNetworkConnectionRequired());
                    arr.put(o);
                }
            }
            Voice def = null;
            try {
                def = t.getDefaultVoice();
            } catch (Exception ignored) {}
            JSObject r = new JSObject();
            r.put("voices", arr);
            r.put("defaultVoice", def != null ? def.getName() : "");
            call.resolve(r);
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        withEngine(call.getString("engine", ""), call, t -> {
            applyVoice(t, call);
            String id = UUID.randomUUID().toString();
            call.setKeepAlive(false);
            pending.put(id, call);
            Bundle params = new Bundle();
            int res = t.speak(call.getString("text", ""), TextToSpeech.QUEUE_FLUSH, params, id);
            if (res != TextToSpeech.SUCCESS) {
                pending.remove(id);
                call.reject("The voice engine refused the text");
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            if (tts != null) tts.stop();
            for (Map.Entry<String, PluginCall> e : pending.entrySet()) {
                if (e.getValue().getString("_path") == null) {
                    pending.remove(e.getKey());
                    e.getValue().reject("stopped");
                }
            }
            call.resolve();
        });
    }

    /** Render text to a WAV file (for the audiobook player). */
    @PluginMethod
    public void synthesize(PluginCall call) {
        String rel = call.getString("path");
        if (rel == null) {
            call.reject("Missing path");
            return;
        }
        File out = new File(getContext().getCacheDir(), rel);
        File dir = out.getParentFile();
        if (dir != null && !dir.exists() && !dir.mkdirs()) {
            call.reject("Could not create the audio cache folder");
            return;
        }
        if (out.exists() && out.length() > 1024) {
            JSObject o = new JSObject();
            o.put("uri", "file://" + out.getAbsolutePath());
            call.resolve(o);
            return;
        }
        withEngine(call.getString("engine", ""), call, t -> {
            applyVoice(t, call);
            String text = call.getString("text", "");
            int max = TextToSpeech.getMaxSpeechInputLength();
            if (text.length() > max) text = text.substring(0, max);
            String id = UUID.randomUUID().toString();
            call.getData().put("_path", out.getAbsolutePath());
            pending.put(id, call);
            int res = t.synthesizeToFile(text, new Bundle(), out, id);
            if (res != TextToSpeech.SUCCESS) {
                pending.remove(id);
                call.reject("The voice engine could not render this section");
            }
        });
    }

    @PluginMethod
    public void clearCache(PluginCall call) {
        deleteTree(new File(getContext().getCacheDir(), "tts"));
        call.resolve();
    }

    private static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
    }
}
