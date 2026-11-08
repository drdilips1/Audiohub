package app.inkwell.books;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.session.LibraryResult;
import androidx.media3.session.MediaLibraryService;
import androidx.media3.session.MediaSession;
import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.SettableFuture;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Android Auto: what the car shows and plays.
 *
 * Lists: Now playing (the loaded book, part by part), Continue listening, Recently played and
 * Downloaded. Tap a book, say "play … on AudioYam", or search in the car, and it plays where
 * you left off.
 *
 * How a book starts: with the app running, the app prepares it (as when you tap Play on the
 * phone — streaming links, your place, chapters). With the app closed, a downloaded book plays
 * straight from its files on the phone; a streaming one asks you to open the app once.
 */
@OptIn(markerClass = UnstableApi.class)
public class CarLibrary implements MediaLibraryService.MediaLibrarySession.Callback {

    private static final String ROOT = "root";
    private static final String NOW = "now";
    private static final String PART = "part:";
    private static final String BOOK = "book:";
    private static final String[][] SHELVES = { { "continue", "Continue listening" }, { "recent", "Recently played" }, { "downloaded", "Downloaded" } };

    private final Context context;

    // Network work (your server, the app's search) off the main thread.
    private static final ExecutorService bg = Executors.newCachedThreadPool();
    // Books found by a search in the car (your server's, or the app's from your sources): by id.
    static final Map<String, JSONObject> found = new ConcurrentHashMap<>();
    // The last searches' results, for the car to page through.
    private static final Map<String, List<MediaItem>> searches = new ConcurrentHashMap<>();
    // A book from your server playing in the car without the app: where each part starts, for
    // saving your place there.
    @Nullable
    static double[] absStarts = null;
    static double absTotal = 0;

    /** A book the car knows: from its lists, or found by a search. */
    @Nullable
    private JSONObject find(String id) {
        JSONObject o = CarCatalog.find(context, id);
        return o != null ? o : found.get(id);
    }

    // A book the app is preparing for the car: completed when it has loaded (see loaded()).
    @Nullable
    private static SettableFuture<MediaSession.MediaItemsWithStartPosition> pending;
    // Which book that is (null: a spoken search — whatever the app starts).
    @Nullable
    private static String pendingId = null;
    // The session will set the items it gets back from that: the app already did — skip it.
    // Only for a few seconds: a stale flag would swallow the next pick (a part tapped in the car).
    private static long skipUntil = 0;
    static boolean takeSkip() {
        boolean skip = System.currentTimeMillis() < skipUntil;
        skipUntil = 0;
        return skip;
    }
    private static void skipNext() {
        skipUntil = System.currentTimeMillis() + 5000;
    }
    // A book playing from the car without the app (its id, for saving the place it reaches).
    @Nullable
    static String carBook = null;
    // Saved stream links start at the part you were on: add this to the player's part number.
    static int carTrackOffset = 0;

    CarLibrary(Context context) {
        this.context = context.getApplicationContext();
    }

    // ------------------------------------------------------------------ items

