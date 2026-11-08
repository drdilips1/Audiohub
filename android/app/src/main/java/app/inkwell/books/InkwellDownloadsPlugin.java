package app.inkwell.books;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.List;
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
    public void move(PluginCall call) {
        // Move a file this app downloaded into another folder (sorting old downloads).
        String uri = call.getString("uri", "");
        String folder = call.getString("folder", "Audiohub");
        try {
            JSObject r = new JSObject();
            if (uri.startsWith("content://") && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + folder);
                if (getContext().getContentResolver().update(Uri.parse(uri), v, null, null) < 1) throw new Exception("Android didn't move it");
                r.put("uri", uri); // same file, new folder
                r.put("location", "Downloads/" + folder);
            } else if (uri.startsWith("file://")) {
                File f = new File(Uri.parse(uri).getPath());
                File base = getContext().getExternalFilesDir(null);
                if (base == null) base = getContext().getFilesDir();
                File dir = new File(new File(base, "downloads"), folder);
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                File to = new File(dir, f.getName());
                if (!f.getAbsolutePath().equals(to.getAbsolutePath())) {
                    if (!f.renameTo(to)) throw new Exception("Couldn't move the file");
                    File parent = f.getParentFile();
                    String[] left = parent != null ? parent.list() : null;
                    //noinspection ResultOfMethodCallIgnored
                    if (parent != null && left != null && left.length == 0) parent.delete();
                }
                r.put("uri", "file://" + to.getAbsolutePath());
                r.put("location", "App storage");
            } else throw new Exception("Not a downloaded file");
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
        }
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

    // ---------------------------------------------------------------- Audiobookshelf upload

    private final ExecutorService uploads = Executors.newSingleThreadExecutor();

    /**
     * Upload downloaded files into an Audiobookshelf library folder (its /api/upload): streamed
     * from storage, never held in memory. { url, token, fields: { title, author, series,
     * library, folder }, files: [{ uri, name, size }], job } → progress events "uploadProgress".
     */
    @PluginMethod
    public void uploadAbs(PluginCall call) {
        String url = call.getString("url");
        String token = call.getString("token", "");
        JSObject fields = call.getObject("fields", new JSObject());
        JSArray files = call.getArray("files", new JSArray());
        String job = call.getString("job", "");
        if (url == null || files.length() == 0) {
            call.reject("Nothing to upload");
            return;
        }
        uploads.execute(() -> {
            HttpURLConnection conn = null;
            try {
                long total = 0;
                for (int i = 0; i < files.length(); i++) total += files.getJSONObject(i).optLong("size", 0);
                String boundary = "----Audiohub" + System.currentTimeMillis();
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(10 * 60 * 1000); // the server writes the files before answering
                conn.setChunkedStreamingMode(256 * 1024);
                conn.setRequestProperty("Authorization", "Bearer " + token);
                conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
                OutputStream out = conn.getOutputStream();
                byte[] crlf = "\r\n".getBytes("UTF-8");
                for (Iterator<String> k = fields.keys(); k.hasNext(); ) {
                    String name = k.next();
                    String value = fields.optString(name, "");
                    if (value.isEmpty()) continue;
                    out.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n").getBytes("UTF-8"));
                    out.write(value.getBytes("UTF-8"));
                    out.write(crlf);
                }
                long sent = 0;
                long lastNote = 0;
                byte[] buf = new byte[128 * 1024];
                for (int i = 0; i < files.length(); i++) {
                    org.json.JSONObject f = files.getJSONObject(i);
                    String uri = f.optString("uri");
                    String fname = f.optString("name", "part" + (i + 1)).replace("\"", "'");
                    out.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + i + "\"; filename=\"" + fname + "\"\r\nContent-Type: application/octet-stream\r\n\r\n").getBytes("UTF-8"));
                    try (InputStream in = open(uri)) {
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            if (cancelled.contains(job)) throw new Exception("cancelled");
                            out.write(buf, 0, n);
                            sent += n;
                            long now = System.currentTimeMillis();
                            if (now - lastNote > 700) {
                                lastNote = now;
                                JSObject e = new JSObject();
                                e.put("job", job);
                                e.put("sent", sent);
                                e.put("total", total);
                                notifyListeners("uploadProgress", e);
                            }
                        }
                    }
                    out.write(crlf);
                }
                out.write(("--" + boundary + "--\r\n").getBytes("UTF-8"));
                out.flush();
                out.close();
                int code = conn.getResponseCode();
                if (code >= 400) {
                    String msg = "";
                    try (InputStream es = conn.getErrorStream()) {
                        if (es != null) msg = new String(readAll(es), "UTF-8").trim();
                    } catch (Exception ignored) {}
                    if (code == 403) msg = "your Audiobookshelf user isn't allowed to upload (Settings → Users → Can upload)" + (msg.isEmpty() ? "" : " — " + msg);
                    call.reject("Audiobookshelf said HTTP " + code + (msg.isEmpty() ? "" : ": " + (msg.length() > 200 ? msg.substring(0, 200) : msg)));
                    return;
                }
                JSObject r = new JSObject();
                r.put("sent", sent);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("cancelled".equals(e.getMessage()) ? "cancelled" : "Upload failed: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
                cancelled.remove(job);
            }
        });
    }

    private InputStream open(String uri) throws Exception {
        if (uri.startsWith("content:")) {
            InputStream in = getContext().getContentResolver().openInputStream(Uri.parse(uri));
            if (in == null) throw new Exception("can't open " + uri);
            return new BufferedInputStream(in);
        }
        String path = uri.startsWith("file:") ? Uri.parse(uri).getPath() : uri;
        return new BufferedInputStream(new FileInputStream(path));
    }

    private static byte[] readAll(InputStream in) throws Exception {
        java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0 && b.size() < 4096) b.write(buf, 0, n);
        return b.toByteArray();
    }
}
