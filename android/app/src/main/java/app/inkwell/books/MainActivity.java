package app.inkwell.books;

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
        super.onCreate(savedInstanceState);
    }
}
