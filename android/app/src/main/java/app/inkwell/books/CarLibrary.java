package app.inkwell.books;

import androidx.annotation.NonNull;
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
import java.util.ArrayList;
import java.util.List;

/**
 * What Android Auto shows when you open the app in the car: the book that's playing, part by
 * part (pick one to jump there), with the usual play / pause / skip controls. Books are
 * chosen on the phone; the car plays and steers what the app has loaded.
 */
@OptIn(markerClass = UnstableApi.class)
public class CarLibrary implements MediaLibraryService.MediaLibrarySession.Callback {

    private static final String ROOT = "root";
    private static final String PART = "part:";

    private static MediaItem folder(String id, String title) {
        return new MediaItem.Builder()
            .setMediaId(id)
            .setMediaMetadata(new MediaMetadata.Builder().setTitle(title).setIsBrowsable(true).setIsPlayable(false).setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_AUDIO_BOOKS).build())
            .build();
    }

    /** The parts loaded in the player, as items the car can list (no addresses: just names). */
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
        if (out.isEmpty()) {
            out.add(new MediaItem.Builder()
                .setMediaId("empty")
                .setMediaMetadata(new MediaMetadata.Builder().setTitle("Start a book on your phone").setSubtitle("It plays and shows here").setIsBrowsable(false).setIsPlayable(false).build())
                .build());
        }
        return out;
    }

    @NonNull
    @Override
    public ListenableFuture<LibraryResult<MediaItem>> onGetLibraryRoot(@NonNull MediaLibraryService.MediaLibrarySession session, @NonNull MediaSession.ControllerInfo browser, MediaLibraryService.LibraryParams params) {
        return Futures.immediateFuture(LibraryResult.ofItem(folder(ROOT, "Now playing"), params));
    }

    @NonNull
    @Override
    public ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> onGetChildren(@NonNull MediaLibraryService.MediaLibrarySession session, @NonNull MediaSession.ControllerInfo browser, @NonNull String parentId, int page, int pageSize, MediaLibraryService.LibraryParams params) {
        return Futures.immediateFuture(LibraryResult.ofItemList(ROOT.equals(parentId) ? parts(session.getPlayer()) : new ArrayList<MediaItem>(), params));
    }

    @NonNull
    @Override
    public ListenableFuture<LibraryResult<MediaItem>> onGetItem(@NonNull MediaLibraryService.MediaLibrarySession session, @NonNull MediaSession.ControllerInfo browser, @NonNull String mediaId) {
        for (MediaItem it : parts(session.getPlayer())) if (it.mediaId.equals(mediaId)) return Futures.immediateFuture(LibraryResult.ofItem(it, null));
        return Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE));
    }

    /**
     * The car picked a part: keep the book as it is (same files and headers) and start at that
     * part — where you left off if it's the part already playing.
     */
    @NonNull
    @Override
    public ListenableFuture<MediaSession.MediaItemsWithStartPosition> onSetMediaItems(@NonNull MediaSession session, @NonNull MediaSession.ControllerInfo controller, @NonNull List<MediaItem> mediaItems, int startIndex, long startPositionMs) {
        Player p = session.getPlayer();
        List<MediaItem> book = new ArrayList<>();
        for (int i = 0; i < p.getMediaItemCount(); i++) book.add(p.getMediaItemAt(i));
        int pick = p.getCurrentMediaItemIndex();
        if (!mediaItems.isEmpty() && mediaItems.get(0).mediaId.startsWith(PART)) {
            try {
                pick = Integer.parseInt(mediaItems.get(0).mediaId.substring(PART.length()));
            } catch (NumberFormatException ignored) {}
        }
        if (pick < 0 || pick >= book.size()) pick = Math.max(0, p.getCurrentMediaItemIndex());
        long at = pick == p.getCurrentMediaItemIndex() ? p.getCurrentPosition() : C.TIME_UNSET;
        return Futures.immediateFuture(new MediaSession.MediaItemsWithStartPosition(book, pick, at));
    }
}
