package app.inkwell.books;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.annotation.Nullable;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Your Audiobookshelf server, for the car — without the app's screen (it can be closed):
 * search it, open a book's audio files and your place in it, and save the place back.
 *
 * The app hands over the server's addresses and your sign-in (setCarAbs) whenever they change,
 * and takes back a renewed sign-in (takeCarAbs) if this side had to renew it.
 */
public final class CarAbs {

    private static final String PREFS = "audiohub_car_abs";
    private CarAbs() {}

    // ---------------------------------------------------------------- settings

    static void save(Context c, String json) {
        prefs(c).edit().putString("cfg", json == null ? "" : json).apply();
    }

    /** { server, altServer, token, refreshToken, libraryIds: [], at } or null when not connected. */
    @Nullable
    static JSONObject cfg(Context c) {
        try {
            JSONObject o = new JSONObject(prefs(c).getString("cfg", "{}"));
            return o.optString("server").isEmpty() || o.optString("token").isEmpty() ? null : o;
        } catch (Exception e) {
            return null;
        }
    }

    static boolean connected(Context c) {
        return cfg(c) != null;
    }

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // Which address answered last (home LAN or Tailscale / public): tried first next time.
    @Nullable
    private static String active = null;

    private static List<String> addresses(JSONObject cfg) {
        List<String> out = new ArrayList<>();
        String a = trim(cfg.optString("server"));
        String b = trim(cfg.optString("altServer"));
        if (active != null && (active.equals(a) || active.equals(b))) out.add(active);
        if (!a.isEmpty() && !out.contains(a)) out.add(a);
        if (!b.isEmpty() && !out.contains(b)) out.add(b);
        return out;
    }

    private static String trim(String u) {
        return u == null ? "" : u.replaceAll("/+$", "");
    }

    /** The address in use (for stream links), after a request found one that answers. */
    static String base(Context c) {
        JSONObject cfg = cfg(c);
        if (cfg == null) return "";
        return addresses(cfg).isEmpty() ? "" : addresses(cfg).get(0);
    }

    static String token(Context c) {
        JSONObject cfg = cfg(c);
        return cfg == null ? "" : cfg.optString("token");
    }

    // ---------------------------------------------------------------- requests

    static final class HttpError extends Exception {
        final int status;

        HttpError(int status, String msg) {
            super(msg);
            this.status = status;
        }
    }

    /** A request to the server, on whichever address answers; a sign-in that ran out is renewed once. */
    static String call(Context c, String method, String path, @Nullable String body) throws Exception {
        try {
            return callOnce(c, method, path, body);
        } catch (HttpError e) {
            if (e.status != 401 || !renew(c)) throw e;
            return callOnce(c, method, path, body);
        }
    }

    private static String callOnce(Context c, String method, String path, @Nullable String body) throws Exception {
        JSONObject cfg = cfg(c);
        if (cfg == null) throw new Exception("Audiobookshelf isn't connected");
        Exception last = null;
        for (String base : addresses(cfg)) {
            try {
                String r = http(method, base + path, cfg.optString("token"), body, null);
                active = base;
                return r;
            } catch (HttpError e) {
                active = base; // it answered: the request itself was refused
                throw e;
            } catch (Exception e) {
                last = e; // didn't answer: try the other address
            }
        }
        throw last != null ? last : new Exception("No server address");
    }

