package app.inkwell.books;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(InkwellPlayerPlugin.class);
        registerPlugin(InkwellTtsPlugin.class);
        registerPlugin(InkwellVoicesPlugin.class);
        registerPlugin(InkwellDownloadsPlugin.class);
        registerPlugin(InkwellTranscribePlugin.class);
        registerPlugin(InkwellWebPlugin.class);
        registerPlugin(InkwellUpdatePlugin.class);
        registerPlugin(InkwellReadAloudPlugin.class);
        registerPlugin(InkwellListenPlugin.class);
        registerPlugin(InkwellLocalPlugin.class);
        super.onCreate(savedInstanceState);
        keepAwakeInBackground();
        voice(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        voice(intent);
    }

    /**
     * The app's screen is a web page in its own process, which Android lowers (and can freeze)
     * once it isn't visible. The car (or a voice request) then asks a sleeping app to prepare a
     * book, and nothing happens until the app is opened. Keep that process as important as the
     * app itself — which, while playing or connected to the car, Android keeps running.
     */
    private void keepAwakeInBackground() {
        try {
            if (android.os.Build.VERSION.SDK_INT >= 26 && getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().setRendererPriorityPolicy(android.webkit.WebView.RENDERER_PRIORITY_IMPORTANT, false);
            }
        } catch (Exception ignored) {}
    }

    /** "Play … on AudioYam" from Google Assistant: hand the words to the player. */
    private void voice(Intent intent) {
        if (intent == null || !"android.media.action.MEDIA_PLAY_FROM_SEARCH".equals(intent.getAction())) return;
        String q = intent.getStringExtra(android.app.SearchManager.QUERY);
        InkwellPlayerPlugin.voicePlay(this, q == null ? "" : q);
        intent.setAction(Intent.ACTION_MAIN); // not again on rotation
    }
}
