package app.inkwell.books;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Offline downloads for audiobook files. Saves either to the public
 * Downloads/Inkwell folder (visible in the file manager, kept after uninstall)
 * or to the app's own storage. Returns a URI the native player can open.
 */
@CapacitorPlugin(name = "InkwellDownloads")
public class InkwellDownloadsPlugin extends Plugin {

    private final ExecutorService queue = Executors.newSingleThreadExecutor();
    private final Set<String> cancelled = ConcurrentHashMap.newKeySet();

    @PluginMethod
    public void publicAvailable(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q);
        call.resolve(r);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String job = call.getString("job");
        if (job != null) cancelled.add(job);
        call.resolve();
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String name = call.getString("name", "audio.mp3");
        String folder = call.getString("folder", "Inkwell");
        String target = call.getString("target", "public");
        String job = call.getString("job", "");
        String mime = call.getString("mime", "audio/mpeg");
        if (url == null) {
            call.reject("Missing url");
            return;
        }
        call.setKeepAlive(true);
        queue.execute(() -> {
            Uri outUri = null;
            File outFile = null;
            HttpURLConnection conn = null;
            try {
                if (cancelled.contains(job)) throw new InterruptedException("cancelled");
                // Connect, following redirects across hosts (debrid CDNs do this).
                String current = url;
                for (int i = 0; i < 8; i++) {
                    conn = (HttpURLConnection) new URL(current).openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(60000);
                    conn.setRequestProperty("User-Agent", "Inkwell/1.0 (Android)");
                    JSObject headers = call.getObject("headers");
                    if (headers != null && i == 0) {
                        Iterator<String> keys = headers.keys();
                        while (keys.hasNext()) {
                            String k = keys.next();
                            conn.setRequestProperty(k, headers.optString(k));
                        }
                    }
                    int code = conn.getResponseCode();
                    if (code >= 300 && code < 400 && conn.getHeaderField("Location") != null) {
                        current = new URL(new URL(current), conn.getHeaderField("Location")).toString();
                        conn.disconnect();
                        continue;
                    }
                    if (code != 200) throw new Exception("Download failed (HTTP " + code + ")");
                    break;
                }
                long total = conn.getContentLengthLong();

                OutputStream out;
                boolean usePublic = "public".equals(target) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
                if (usePublic) {
                    ContentResolver cr = getContext().getContentResolver();
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    v.put(MediaStore.Downloads.MIME_TYPE, mime);
                    v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + folder);
                    v.put(MediaStore.Downloads.IS_PENDING, 1);
                    outUri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (outUri == null) throw new Exception("Could not create the file in Downloads");
                    out = cr.openOutputStream(outUri);
                } else {
                    File base = getContext().getExternalFilesDir(null);
                    if (base == null) base = getContext().getFilesDir();
                    File dir = new File(new File(base, "downloads"), folder);
                    //noinspection ResultOfMethodCallIgnored
                    dir.mkdirs();
                    outFile = new File(dir, name);
                    out = new FileOutputStream(outFile);
                }
                if (out == null) throw new Exception("Could not open the output file");

                long got = 0;
                long lastEmit = 0;
                try (InputStream in = new BufferedInputStream(conn.getInputStream(), 1 << 16); OutputStream o = out) {
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        if (cancelled.contains(job)) throw new InterruptedException("cancelled");
                        o.write(buf, 0, n);
                        got += n;
                        long now = System.currentTimeMillis();
                        if (now - lastEmit > 500) {
                            lastEmit = now;
                            JSObject p = new JSObject();
                            p.put("job", job);
                            p.put("name", name);
                            p.put("received", got);
                            p.put("total", total);
                            notifyListeners("progress", p);
                        }
                    }
                }
                if (usePublic) {
                    ContentValues done = new ContentValues();
                    done.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContext().getContentResolver().update(outUri, done, null, null);
                }
                JSObject r = new JSObject();
                r.put("uri", usePublic ? outUri.toString() : "file://" + outFile.getAbsolutePath());
                r.put("size", got);
                r.put("location", usePublic ? "Downloads/" + folder : "App storage");
                call.resolve(r);
            } catch (Throwable e) {
                try {
                    if (outUri != null) getContext().getContentResolver().delete(outUri, null, null);
                } catch (Exception ignored) {}
                //noinspection ResultOfMethodCallIgnored
                if (outFile != null) outFile.delete();
                call.reject(e instanceof InterruptedException ? "cancelled" : e.getMessage() != null ? e.getMessage() : e.toString());
            } finally {
                if (conn != null) conn.disconnect();
                call.setKeepAlive(false);
            }
        });
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String uri = call.getString("uri", "");
        try {
            if (uri.startsWith("content://")) {
                getContext().getContentResolver().delete(Uri.parse(uri), null, null);
            } else if (uri.startsWith("file://")) {
                File f = new File(Uri.parse(uri).getPath());
                //noinspection ResultOfMethodCallIgnored
                f.delete();
                File parent = f.getParentFile();
                String[] left = parent != null ? parent.list() : null;
                //noinspection ResultOfMethodCallIgnored
                if (parent != null && left != null && left.length == 0) parent.delete();
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
