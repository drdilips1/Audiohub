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
        voice(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        voice(intent);
    }

    /** "Play … on Audiohub" from Google Assistant: hand the words to the player. */
    private void voice(Intent intent) {
        if (intent == null || !"android.media.action.MEDIA_PLAY_FROM_SEARCH".equals(intent.getAction())) return;
        String q = intent.getStringExtra(android.app.SearchManager.QUERY);
        InkwellPlayerPlugin.voicePlay(this, q == null ? "" : q);
        intent.setAction(Intent.ACTION_MAIN); // not again on rotation
    }
}
