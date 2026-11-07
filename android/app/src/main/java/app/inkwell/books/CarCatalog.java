package app.inkwell.books;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The books Android Auto lists — Continue listening, Recently played, Downloaded — as the app
 * last sent them (kept on the phone, so the car can show them with the app closed), and the
 * places books reached when played from the car without the app (handed back to it later).
 *
 * Item: { id, title, author, artwork, track, time, parts?: [{ url, title }] } — parts only for
 * downloaded books (files on this phone).
 */
final class CarCatalog {
    private static final String PREFS = "audiohub_car";
    private static JSONObject cached;

    private CarCatalog() {}

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void save(Context c, String json) {
        prefs(c).edit().putString("catalog", json).apply();
        cached = null;
    }

    static JSONObject get(Context c) {
        if (cached != null) return cached;
        try {
            cached = new JSONObject(prefs(c).getString("catalog", "{}"));
        } catch (Exception e) {
            cached = new JSONObject();
        }
        return cached;
    }

    static JSONArray list(Context c, String name) {
        JSONArray a = get(c).optJSONArray(name);
        return a != null ? a : new JSONArray();
    }

    /** A book by id, from any of the lists (downloaded first: it has its files). */
    static JSONObject find(Context c, String id) {
        for (String n : new String[] { "downloaded", "continue", "recent" }) {
            JSONArray a = list(c, n);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o != null && id.equals(o.optString("id"))) {
                    // The downloaded entry may lack the place you reached: take it from the others.
                    if (n.equals("downloaded")) {
                        JSONObject other = findIn(c, id, "continue");
                        if (other == null) other = findIn(c, id, "recent");
                        if (other != null) {
                            try {
                                o.put("track", other.optInt("track", o.optInt("track")));
                                o.put("time", other.optDouble("time", o.optDouble("time")));
                            } catch (Exception ignored) {}
                        }
                    }
                    return o;
                }
            }
        }
        return null;
    }

    private static JSONObject findIn(Context c, String id, String name) {
        JSONArray a = list(c, name);
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && id.equals(o.optString("id"))) return o;
        }
        return null;
    }

    /** Best match for a spoken or typed title: every word of the query in title + author. */
    static JSONObject search(Context c, String query) {
        String q = query == null ? "" : query.toLowerCase().trim();
        if (q.isEmpty()) {
            JSONArray a = list(c, "continue");
            return a.length() > 0 ? a.optJSONObject(0) : null;
        }
        String[] words = q.split("[^\\p{L}\\p{N}]+");
        JSONObject best = null;
        int bestScore = 0;
        for (String n : new String[] { "continue", "downloaded", "recent" }) {
            JSONArray a = list(c, n);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null) continue;
                String hay = (o.optString("title") + " " + o.optString("author")).toLowerCase();
                int score = 0;
                for (String w : words) if (!w.isEmpty() && hay.contains(w)) score++;
                if (score > bestScore) {
                    best = o;
                    bestScore = score;
                }
            }
        }
        return best != null && bestScore * 2 >= Math.max(1, words.length) ? best : null;
    }

    /** Where a book got to when it played from the car without the app. */
    static void saveProgress(Context c, String id, int track, double time) {
        try {
            JSONObject all = new JSONObject(prefs(c).getString("progress", "{}"));
            JSONObject p = new JSONObject();
            p.put("track", track);
            p.put("time", time);
            p.put("at", System.currentTimeMillis());
            all.put(id, p);
            prefs(c).edit().putString("progress", all.toString()).apply();
        } catch (Exception ignored) {}
    }

    /** What the car asked for and what happened (the last 20), for Report a problem. No addresses. */
    static void log(Context c, String what) {
        try {
            org.json.JSONArray a = new org.json.JSONArray(prefs(c).getString("log", "[]"));
            a.put(new java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(new java.util.Date()) + " " + what);
            while (a.length() > 20) a.remove(0);
            prefs(c).edit().putString("log", a.toString()).apply();
        } catch (Exception ignored) {}
    }

    static String takeLog(Context c) {
        String s = prefs(c).getString("log", "[]");
        prefs(c).edit().remove("log").apply();
        return s;
    }

    /** Those places, for the app to take in (then forgotten here). */
    static String takeProgress(Context c) {
        String s = prefs(c).getString("progress", "{}");
        prefs(c).edit().remove("progress").apply();
        return s;
    }
}
