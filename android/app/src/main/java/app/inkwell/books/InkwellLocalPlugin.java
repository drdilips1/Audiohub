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
    private static final Pattern EBOOK = Pattern.compile("(?i).*\\.(epub|pdf)$");
    private static final Pattern IMAGE = Pattern.compile("(?i)^(cover|folder|front|album|art)[^/]*\\.(jpe?g|png|webp)$");
    private static final int MAX_FILES = 20000;

    // ---- ebooks opened with / shared to Audiohub ---------------------------------

    /** A file another app opened with / shared to Audiohub, if any is waiting (copied into the app). */
    @PluginMethod
    public void incoming(PluginCall call) {
        Intent i = getActivity() != null ? getActivity().getIntent() : null;
        JSObject o = takeBook(i);
        if (o != null && getActivity() != null) getActivity().setIntent(new Intent()); // handled once
        call.resolve(o != null ? o : new JSObject());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        JSObject o = takeBook(intent);
        if (o != null) notifyListeners("incoming", o);
    }

    private JSObject takeBook(Intent i) {
        if (i == null) return null;
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(i.getAction())) uri = i.getData();
        else if (Intent.ACTION_SEND.equals(i.getAction())) uri = i.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null || "app.inkwell.books".equals(uri.getScheme())) return null;
        String name = nameOf(uri);
        if (name == null || name.isEmpty()) name = uri.getLastPathSegment() != null ? uri.getLastPathSegment() : "book";
        String mime = i.getType() != null ? i.getType() : getContext().getContentResolver().getType(uri);
        String lower = name.toLowerCase(java.util.Locale.ROOT);
        boolean pdf = lower.endsWith(".pdf") || "application/pdf".equals(mime);
        boolean epub = lower.endsWith(".epub") || "application/epub+zip".equals(mime);
        if (!pdf && !epub) return null;
        if (!lower.endsWith(".pdf") && !lower.endsWith(".epub")) name = name + (pdf ? ".pdf" : ".epub");
        // Keep a copy in the app: the other app's permission to read it ends soon.
        java.io.File dir = new java.io.File(getContext().getFilesDir(), "books");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        java.io.File out = new java.io.File(dir, name.replaceAll("[\\/:*?\"<>|]+", " ").trim());
        try (java.io.InputStream in = getContext().getContentResolver().openInputStream(uri); java.io.OutputStream os = new java.io.FileOutputStream(out)) {
            if (in == null) return null;
            byte[] b = new byte[1 << 16];
            int n;
            while ((n = in.read(b)) > 0) os.write(b, 0, n);
        } catch (Exception e) {
            JSObject err = new JSObject();
            err.put("error", "Couldn't open that file: " + e.getMessage());
            return err;
        }
        JSObject o = new JSObject();
        o.put("path", out.getAbsolutePath());
        o.put("name", name);
        o.put("format", pdf ? "PDF" : "EPUB");
        o.put("size", out.length());
        return o;
    }

    /** Pick EPUB / PDF files to add (copied into the app, like Open with). */
    @PluginMethod
    public void pickBook(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/epub+zip", "application/pdf", "application/octet-stream" });
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(call, i, "onPickBook");
    }

    @ActivityCallback
    private void onPickBook(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        java.util.List<Uri> uris = new java.util.ArrayList<>();
        if (data != null && data.getClipData() != null) for (int k = 0; k < data.getClipData().getItemCount(); k++) uris.add(data.getClipData().getItemAt(k).getUri());
        else if (data != null && data.getData() != null) uris.add(data.getData());
        if (uris.isEmpty()) {
            call.reject("cancelled");
            return;
        }
        getBridge().execute(() -> {
            JSArray books = new JSArray();
            for (Uri u : uris) {
                Intent v = new Intent(Intent.ACTION_VIEW);
                v.setData(u);
                JSObject o = takeBook(v);
                if (o != null) books.put(o);
            }
            JSObject r = new JSObject();
            r.put("books", books);
            call.resolve(r);
        });
    }

    /** Delete a copied-in book. */
    @PluginMethod
    public void removeIncoming(PluginCall call) {
        String path = call.getString("path", "");
        java.io.File f = new java.io.File(path);
        java.io.File dir = new java.io.File(getContext().getFilesDir(), "books");
        if (f.getAbsolutePath().startsWith(dir.getAbsolutePath())) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
        call.resolve();
    }

    /** Save text as a file where the user chooses (Android's "Save to" screen, Downloads by default). */
    @PluginMethod
    public void saveFile(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(call.getString("mime", "application/json"));
        i.putExtra(Intent.EXTRA_TITLE, call.getString("name", "audiohub-backup.json"));
        startActivityForResult(call, i, "onSaveFile");
    }

    @ActivityCallback
    private void onSaveFile(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = result.getData() != null ? result.getData().getData() : null;
        if (uri == null) {
            call.reject("cancelled");
            return;
        }
        try (java.io.OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) throw new Exception("Couldn't open the file");
            out.write(call.getString("text", "").getBytes(java.nio.charset.StandardCharsets.UTF_8));
            JSObject o = new JSObject();
            o.put("name", nameOf(uri));
            call.resolve(o);
        } catch (Exception e) {
            call.reject("Couldn't save the file: " + e.getMessage());
        }
    }

    /** Let the user pick a file and return its text (for restoring a backup). */
    @PluginMethod
    public void openFile(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        startActivityForResult(call, i, "onOpenFile");
    }

    @ActivityCallback
    private void onOpenFile(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = result.getData() != null ? result.getData().getData() : null;
        if (uri == null) {
            call.reject("cancelled");
            return;
        }
        try (java.io.InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) throw new Exception("Couldn't open the file");
            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
            byte[] b = new byte[1 << 16];
            int n;
            while ((n = in.read(b)) > 0) {
                buf.write(b, 0, n);
                if (buf.size() > 50_000_000) throw new Exception("That file is too big to be a backup");
            }
            JSObject o = new JSObject();
            o.put("text", buf.toString("UTF-8"));
            o.put("name", nameOf(uri));
            call.resolve(o);
        } catch (Exception e) {
            call.reject("Couldn't read the file: " + e.getMessage());
        }
    }

    private String nameOf(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] { android.provider.OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {
        }
        return "";
    }

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
        String pdf = call.getString("pdf", "");
        String data = call.getString("data", "");
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
                // An ebook's own cover image (found inside the EPUB by the app).
                if (bmp == null && !data.isEmpty()) {
                    try {
                        bmp = decodeSmall(android.util.Base64.decode(data, android.util.Base64.DEFAULT));
                    } catch (Exception ignored) {
                    }
                }
                // A PDF: its first page.
                if (bmp == null && !pdf.isEmpty()) bmp = pdfFirstPage(pdf);
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

    private android.graphics.Bitmap pdfFirstPage(String uri) {
        android.os.ParcelFileDescriptor fd = null;
        android.graphics.pdf.PdfRenderer r = null;
        try {
            fd = uri.startsWith("/")
                ? android.os.ParcelFileDescriptor.open(new java.io.File(uri), android.os.ParcelFileDescriptor.MODE_READ_ONLY)
                : getContext().getContentResolver().openFileDescriptor(Uri.parse(uri), "r");
            if (fd == null) return null;
            r = new android.graphics.pdf.PdfRenderer(fd);
            if (r.getPageCount() == 0) return null;
            android.graphics.pdf.PdfRenderer.Page page = r.openPage(0);
            int w = 400;
            int h = Math.max(1, Math.round(w * (float) page.getHeight() / Math.max(1, page.getWidth())));
            android.graphics.Bitmap bmp = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888);
            bmp.eraseColor(android.graphics.Color.WHITE);
            page.render(bmp, null, null, android.graphics.pdf.PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
            page.close();
            return bmp;
        } catch (Exception e) {
            return null;
        } finally {
            try {
                if (r != null) r.close();
            } catch (Exception ignored) {
            }
            try {
                if (fd != null) fd.close();
            } catch (Exception ignored) {
            }
        }
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
                } else if (AUDIO.matcher(name).matches() || EBOOK.matcher(name).matches()) {
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
