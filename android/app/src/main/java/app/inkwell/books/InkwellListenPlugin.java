package app.inkwell.books;

import android.app.Activity;
import android.content.Intent;
import android.speech.RecognizerIntent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;

/**
 * Voice questions for Ask AI: opens Google's speech input (very good with Indian
 * English and Hindi) and returns what was said. Google's app handles the microphone,
 * so Audiohub needs no microphone permission of its own.
 */
@CapacitorPlugin(name = "InkwellListen")
public class InkwellListenPlugin extends Plugin {

    @PluginMethod
    public void listen(PluginCall call) {
        String lang = call.getString("lang", "en-IN");
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
        i.putExtra(RecognizerIntent.EXTRA_PROMPT, call.getString("prompt", "Ask about this book"));
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        if (i.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("Voice input isn't available on this phone — install or enable the Google app");
            return;
        }
        startActivityForResult(call, i, "onSpeech");
    }

    @ActivityCallback
    private void onSpeech(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject r = new JSObject();
        String text = "";
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            ArrayList<String> m = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (m != null && !m.isEmpty() && m.get(0) != null) text = m.get(0);
        }
        r.put("text", text);
        call.resolve(r);
    }
}
