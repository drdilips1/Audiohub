package app.inkwell.books;

import java.io.File;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Downloads a file over several connections at once (HTTP Range requests),
 * like a download manager. Many networks throttle each connection, so this is
 * much faster there; servers without Range support get one plain stream.
 * Plain Java (no Android classes) so it can be tested on its own.
 */
public final class ParallelDownloader {

    public interface Progress {
        void onProgress(long done, long total);
    }

    private static final String UA = "Audiohub";

    private ParallelDownloader() {}

    /** Follow redirects by hand (GitHub → its file host changes host) and open the final response. */
    private static HttpURLConnection open(String url, String range) throws Exception {
        String next = url;
        for (int hop = 0; hop < 8; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(next).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(20000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", UA);
            c.setRequestProperty("Accept-Encoding", "identity");
            if (range != null) c.setRequestProperty("Range", range);
            int code = c.getResponseCode();
            String loc = c.getHeaderField("Location");
            if (code >= 300 && code < 400 && loc != null) {
                next = new URL(new URL(next), loc).toString();
                c.disconnect();
                continue;
            }
            if (code >= 400) {
                c.disconnect();
                throw new Exception("HTTP " + code);
            }
            return c;
        }
        throw new Exception("Too many redirects");
    }

    /** Downloads `url` into `dest`; returns the number of bytes written. */
    public static long fetch(String url, File dest, int parts, Progress progress) throws Exception {
        // Probe with a 1-byte range: tells us the size, the final address and whether ranges work.
        HttpURLConnection probe = open(url, "bytes=0-0");
        String finalUrl = probe.getURL().toString();
        long total = -1;
        String cr = probe.getHeaderField("Content-Range"); // "bytes 0-0/18342757"
        boolean ranged = probe.getResponseCode() == 206 && cr != null && cr.contains("/");
        if (ranged) {
            try {
                total = Long.parseLong(cr.substring(cr.lastIndexOf('/') + 1).trim());
            } catch (NumberFormatException e) {
                ranged = false;
            }
        }
        if (!ranged || total < 2_000_000 || parts < 2) {
            // No range support (or a small file): one stream, reusing the probe if it's the whole body.
            HttpURLConnection c = ranged ? open(finalUrl, null) : (probe.getResponseCode() == 200 ? probe : open(url, null));
            if (c != probe) probe.disconnect();
            return single(c, dest, progress);
        }
        probe.disconnect();

        final long size = total;
        try (RandomAccessFile f = new RandomAccessFile(dest, "rw")) {
            f.setLength(size);
        }
        final AtomicLong done = new AtomicLong();
        final AtomicReference<Exception> failure = new AtomicReference<>();
        final long[] lastPct = {-1};
        Thread[] workers = new Thread[parts];
        long chunk = (size + parts - 1) / parts;
        for (int i = 0; i < parts; i++) {
            final long start = i * chunk;
            final long end = Math.min(size, start + chunk) - 1;
            workers[i] = new Thread(() -> {
                long pos = start;
                int tries = 0;
                while (pos <= end && failure.get() == null) {
                    // The final address may be a short-lived signed link: re-resolve from the original on retries.
                    try {
                        HttpURLConnection c = open(tries == 0 ? finalUrl : url, "bytes=" + pos + "-" + end);
                        if (c.getResponseCode() != 206) throw new Exception("Server ignored the range request");
                        try (InputStream in = c.getInputStream(); RandomAccessFile f = new RandomAccessFile(dest, "rw")) {
                            f.seek(pos);
                            byte[] buf = new byte[65536];
                            int n;
                            while (pos <= end && (n = in.read(buf, 0, (int) Math.min(buf.length, end - pos + 1))) > 0) {
                                f.write(buf, 0, n);
                                pos += n;
                                long d = done.addAndGet(n);
                                long pct = d * 100 / size;
                                synchronized (lastPct) {
                                    if (pct != lastPct[0]) {
                                        lastPct[0] = pct;
                                        if (progress != null) progress.onProgress(d, size);
                                    }
                                }
                            }
                        } finally {
                            c.disconnect();
                        }
                        if (pos <= end) throw new Exception("Connection closed early");
                    } catch (Exception e) {
                        if (++tries >= 4) {
                            failure.compareAndSet(null, e);
                            return;
                        }
                        try {
                            Thread.sleep(800L * tries);
                        } catch (InterruptedException ignored) {
                            return;
                        }
                    }
                }
            });
            workers[i].start();
        }
        for (Thread t : workers) t.join();
        if (failure.get() != null) throw failure.get();
        if (done.get() != size) throw new Exception("Download was cut short");
        return size;
    }

    private static long single(HttpURLConnection c, File dest, Progress progress) throws Exception {
        long total = c.getContentLengthLong();
        long done = 0;
        long lastPct = -1;
        try (InputStream in = c.getInputStream(); RandomAccessFile f = new RandomAccessFile(dest, "rw")) {
            f.setLength(0);
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) {
                f.write(buf, 0, n);
                done += n;
                long pct = total > 0 ? done * 100 / total : -1;
                if (pct != lastPct) {
                    lastPct = pct;
                    if (progress != null) progress.onProgress(done, total);
                }
            }
        } finally {
            c.disconnect();
        }
        if (total > 0 && done < total) throw new Exception("Download was cut short");
        return done;
    }
}
