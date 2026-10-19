package app.inkwell.books;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.regex.Pattern;

/**
 * Audiobooks already on the phone: the user picks a folder once (Android asks for
 * that folder only), and the app lists its audio files to play them in place.
 */
@CapacitorPlugin(name = "InkwellLocal")
public class InkwellLocalPlugin extends Plugin {

    private static final Pattern AUDIO = Pattern.compile("(?i).*\\.(mp3|m4b|m4a|aac|flac|ogg|oga|opus|wav|wma|mka)$");
    private static final Pattern IMAGE = Pattern.compile("(?i)^(cover|folder|front|album|art)[^/]*\\.(jpe?g|png|webp)$");
    private static final int MAX_FILES = 20000;

    /** Let the user choose a folder; keeps access to it after restarts. */
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "onFolder");
    }

    @ActivityCallback
    private void onFolder(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri tree = data != null ? data.getData() : null;
        if (tree == null) {
            call.reject("No folder chosen");
            return;
        }
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {
        }
        JSObject o = new JSObject();
        o.put("uri", tree.toString());
        o.put("name", tree.getLastPathSegment() == null ? "" : tree.getLastPathSegment().replaceAll("^.*[:/]", ""));
        call.resolve(o);
    }

    /** Every audio file under the folder: [{ uri, name, dir, size }] (dir = path inside the folder). */
    @PluginMethod
    public void scan(PluginCall call) {
        String root = call.getString("uri");
        if (root == null || root.isEmpty()) {
            call.reject("Missing folder");
            return;
        }
        getBridge().execute(() -> {
            try {
                Uri tree = Uri.parse(root);
                JSArray files = new JSArray();
                JSArray covers = new JSArray();
                walk(tree, DocumentsContract.getTreeDocumentId(tree), "", files, covers, 0);
                JSObject o = new JSObject();
                o.put("files", files);
                o.put("covers", covers);
                call.resolve(o);
            } catch (SecurityException e) {
                call.reject("Audiohub lost access to that folder — choose it again");
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        });
    }

    /**
     * A book's cover as a small JPEG in the app's cache: the folder's cover image if
     * given, else the art built into the audio file. Resolves { path } ("" = none).
     */
    @PluginMethod
    public void cover(PluginCall call) {
        String image = call.getString("image", "");
        String audio = call.getString("audio", "");
        String key = call.getString("key", "cover");
        getBridge().execute(() -> {
            JSObject o = new JSObject();
            try {
                java.io.File dir = new java.io.File(getContext().getCacheDir(), "local-covers");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                java.io.File out = new java.io.File(dir, key.replaceAll("[^A-Za-z0-9_-]", "_") + ".jpg");
                if (out.length() > 0) {
                    o.put("path", out.getAbsolutePath());
                    call.resolve(o);
                    return;
                }
                android.graphics.Bitmap bmp = null;
                if (!image.isEmpty()) {
                    try (java.io.InputStream in = getContext().getContentResolver().openInputStream(Uri.parse(image))) {
                        bmp = decodeSmall(readAll(in));
                    } catch (Exception ignored) {
                    }
                }
                if (bmp == null && !audio.isEmpty()) {
                    android.media.MediaMetadataRetriever r = new android.media.MediaMetadataRetriever();
                    try {
                        r.setDataSource(getContext(), Uri.parse(audio));
                        byte[] art = r.getEmbeddedPicture();
                        if (art != null) bmp = decodeSmall(art);
                    } catch (Exception ignored) {
                    } finally {
                        try {
                            r.release();
                        } catch (Exception ignored) {
                        }
                    }
                }
                if (bmp == null) {
                    o.put("path", "");
                } else {
                    try (java.io.FileOutputStream fo = new java.io.FileOutputStream(out)) {
                        bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, fo);
                    }
                    o.put("path", out.getAbsolutePath());
                }
                call.resolve(o);
            } catch (Exception e) {
                o.put("path", "");
                call.resolve(o);
            }
        });
    }

    private static byte[] readAll(java.io.InputStream in) throws java.io.IOException {
        java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        return b.toByteArray();
    }

    /** Decode at most ~500 px wide, so covers stay small. */
    private static android.graphics.Bitmap decodeSmall(byte[] data) {
        android.graphics.BitmapFactory.Options o = new android.graphics.BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        android.graphics.BitmapFactory.decodeByteArray(data, 0, data.length, o);
        int scale = 1;
        while (o.outWidth / (scale * 2) >= 500) scale *= 2;
        android.graphics.BitmapFactory.Options d = new android.graphics.BitmapFactory.Options();
        d.inSampleSize = scale;
        return android.graphics.BitmapFactory.decodeByteArray(data, 0, data.length, d);
    }

    private void walk(Uri tree, String docId, String dir, JSArray files, JSArray covers, int depth) {
        if (depth > 6 || files.length() >= MAX_FILES) return;
        ContentResolver cr = getContext().getContentResolver();
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
        String[] cols = { DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE };
        try (Cursor c = cr.query(children, cols, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext()) {
                String id = c.getString(0);
                String name = c.getString(1);
                String mime = c.getString(2);
                long size = c.isNull(3) ? 0 : c.getLong(3);
                if (name == null || name.startsWith(".")) continue;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    walk(tree, id, dir.isEmpty() ? name : dir + "/" + name, files, covers, depth + 1);
                } else if (AUDIO.matcher(name).matches()) {
                    JSObject f = new JSObject();
                    f.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString());
                    f.put("name", name);
                    f.put("dir", dir);
                    f.put("size", size);
                    files.put(f);
                } else if (IMAGE.matcher(name).matches()) {
                    JSObject f = new JSObject();
                    f.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString());
                    f.put("dir", dir);
                    covers.put(f);
                }
            }
        }
    }
}