    private static String http(String method, String url, String token, @Nullable String body, @Nullable String refresh) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        try {
            conn.setRequestMethod(method);
            conn.setConnectTimeout(4000);
            conn.setReadTimeout(12000);
            if (token != null && !token.isEmpty()) conn.setRequestProperty("Authorization", "Bearer " + token);
            if (refresh != null) conn.setRequestProperty("x-refresh-token", refresh);
            conn.setRequestProperty("Accept", "application/json");
            if (body != null) {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(body.getBytes("UTF-8"));
                }
            }
            int code = conn.getResponseCode();
            InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String text = in == null ? "" : read(in);
            if (code >= 400) throw new HttpError(code, "HTTP " + code);
            return text;
        } finally {
            conn.disconnect();
        }
    }

    private static String read(InputStream in) throws Exception {
        try (InputStream s = in) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = s.read(buf)) > 0) b.write(buf, 0, n);
            return b.toString("UTF-8");
        }
    }

    /**
     * A short-lived sign-in (Audiobookshelf 2.26+) ran out: renew it — only with the app not
     * running (the app renews its own, and two renewals at once would sign you out). The new
     * one is kept here and given back to the app when it next asks (takeCarAbs).
     */
    private static boolean renew(Context c) {
        JSONObject cfg = cfg(c);
        if (cfg == null || cfg.optString("refreshToken").isEmpty()) return false;
        if (InkwellPlayerPlugin.isRunning()) {
            InkwellPlayerPlugin.askAbsRenew();
            try {
                Thread.sleep(4000); // the app renews and hands over the new sign-in
            } catch (InterruptedException ignored) {}
            JSONObject now = cfg(c);
            return now != null && !now.optString("token").equals(cfg.optString("token"));
        }
        for (String base : addresses(cfg)) {
            try {
                JSONObject r = new JSONObject(http("POST", base + "/auth/refresh", null, null, cfg.optString("refreshToken")));
                JSONObject user = r.optJSONObject("user");
                String token = user != null ? user.optString("accessToken") : "";
                if (token.isEmpty()) return false;
                cfg.put("token", token);
                if (user != null && !user.optString("refreshToken").isEmpty()) cfg.put("refreshToken", user.optString("refreshToken"));
                cfg.put("renewedAt", System.currentTimeMillis());
                save(c, cfg.toString());
                return true;
            } catch (HttpError e) {
                return false;
            } catch (Exception ignored) {}
        }
        return false;
    }

    // ---------------------------------------------------------------- the car's needs

    /** Books on your server matching the words: [{ id: "abs:<item>", title, author }]. */
    static List<JSONObject> search(Context c, String query) {
        List<JSONObject> out = new ArrayList<>();
        JSONObject cfg = cfg(c);
        if (cfg == null || query == null || query.trim().isEmpty()) return out;
        JSONArray libs = cfg.optJSONArray("libraryIds");
        if (libs == null) return out;
        List<String> seen = new ArrayList<>();
        for (int i = 0; i < libs.length(); i++) {
            try {
                String q = URLEncoder.encode(query.trim(), "UTF-8");
                JSONObject r = new JSONObject(call(c, "GET", "/api/libraries/" + libs.getString(i) + "/search?limit=12&q=" + q, null));
                JSONArray books = r.optJSONArray("book");
                if (books == null) continue;
                for (int k = 0; k < books.length(); k++) {
                    JSONObject li = books.getJSONObject(k).optJSONObject("libraryItem");
                    if (li == null || seen.contains(li.optString("id"))) continue;
                    JSONObject media = li.optJSONObject("media");
                    // Ebook-only items have no audio: nothing for the car.
                    if (media != null && media.has("numAudioFiles") && media.optInt("numAudioFiles") == 0) continue;
                    if (media != null && media.optJSONArray("audioFiles") != null && media.optJSONArray("audioFiles").length() == 0) continue;
                    JSONObject md = media != null ? media.optJSONObject("metadata") : null;
                    JSONObject o = new JSONObject();
                    o.put("id", "abs:" + li.optString("id"));
                    o.put("title", md != null ? md.optString("title", "Audiobook") : "Audiobook");
                    o.put("author", md != null ? md.optString("authorName", "") : "");
                    o.put("server", true);
                    out.add(o);
                    seen.add(li.optString("id"));
                }
            } catch (Exception e) {
                CarCatalog.log(c, "Audiobookshelf search didn't work: " + e.getMessage());
            }
        }
        return out;
    }

    /** A book's audio files as stream links, in order: { tracks: [{ url, title, start, duration }], total }. */
    static JSONObject item(Context c, String itemId) throws Exception {
        JSONObject li = new JSONObject(call(c, "GET", "/api/items/" + itemId + "?expanded=1", null));
        JSONObject media = li.optJSONObject("media");
        JSONArray tracks = media != null ? media.optJSONArray("tracks") : null;
        if (tracks == null || tracks.length() == 0) throw new Exception("This book has no audio files on your server");
        String base = base(c);
        JSONArray out = new JSONArray();
        double total = 0;
        for (int i = 0; i < tracks.length(); i++) {
            JSONObject t = tracks.getJSONObject(i);
            String path = t.optString("contentUrl");
            if (path.isEmpty()) continue;
            JSONObject o = new JSONObject();
            o.put("url", path.startsWith("http") ? path : base + path);
            o.put("title", t.optString("title", "Part " + (i + 1)));
            o.put("start", t.optDouble("startOffset", total));
            o.put("duration", t.optDouble("duration", 0));
            total = Math.max(total, t.optDouble("startOffset", total) + t.optDouble("duration", 0));
            out.put(o);
        }
        JSONObject r = new JSONObject();
        r.put("tracks", out);
        r.put("total", total);
        JSONObject md = media.optJSONObject("metadata");
        r.put("title", md != null ? md.optString("title") : "");
        r.put("author", md != null ? md.optString("authorName") : "");
        return r;
    }

    /** Your place in the book on the server (seconds), 0 when none. */
    static double place(Context c, String itemId) {
        try {
            JSONObject p = new JSONObject(call(c, "GET", "/api/me/progress/" + itemId, null));
            return p.optBoolean("isFinished") ? 0 : p.optDouble("currentTime", 0);
        } catch (Exception e) {
            return 0;
        }
    }

    /** Save your place to the server (in the background). */
    static void savePlace(Context c, String itemId, double time, double total) {
        new Thread(() -> {
            try {
                JSONObject b = new JSONObject();
                b.put("currentTime", time);
                b.put("duration", total);
                b.put("progress", total > 0 ? Math.min(1, time / total) : 0);
                b.put("isFinished", total > 0 && time >= total - 5);
                call(c, "PATCH", "/api/me/progress/" + itemId, b.toString());
            } catch (Exception ignored) {}
        }).start();
    }
}
