package app.inkwell.books;

import android.content.Intent;
import androidx.annotation.Nullable;
import androidx.media3.common.Player;
import androidx.media3.session.MediaLibraryService;
import androidx.media3.session.MediaSession;

/**
 * Keeps audiobook playback alive in the background and owns the media
 * notification / lock-screen controls. The player and session are created by
 * {@link InkwellPlayerPlugin}; this service only publishes the session.
 *
 * A library service (not a plain session service), so Android Auto can show the app and
 * browse the book that's playing — see {@link CarLibrary}.
 */
public class PlaybackService extends MediaLibraryService {

    @Nullable
    static MediaLibrarySession session;

    @Override
    public void onCreate() {
        super.onCreate();
        if (session != null) {
            addSession(session);
        }
    }

    @Nullable
    @Override
    public MediaLibrarySession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        MediaSession s = session;
        if (s == null) {
            stopSelf();
            return;
        }
        Player p = s.getPlayer();
        if (!p.getPlayWhenReady() || p.getMediaItemCount() == 0 || p.getPlaybackState() == Player.STATE_ENDED) {
            stopSelf();
        }
    }
}
