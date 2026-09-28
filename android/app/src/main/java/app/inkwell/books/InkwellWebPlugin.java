package app.inkwell.books;

import android.content.Intent;
import android.net.Uri;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Opens a page in the in-app browser (InkwellWebActivity). */
@CapacitorPlugin(name = "InkwellWeb")
public class InkwellWebPlugin extends Plugin {

    private static InkwellWebPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** A .torrent or magnet caught in the in-app browser, handed to the app's JavaScript. */
    static void captured(JSObject data) {
        if (instance != null) instance.notifyListeners("captured", data, true);
    }

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("Missing url");
            return;
        }
        Intent i = new Intent(getContext(), InkwellWebActivity.class);
        i.putExtra("url", url);
        i.putExtra("title", call.getString("title", ""));
        i.putExtra("capture", call.getBoolean("capture", false));
        // qBittorrent settings, so captured downloads are sent from the browser screen itself.
        i.putExtra("qbit", call.getString("qbit", ""));
        getActivity().startActivity(i);
        call.resolve();
    }

    /** Hand a link to Android, so an installed app (e.g. Libby) opens it; otherwise the browser does. */
    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("Missing url");
            return;
        }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("No app can open this link");
        }
    }

    /** A short message that shows over any screen (e.g. while the in-app browser is open). */
    @PluginMethod
    public void toast(PluginCall call) {
        String text = call.getString("text", "");
        getActivity().runOnUiThread(() -> Toast.makeText(getContext(), text, Toast.LENGTH_LONG).show());
        call.resolve();
    }

    /**
     * Download a file (e.g. an EPUB) and open Android's share sheet for it —
     * pick Kindle ("Send to Kindle") or email it to your @kindle.com address.
     */
    @PluginMethod
    public void shareFile(PluginCall call) {
        String url = call.getString("url");
        String name = call.getString("name", "book.epub").replaceAll("[\\\\/:*?\"<>|]", " ").trim();
        String mime = call.getString("mime", "application/epub+zip");
        String title = call.getString("title", "Send to Kindle");
        // Optional: your Kindle's e-mail address — opens your e-mail app with the book attached.
        String email = call.getString("email", "");
        if (url == null) {
            call.reject("Missing url");
            return;
        }
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "share");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                File f = new File(dir, name);
                //noinspection ResultOfMethodCallIgnored
                f.delete();
                // Same downloader as updates: follows redirects, has timeouts, several connections.
                ParallelDownloader.fetch(url, f, 2, null);
                if (looksLikeWebPage(f)) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                    throw new Exception("the link gave a web page instead of the ebook file — try opening it in the browser");
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(mime);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.putExtra(Intent.EXTRA_SUBJECT, name);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                if (email != null && !email.isEmpty()) {
                    // Only e-mail apps, addressed to the Kindle.
                    send.putExtra(Intent.EXTRA_EMAIL, new String[] { email });
                    send.putExtra(Intent.EXTRA_TEXT, "Sent from Audiohub");
                    send.setSelector(new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")));
                }
                Intent chooser = Intent.createChooser(send, title);
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().runOnUiThread(() -> {
                    try {
                        getActivity().startActivity(chooser);
                        call.resolve();
                    } catch (Throwable t) {
                        call.reject("Couldn't open the share menu: " + t.getMessage());
                    }
                });
            } catch (Throwable e) {
                call.reject("Couldn't get the ebook: " + e.getMessage());
            }
        }).start();
    }

    /** A download that is really an HTML page (login, captcha, error) rather than the file. */
    private static boolean looksLikeWebPage(File f) {
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
            byte[] head = new byte[256];
            int n = in.read(head);
            if (n <= 0) return true;
            String s = new String(head, 0, n, java.nio.charset.StandardCharsets.ISO_8859_1).trim().toLowerCase(java.util.Locale.ROOT);
            return s.startsWith("<!doctype html") || s.startsWith("<html") || s.startsWith("<head");
        } catch (Exception e) {
            return false;
        }
    }
}
