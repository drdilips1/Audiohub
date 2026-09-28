package app.inkwell.books;

import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Bridge to ReadAloudEngine: the reader sends the text, the engine reads it by itself. */
@CapacitorPlugin(name = "InkwellReadAloud")
public class InkwellReadAloudPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable onChange = () -> notifyListeners("state", state(), true);

    @Override
    public void load() {
        ReadAloudEngine.addListener(onChange);
    }

    @Override
    protected void handleOnDestroy() {
        ReadAloudEngine.removeListener(onChange);
    }

    private static JSObject state() {
        JSObject o = new JSObject();
        o.put("active", ReadAloudEngine.isActive());
        o.put("uid", ReadAloudEngine.uid());
        o.put("playing", ReadAloudEngine.isPlaying());
        o.put("para", ReadAloudEngine.para());
        o.put("total", ReadAloudEngine.total());
        o.put("finished", ReadAloudEngine.finished());
        o.put("error", ReadAloudEngine.lastError());
        o.put("note", ReadAloudEngine.voiceNote());
        o.put("rate", (double) ReadAloudEngine.rate());
        return o;
    }

    private void onMain(PluginCall call, Runnable r) {
        main.post(() -> {
            try {
                r.run();
                call.resolve(state());
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        });
    }

    private static String str(JSONObject o, String k, String d) {
        return o != null && o.has(k) && !o.isNull(k) ? o.optString(k, d) : d;
    }

    /**
     * { uid, title, paras: [text], from, chapters: [{ para, title }], rate,
     *   voice: { engine, edgeVoice, systemEngine, systemVoice, builtin: { id, type, model, lexicon, lang, speaker } } }
     */
    @PluginMethod
    public void start(PluginCall call) {
        try {
            JSArray arr = call.getArray("paras");
            List<String> paras = new ArrayList<>();
            if (arr != null) for (int i = 0; i < arr.length(); i++) paras.add(arr.optString(i, ""));
            List<int[]> chStarts = new ArrayList<>();
            List<String> chTitles = new ArrayList<>();
            JSArray ch = call.getArray("chapters");
            if (ch != null) for (int i = 0; i < ch.length(); i++) {
                JSONObject c = ch.optJSONObject(i);
                if (c == null) continue;
                chStarts.add(new int[] { c.optInt("para", 0) });
                chTitles.add(c.optString("title", ""));
            }
            JSObject v = call.getObject("voice");
            ReadAloudEngine.VoiceSpec spec = new ReadAloudEngine.VoiceSpec();
            spec.engine = str(v, "engine", "edge");
            spec.edgeVoice = str(v, "edgeVoice", spec.edgeVoice);
            spec.systemEngine = str(v, "systemEngine", "");
            spec.systemVoice = str(v, "systemVoice", "");
            JSONObject b = v != null ? v.optJSONObject("builtin") : null;
            if (b != null && !str(b, "id", "").isEmpty()) {
                SherpaVoice.Spec s = new SherpaVoice.Spec();
                s.id = str(b, "id", "");
                s.type = str(b, "type", "vits");
                s.model = str(b, "model", "model.onnx");
                s.lexicon = str(b, "lexicon", "");
                s.lang = str(b, "lang", "");
                s.speaker = b.optInt("speaker", 0);
                spec.builtin = s;
            }
            String uid = call.getString("uid", "");
            String title = call.getString("title", "");
            int from = call.getInt("from", 0);
            float rate = call.getFloat("rate", 1f);
            onMain(call, () -> ReadAloudEngine.start(getContext(), uid, title, paras, from, chStarts, chTitles, spec, rate));
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @PluginMethod
    public void pause(PluginCall call) {
        onMain(call, ReadAloudEngine::pause);
    }

    @PluginMethod
    public void resume(PluginCall call) {
        onMain(call, ReadAloudEngine::play);
    }

    @PluginMethod
    public void seek(PluginCall call) {
        int para = call.getInt("para", 0);
        onMain(call, () -> ReadAloudEngine.seek(para));
    }

    @PluginMethod
    public void next(PluginCall call) {
        onMain(call, ReadAloudEngine::next);
    }

    @PluginMethod
    public void previous(PluginCall call) {
        onMain(call, ReadAloudEngine::previous);
    }

    @PluginMethod
    public void setRate(PluginCall call) {
        float r = call.getFloat("rate", 1f);
        onMain(call, () -> ReadAloudEngine.setRate(r));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        onMain(call, ReadAloudEngine::stop);
    }

    @PluginMethod
    public void status(PluginCall call) {
        onMain(call, () -> {});
    }
}
