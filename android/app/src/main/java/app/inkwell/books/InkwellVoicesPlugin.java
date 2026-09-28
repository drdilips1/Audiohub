package app.inkwell.books;

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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream;
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream;

/**
 * Built-in neural voices (sherpa-onnx: Kokoro, Piper, Kitten). Voices are
 * downloaded once inside the app, then everything runs offline on the phone.
 * Text is rendered to WAV files that the audiobook player / read-along plays.
 */
@CapacitorPlugin(name = "InkwellVoices")
public class InkwellVoicesPlugin extends Plugin {

    private final ExecutorService downloads = Executors.newSingleThreadExecutor();
    // Voice rendering runs at background priority (its engine threads inherit it),
    // so the screen always gets the CPU first and the app never feels stuck.
    private final ExecutorService synth = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(() -> {
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND);
            r.run();
        }, "kathava-voice");
        return t;
    });

    private File voicesDir() {
        File d = new File(getContext().getFilesDir(), "voices");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    // ---------------------------------------------------------------- catalog

    @PluginMethod
    public void installed(PluginCall call) {
        JSArray arr = new JSArray();
        File[] kids = voicesDir().listFiles();
        if (kids != null) {
            for (File k : kids) {
                if (k.isDirectory() && new File(k, ".ready").exists()) arr.put(k.getName());
            }
        }
        JSObject r = new JSObject();
        r.put("ids", arr);
        call.resolve(r);
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String id = call.getString("id", "");
        synth.execute(() -> {
            SherpaVoice.releaseIf(id);
            deleteTree(new File(voicesDir(), id));
            call.resolve();
        });
    }

    /** Download a .tar.bz2 voice package and unpack it to files/voices/<id>. */
    @PluginMethod
    public void download(PluginCall call) {
        String id = call.getString("id");
        String url = call.getString("url");
        if (id == null || url == null) {
            call.reject("Missing voice id or url");
            return;
        }
        if (id.equals(activeId)) {
            call.reject("ALREADY"); // the app was reopened mid-download: the screen just follows along
            return;
        }
        call.setKeepAlive(true);
        activeId = id;
        activePhase = "download";
        activeGot = 0;
        activeTotal = 0;
        // Keep going when the app is closed: foreground service with a progress notification.
        BackgroundWorkService.start(getContext(), "Downloading voice");
        downloads.execute(() -> {
            File tmp = new File(getContext().getCacheDir(), id + ".tar.bz2.part");
            try {
                // 1. download over several connections at once (like a download manager):
                //    many networks throttle each single connection to GitHub's file servers.
                //    Follows GitHub's redirects; falls back to one stream without range support.
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
                ParallelDownloader.fetch(url, tmp, 6, (got, total) -> progress(id, "download", got, total));
                // 2. unpack; archives contain a single top-level folder
                progress(id, "unpack", 0, 0);
                File target = new File(voicesDir(), id);
                deleteTree(target);
                //noinspection ResultOfMethodCallIgnored
                target.mkdirs();
                try (
                    TarArchiveInputStream tar = new TarArchiveInputStream(
                        new BZip2CompressorInputStream(new BufferedInputStream(new FileInputStream(tmp), 1 << 16))
                    )
                ) {
                    TarArchiveEntry e;
                    byte[] buf = new byte[1 << 16];
                    while ((e = tar.getNextTarEntry()) != null) {
                        String name = e.getName();
                        int slash = name.indexOf('/');
                        String rel = slash >= 0 ? name.substring(slash + 1) : name;
                        if (rel.isEmpty() || rel.contains("..")) continue;
                        File f = new File(target, rel);
                        if (e.isDirectory()) {
                            //noinspection ResultOfMethodCallIgnored
                            f.mkdirs();
                            continue;
                        }
                        File parent = f.getParentFile();
                        //noinspection ResultOfMethodCallIgnored
                        if (parent != null) parent.mkdirs();
                        try (OutputStream out = new FileOutputStream(f)) {
                            int n;
                            while ((n = tar.read(buf)) > 0) out.write(buf, 0, n);
                        }
                    }
                }
                //noinspection ResultOfMethodCallIgnored
                new File(target, ".ready").createNewFile();
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
                progress(id, "done", 1, 1);
                call.resolve();
            } catch (Exception ex) {
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
                deleteTree(new File(voicesDir(), id));
                call.reject(ex.getMessage() != null ? ex.getMessage() : ex.toString());
            } finally {
                call.setKeepAlive(false);
                activeId = null;
                BackgroundWorkService.stop(getContext());
            }
        });
    }

    // The download in progress (survives the screen being reopened).
    private volatile String activeId = null;
    private volatile String activePhase = "";
    private volatile long activeGot = 0;
    private volatile long activeTotal = 0;
    private int lastNotePct = -2;

    @PluginMethod
    public void active(PluginCall call) {
        JSObject o = new JSObject();
        if (activeId != null) {
            o.put("id", activeId);
            o.put("phase", activePhase);
            o.put("received", activeGot);
            o.put("total", activeTotal);
        }
        call.resolve(o);
    }

    private void progress(String id, String phase, long got, long total) {
        activePhase = phase;
        activeGot = got;
        activeTotal = total;
        int pct = "download".equals(phase) && total > 0 ? (int) (got * 100 / total) : -1;
        if (pct != lastNotePct && !"done".equals(phase)) {
            lastNotePct = pct;
            BackgroundWorkService.update(getContext(), "unpack".equals(phase) ? "Unpacking voice…" : "Downloading voice", pct);
        }
        JSObject o = new JSObject();
        o.put("id", id);
        o.put("phase", phase);
        o.put("received", got);
        o.put("total", total);
        notifyListeners("progress", o);
    }

    // -------------------------------------------------------------- synthesis

    private static SherpaVoice.Spec specOf(PluginCall c) {
        SherpaVoice.Spec s = new SherpaVoice.Spec();
        s.id = c.getString("id", "");
        s.type = c.getString("type", "vits");
        s.model = c.getString("model", "model.onnx");
        s.lexicon = c.getString("lexicon", "");
        s.lang = c.getString("lang", "");
        s.speaker = c.getInt("speaker", 0);
        return s;
    }

    /** Render text to a WAV file in the cache folder; resolves { uri }. */
    @PluginMethod
    public void synthesize(PluginCall call) {
        String rel = call.getString("path");
        if (rel == null) {
            call.reject("Missing path");
            return;
        }
        File out = new File(getContext().getCacheDir(), rel);
        if (out.exists() && out.length() > 1024) {
            JSObject o = new JSObject();
            o.put("uri", "file://" + out.getAbsolutePath());
            call.resolve(o);
            return;
        }
        synth.execute(() -> {
            try {
                double secs = SherpaVoice.render(getContext(), specOf(call), call.getString("text", ""), call.getFloat("speed", 1f), out);
                JSObject o = new JSObject();
                o.put("uri", "file://" + out.getAbsolutePath());
                o.put("seconds", secs);
                call.resolve(o);
            } catch (Throwable ex) {
                call.reject(ex.getMessage() != null ? ex.getMessage() : ex.toString());
            }
        });
    }

    @PluginMethod
    public void clearCache(PluginCall call) {
        deleteTree(new File(getContext().getCacheDir(), "voice-audio"));
        call.resolve();
    }

    private static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    @Override
    protected void handleOnDestroy() {
        synth.execute(SherpaVoice::release);
    }
}
