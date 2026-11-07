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
import java.util.List;
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

    // A book the app is preparing for the car: completed when it has loaded (see loaded()).
    @Nullable
    private static SettableFuture<MediaSession.MediaItemsWithStartPosition> pending;
    // The session will set the items it gets back from that: the app already did — skip it.
    static boolean skipNextSet = false;
    // A book playing from the car without the app (its id, for saving the place it reaches).
    @Nullable
    static String carBook = null;

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
            JSONObject o = CarCatalog.find(context, mediaId.substring(BOOK.length()));
            if (o != null) return Futures.immediateFuture(LibraryResult.ofItem(bookItem(o), null));
        }
        for (MediaItem it : parts(session.getPlayer())) if (it.mediaId.equals(mediaId)) return Futures.immediateFuture(LibraryResult.ofItem(it, null));
        return Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE));
    }

    // ---------------------------------------------------------------- search

    @NonNull
    @Override
    public ListenableFuture<LibraryResult<Void>> onSearch(@NonNull MediaLibraryService.MediaLibrarySession session, @NonNull MediaSession.ControllerInfo browser, @NonNull String query, @Nullable MediaLibraryService.LibraryParams params) {
        session.notifySearchResultChanged(browser, query, matches(query).size(), params);
        return Futures.immediateFuture(LibraryResult.ofVoid());
    }

    @NonNull
    @Override
    public ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> onGetSearchResult(@NonNull MediaLibraryService.MediaLibrarySession session, @NonNull MediaSession.ControllerInfo browser, @NonNull String query, int page, int pageSize, @Nullable MediaLibraryService.LibraryParams params) {
        return Futures.immediateFuture(LibraryResult.ofItemList(matches(query), params));
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
        if (id.startsWith(BOOK)) book = CarCatalog.find(context, id.substring(BOOK.length()));
        else if (want != null && want.requestMetadata.searchQuery != null) book = CarCatalog.search(context, want.requestMetadata.searchQuery);
        else if (id.isEmpty()) book = CarCatalog.search(context, "");
        if (book == null) return Futures.immediateFailedFuture(new IllegalArgumentException("Not one of your books"));
        return start(p, book);
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
        if (InkwellPlayerPlugin.carPlay(id)) {
            if (pending != null) pending.setException(new IllegalStateException("Another book was picked"));
            SettableFuture<MediaSession.MediaItemsWithStartPosition> f = SettableFuture.create();
            pending = f;
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                if (pending == f) {
                    pending = null;
                    f.setException(new IllegalStateException("The book didn't load in time"));
                }
            }, 30000);
            return f;
        }
        // The app is closed: a downloaded book plays from its files on the phone.
        JSONArray parts = book.optJSONArray("parts");
        if (parts == null || parts.length() == 0)
            return Futures.immediateFailedFuture(new IllegalStateException("Open AudioYam on your phone once to stream this book"));
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
        int track = Math.max(0, Math.min(items.size() - 1, book.optInt("track", 0)));
        long at = (long) (book.optDouble("time", 0) * 1000);
        carBook = id;
        return Futures.immediateFuture(new MediaSession.MediaItemsWithStartPosition(items, track, at));
    }

    /** The app finished loading the book the car asked for: play exactly that. */
    static void loaded(Player p) {
        SettableFuture<MediaSession.MediaItemsWithStartPosition> f = pending;
        if (f == null) return;
        pending = null;
        carBook = null;
        skipNextSet = true;
        f.set(samePart(p, PART + p.getCurrentMediaItemIndex()));
    }
}