    private static MediaItem folder(String id, String title) {
        return new MediaItem.Builder()
            .setMediaId(id)
            .setMediaMetadata(new MediaMetadata.Builder().setTitle(title).setIsBrowsable(true).setIsPlayable(false).setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_AUDIO_BOOKS).build())
            .build();
    }

    private static MediaItem bookItem(JSONObject o) {
        MediaMetadata.Builder m = new MediaMetadata.Builder()
            .setTitle(o.optString("title", "Audiobook"))
            .setArtist(o.optString("author", ""))
            .setIsBrowsable(false)
            .setIsPlayable(true)
            .setMediaType(MediaMetadata.MEDIA_TYPE_AUDIO_BOOK);
        String art = o.optString("artwork", "");
        if (art.startsWith("http")) m.setArtworkUri(Uri.parse(art));
        return new MediaItem.Builder().setMediaId(BOOK + o.optString("id")).setMediaMetadata(m.build()).build();
    }

    /** The parts loaded in the player, as items the car can list. */
    private static List<MediaItem> parts(Player p) {
        List<MediaItem> out = new ArrayList<>();
        for (int i = 0; i < p.getMediaItemCount(); i++) {
            MediaMetadata m = p.getMediaItemAt(i).mediaMetadata;
            CharSequence title = m.title != null && m.title.length() > 0 ? m.title : "Part " + (i + 1);
            out.add(new MediaItem.Builder()
                .setMediaId(PART + i)
                .setMediaMetadata(m.buildUpon().setTitle(title).setIsBrowsable(false).setIsPlayable(true).setMediaType(MediaMetadata.MEDIA_TYPE_AUDIO_BOOK_CHAPTER).build())
                .build());
        }
        return out;
    }

    private List<MediaItem> shelf(String name) {
        List<MediaItem> out = new ArrayList<>();
        JSONArray a = CarCatalog.list(context, name);
        for (int i = 0; i < a.length() && out.size() < 30; i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && !o.optString("id").isEmpty()) out.add(bookItem(o));
        }
        if (out.isEmpty()) {
            String empty = name.equals("downloaded") ? "No downloaded books yet" : "Books you play show here";
            out.add(new MediaItem.Builder()
                .setMediaId("empty:" + name)
                .setMediaMetadata(new MediaMetadata.Builder().setTitle(empty).setIsBrowsable(false).setIsPlayable(false).build())
                .build());
        }
        return out;
    }

    private List<MediaItem> root(Player p) {
        List<MediaItem> out = new ArrayList<>();
        if (p.getMediaItemCount() > 0) out.add(folder(NOW, "Now playing"));
        for (String[] s : SHELVES) out.add(folder(s[0], s[1]));
        return out;
    }

    // ---------------------------------------------------------------- browse

    @NonNull
    @Override
    public ListenableFuture<LibraryResult<MediaItem>> onGetLibraryRoot(@NonNull MediaLibraryService.MediaLibrarySession session, @NonNull MediaSession.ControllerInfo browser, @Nullable MediaLibraryService.LibraryParams params) {
        return Futures.immediateFuture(LibraryResult.ofItem(folder(ROOT, "AudioYam"), params));
    }

    @NonNull
    @Override
    public ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> onGetChildren(@NonNull MediaLibraryService.MediaLibrarySession session, @NonNull MediaSession.ControllerInfo browser, @NonNull String parentId, int page, int pageSize, @Nullable MediaLibraryService.LibraryParams params) {
        List<MediaItem> list;
        if (ROOT.equals(parentId)) list = root(session.getPlayer());
        else if (NOW.equals(parentId)) list = parts(session.getPlayer());
        else list = shelf(parentId);
        return Futures.immediateFuture(LibraryResult.ofItemList(list, params));
    }

    @NonNull
    @Override
    public ListenableFuture<LibraryResult<MediaItem>> onGetItem(@NonNull MediaLibraryService.MediaLibrarySession session, @NonNull MediaSession.ControllerInfo browser, @NonNull String mediaId) {
        if (mediaId.startsWith(BOOK)) {
            JSONObject o = find(mediaId.substring(BOOK.length()));
            if (o != null) return Futures.immediateFuture(LibraryResult.ofItem(bookItem(o), null));
        }
        for (MediaItem it : parts(session.getPlayer())) if (it.mediaId.equals(mediaId)) return Futures.immediateFuture(LibraryResult.ofItem(it, null));
        return Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE));
    }

    // ---------------------------------------------------------------- search

    /**
     * Search in the car: your lists at once, then your Audiobookshelf (asked directly — works
     * with the app closed), then, with the app running, everything else it searches (your
     * TorBox / Real-Debrid, phone folders, sources). The car is told when the list is ready.
     */
    @NonNull
    @Override
    public ListenableFuture<LibraryResult<Void>> onSearch(@NonNull MediaLibraryService.MediaLibrarySession session, @NonNull MediaSession.ControllerInfo browser, @NonNull String query, @Nullable MediaLibraryService.LibraryParams params) {
        List<MediaItem> mine = matches(query);
        searches.put(query, mine);
        session.notifySearchResultChanged(browser, query, mine.size(), params);
        bg.execute(() -> {
            List<MediaItem> all = new ArrayList<>(mine);
            List<String> ids = new ArrayList<>();
            for (MediaItem m : mine) ids.add(m.mediaId);
            for (JSONObject o : CarAbs.search(context, query)) add(all, ids, o);
            if (InkwellPlayerPlugin.isRunning()) for (JSONObject o : InkwellPlayerPlugin.carSearch(query, 12000)) add(all, ids, o);
            CarCatalog.log(context, "search in the car: “" + query + "” — " + all.size() + " found");
            searches.put(query, all);
            new Handler(Looper.getMainLooper()).post(() -> session.notifySearchResultChanged(browser, query, all.size(), params));
        });
        return Futures.immediateFuture(LibraryResult.ofVoid());
    }

    private static void add(List<MediaItem> list, List<String> ids, JSONObject o) {
        String id = o.optString("id");
        if (id.isEmpty() || ids.contains(BOOK + id) || list.size() >= 30) return;
        found.put(id, o);
        list.add(bookItem(o));
        ids.add(BOOK + id);
    }

    @NonNull
    @Override
    public ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> onGetSearchResult(@NonNull MediaLibraryService.MediaLibrarySession session, @NonNull MediaSession.ControllerInfo browser, @NonNull String query, int page, int pageSize, @Nullable MediaLibraryService.LibraryParams params) {
        List<MediaItem> list = searches.get(query);
        return Futures.immediateFuture(LibraryResult.ofItemList(list != null ? list : matches(query), params));
    }

    /** Your books whose title or author has a word of the query. */
    private List<MediaItem> matches(String query) {
        List<MediaItem> out = new ArrayList<>();
        List<String> seen = new ArrayList<>();
        String[] words = String.valueOf(query).toLowerCase().split("[^\\p{L}\\p{N}]+");
        for (String[] s : SHELVES) {
            JSONArray a = CarCatalog.list(context, s[0]);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null || seen.contains(o.optString("id"))) continue;
                String hay = (o.optString("title") + " " + o.optString("author")).toLowerCase();
                for (String w : words) {
                    if (w.length() > 1 && hay.contains(w)) {
                        out.add(bookItem(o));
                        seen.add(o.optString("id"));
                        break;
                    }
                }
            }
        }
        return out;
    }

    // ------------------------------------------------------------------ play

    /**
     * The car picked something: a part of the book that's loaded, a book from a list, or a
     * spoken / typed search ("play Atomic Habits on AudioYam").
     */
    @NonNull
    @Override
    public ListenableFuture<MediaSession.MediaItemsWithStartPosition> onSetMediaItems(@NonNull MediaSession session, @NonNull MediaSession.ControllerInfo controller, @NonNull List<MediaItem> mediaItems, int startIndex, long startPositionMs) {
        Player p = session.getPlayer();
        MediaItem want = mediaItems.isEmpty() ? null : mediaItems.get(0);
        String id = want == null ? "" : want.mediaId;
        if (id.startsWith(PART)) return Futures.immediateFuture(samePart(p, id));
        JSONObject book = null;
        if (id.startsWith(BOOK)) book = find(id.substring(BOOK.length()));
        else if (want != null && want.requestMetadata.searchQuery != null) book = CarCatalog.search(context, want.requestMetadata.searchQuery);
        else if (id.isEmpty()) book = CarCatalog.search(context, "");
        // Said in the car and not in your lists: your server (asked directly), then — with the
        // app running — everything else (your Library, cloud, sources) and the best match plays.
        if (book == null && want != null && want.requestMetadata.searchQuery != null && !want.requestMetadata.searchQuery.trim().isEmpty()) {
            return voice(p, want.requestMetadata.searchQuery);
        }
        if (book == null) {
            CarCatalog.log(context, "picked something that isn't one of your books (" + (id.isEmpty() && want != null ? "search: " + want.requestMetadata.searchQuery : id) + ")");
            return Futures.immediateFailedFuture(new IllegalArgumentException("Not one of your books"));
        }
        return start(p, book);
    }

    /** "Play … on AudioYam" for a book not in your lists. */
    private ListenableFuture<MediaSession.MediaItemsWithStartPosition> voice(Player p, String q) {
        SettableFuture<MediaSession.MediaItemsWithStartPosition> out = SettableFuture.create();
        bg.execute(() -> {
            JSONObject best = bestOnServer(q);
            new Handler(Looper.getMainLooper()).post(() -> {
                if (best != null) {
                    CarCatalog.log(context, "voice in the car: “" + q + "” → “" + best.optString("title") + "” on your Audiobookshelf");
                    found.put(best.optString("id"), best);
                    out.setFuture(start(p, best));
                } else if (InkwellPlayerPlugin.isRunning()) {
                    CarCatalog.log(context, "voice in the car: “" + q + "” — the app is looking in your library and sources");
                    ListenableFuture<MediaSession.MediaItemsWithStartPosition> f = waitForApp(q, null, p);
                    InkwellPlayerPlugin.voicePlay(context, q);
                    out.setFuture(f);
                } else {
                    CarCatalog.log(context, "voice in the car: “" + q + "” — not on your server, and the app isn't running to search your other sources");
                    out.setException(new IllegalStateException("Not found on your Audiobookshelf — open AudioYam to search your other sources"));
                }
            });
        });
        return out;
    }

    /** Your server's book for spoken words, if one clearly fits (most of the words in its title). */
    @Nullable
    private JSONObject bestOnServer(String q) {
        List<JSONObject> hits = CarAbs.search(context, q.replaceAll("(?i)\\b(on|in) audio ?(hub|yam)\\+?.*$", "").trim());
        String[] words = q.toLowerCase().split("[^\\p{L}\\p{N}]+");
        JSONObject best = null;
        double bestScore = 0;
        for (JSONObject o : hits) {
            String title = o.optString("title").toLowerCase();
            String hay = title + " " + o.optString("author").toLowerCase();
            String[] tw = title.split("[^\\p{L}\\p{N}]+");
            int inTitle = 0, all = 0, said = 0;
            for (String w : tw) if (w.length() > 2 && q.toLowerCase().contains(w)) inTitle++;
            for (String w : words) {
                if (w.length() <= 2) continue;
                said++;
                if (hay.contains(w)) all++;
            }
            int titleWords = 0;
            for (String w : tw) if (w.length() > 2) titleWords++;
            double score = (titleWords == 0 ? 0 : (double) inTitle / titleWords) * 0.6 + (said == 0 ? 0 : (double) all / said) * 0.4;
            if (score > bestScore) {
                bestScore = score;
                best = o;
            }
        }
        return bestScore >= 0.6 ? best : null;
    }

    /** A book from your server, played in the car straight from the server (the app closed). */
    private ListenableFuture<MediaSession.MediaItemsWithStartPosition> playFromServer(JSONObject book) {
        SettableFuture<MediaSession.MediaItemsWithStartPosition> out = SettableFuture.create();
        String id = book.optString("id");
        String itemId = id.substring("abs:".length());
        bg.execute(() -> {
            try {
                JSONObject it = CarAbs.item(context, itemId);
                double at = CarAbs.place(context, itemId);
                JSONArray tr = it.getJSONArray("tracks");
                List<MediaItem> items = new ArrayList<>();
                double[] starts = new double[tr.length()];
                int track = 0;
                long offsetMs = 0;
                for (int i = 0; i < tr.length(); i++) {
                    JSONObject t = tr.getJSONObject(i);
                    starts[i] = t.optDouble("start", 0);
                    if (at >= starts[i] && (at < starts[i] + t.optDouble("duration", 0) || i == tr.length() - 1)) {
                        track = i;
                        offsetMs = (long) ((at - starts[i]) * 1000);
                    }
                    MediaMetadata.Builder m = new MediaMetadata.Builder()
                        .setTitle(t.optString("title", "Part " + (i + 1)))
                        .setArtist(it.optString("author", book.optString("author")))
                        .setAlbumTitle(it.optString("title", book.optString("title")));
                    items.add(new MediaItem.Builder().setMediaId(PART + i).setUri(t.optString("url")).setMediaMetadata(m.build()).build());
                }
                JSONObject headers = new JSONObject();
                headers.put("Authorization", "Bearer " + CarAbs.token(context));
                final int startTrack = track;
                final long startMs = offsetMs;
                new Handler(Looper.getMainLooper()).post(() -> {
                    PlaybackService.carHeaders = headers;
                    carBook = id;
                    carTrackOffset = 0;
                    absStarts = starts;
                    absTotal = it.optDouble("total", 0);
                    CarCatalog.log(context, "playing “" + book.optString("title") + "” from your Audiobookshelf (app closed) — " + items.size() + " parts, from " + Math.round(at / 60) + " min");
                    out.set(new MediaSession.MediaItemsWithStartPosition(items, startTrack, startMs));
                });
            } catch (Exception e) {
                CarCatalog.log(context, "couldn't open “" + book.optString("title") + "” on your Audiobookshelf: " + e.getMessage());
                out.setException(e);
            }
        });
        return out;
    }

    /** "Play" pressed in the car with nothing chosen: the book you were last listening to. */
    @NonNull
    @Override
    public ListenableFuture<MediaSession.MediaItemsWithStartPosition> onPlaybackResumption(@NonNull MediaSession session, @NonNull MediaSession.ControllerInfo controller) {
        Player p = session.getPlayer();
        if (p.getMediaItemCount() > 0) return Futures.immediateFuture(samePart(p, PART + p.getCurrentMediaItemIndex()));
        JSONObject book = CarCatalog.search(context, "");
        if (book == null) return Futures.immediateFailedFuture(new IllegalStateException("Nothing to resume"));
        return start(p, book);
    }

    private static MediaSession.MediaItemsWithStartPosition samePart(Player p, String id) {
        List<MediaItem> loaded = new ArrayList<>();
        for (int i = 0; i < p.getMediaItemCount(); i++) loaded.add(p.getMediaItemAt(i));
        int pick = p.getCurrentMediaItemIndex();
        try {
            pick = Integer.parseInt(id.substring(PART.length()));
        } catch (Exception ignored) {}
        if (pick < 0 || pick >= loaded.size()) pick = Math.max(0, p.getCurrentMediaItemIndex());
        long at = pick == p.getCurrentMediaItemIndex() ? p.getCurrentPosition() : C.TIME_UNSET;
        return new MediaSession.MediaItemsWithStartPosition(loaded, pick, at);
    }

    private ListenableFuture<MediaSession.MediaItemsWithStartPosition> start(Player p, JSONObject book) {
        String id = book.optString("id");
        // The app is running: it prepares the book (links, your place), then we play what it loaded.
        String title = book.optString("title", id);
        // Already the book in the player (most often: the top of Continue listening): just play
        // it from where it is — nothing to prepare.
        if (InkwellPlayerPlugin.isRunning() && id.equals(InkwellPlayerPlugin.currentBookId) && p.getMediaItemCount() > 0) {
            CarCatalog.log(context, "picked “" + title + "” — already loaded, playing");
            skipNext();
            return Futures.immediateFuture(samePart(p, PART + p.getCurrentMediaItemIndex()));
        }
        if (InkwellPlayerPlugin.isRunning()) {
            ListenableFuture<MediaSession.MediaItemsWithStartPosition> f = waitForApp(title, id, p);
            if (InkwellPlayerPlugin.carPlay(id, book)) {
                CarCatalog.log(context, "picked “" + title + "” — the app is preparing it");
                return f;
            }
            cancelPending();
        }
        // The app is closed. A book on your server plays straight from it (unless it's downloaded).
        JSONArray parts = book.optJSONArray("parts");
        if (id.startsWith("abs:") && (parts == null || parts.length() == 0) && CarAbs.connected(context)) return playFromServer(book);
        // Found by the app's search (your cloud, a source): only the app can fetch that.
        if (id.startsWith("src:")) {
            CarCatalog.log(context, "picked “" + title + "” from a search, but the app isn't running to fetch it");
            return Futures.immediateFailedFuture(new IllegalStateException("Open AudioYam on your phone to play this"));
        }
        // A downloaded book plays from its files on the phone; else from the stream links saved
        // when it last played in the app (they may have expired).
        boolean saved = false;
        int offset = 0; // the book's part number of the first saved link
        int track0 = book.optInt("track", 0);
        if (parts == null || parts.length() == 0) {
            JSONObject st = book.optJSONObject("stream");
            JSONArray sp = st != null ? st.optJSONArray("parts") : null;
            if (sp != null && sp.length() > 0) {
                parts = new JSONArray();
                int first = -1;
                for (int i = 0; i < sp.length(); i++) {
                    JSONObject x = sp.optJSONObject(i);
                    if (x == null) continue;
                    // From the part you were on, onwards (earlier parts aren't needed to resume).
                    if (x.optInt("i", i) < track0) continue;
                    if (first < 0) first = x.optInt("i", i);
                    parts.put(x);
                }
                if (parts.length() > 0) {
                    saved = true;
                    offset = first;
                    PlaybackService.carHeaders = st.optJSONObject("headers");
                    // Positions count from the first saved part now.
                    track0 = first == book.optInt("track", 0) ? 0 : -1;
                }
            }
        }
        if (parts == null || parts.length() == 0) {
            CarCatalog.log(context, "picked “" + title + "” with the app closed — not downloaded and no saved links yet, so it needs the app once");
            return Futures.immediateFailedFuture(new IllegalStateException("Open AudioYam on your phone once to stream this book"));
        }
        List<MediaItem> items = new ArrayList<>();
        for (int i = 0; i < parts.length(); i++) {
            JSONObject t = parts.optJSONObject(i);
            if (t == null || t.optString("url").isEmpty()) continue;
            MediaMetadata.Builder m = new MediaMetadata.Builder()
                .setTitle(t.optString("title", "Part " + (i + 1)))
                .setArtist(book.optString("author", ""))
                .setAlbumTitle(book.optString("title", ""));
            String art = book.optString("artwork", "");
            if (art.startsWith("http")) m.setArtworkUri(Uri.parse(art));
            items.add(new MediaItem.Builder().setMediaId(PART + i).setUri(t.optString("url")).setMediaMetadata(m.build()).build());
        }
        if (items.isEmpty()) return Futures.immediateFailedFuture(new IllegalStateException("This book's files weren't found"));
        int track = saved ? 0 : Math.max(0, Math.min(items.size() - 1, book.optInt("track", 0)));
        long at = saved && track0 < 0 ? 0 : (long) (book.optDouble("time", 0) * 1000);
        carBook = id;
        absStarts = null;
        carTrackOffset = saved ? offset : 0;
        if (!saved) PlaybackService.carHeaders = null;
        CarCatalog.touch(context, id, book.optInt("track", 0), book.optDouble("time", 0));
        CarCatalog.log(context, "picked “" + title + "” with the app closed — " + (saved ? "playing from its saved stream links (" + items.size() + " parts)" : "playing its downloaded files (" + items.size() + " parts)"));
        return Futures.immediateFuture(new MediaSession.MediaItemsWithStartPosition(items, track, at));
    }

    /**
     * Until the app has started the book (it calls loaded()). A slow start (a torrent being
     * fetched, the phone's screen off for a while) doesn't fail the car: after 40 s it shows
     * what the player has, and the book takes over there as soon as the app has it.
     */
    private ListenableFuture<MediaSession.MediaItemsWithStartPosition> waitForApp(String title, @Nullable String id, Player p) {
        if (pending != null) pending.setException(new IllegalStateException("Another book was picked"));
        SettableFuture<MediaSession.MediaItemsWithStartPosition> f = SettableFuture.create();
        pending = f;
        pendingId = id;
        final long t0 = System.currentTimeMillis();
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (pending != f) return;
            pending = null;
            pendingId = null;
            if (p.getMediaItemCount() > 0) {
                CarCatalog.log(context, "“" + title + "” is taking long (" + (System.currentTimeMillis() - t0) / 1000 + " s) — the car shows the player meanwhile");
                skipNext();
                f.set(samePart(p, PART + p.getCurrentMediaItemIndex()));
            } else {
                CarCatalog.log(context, "“" + title + "” didn't start within 40 s");
                f.setException(new IllegalStateException("The book didn't load in time"));
            }
        }, 40000);
        return f;
    }

    private static void cancelPending() {
        SettableFuture<MediaSession.MediaItemsWithStartPosition> f = pending;
        pending = null;
        pendingId = null;
        if (f != null) f.setException(new IllegalStateException("Cancelled"));
    }

    /**
     * The app loaded a book (bookId: which one; null when unknown): if it's the one the car asked
     * for, play exactly that there. Another book loading meanwhile (the app restoring the last
     * one, say) doesn't count.
     */
    static void loaded(Player p, @Nullable String bookId) {
        SettableFuture<MediaSession.MediaItemsWithStartPosition> f = pending;
        if (f == null) return;
        if (pendingId != null && bookId != null && !pendingId.equals(bookId)) return;
        pending = null;
        pendingId = null;
        carBook = null;
        skipNext();
        f.set(samePart(p, PART + p.getCurrentMediaItemIndex()));
    }
}
