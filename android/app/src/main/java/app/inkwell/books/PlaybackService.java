package app.inkwell.books;

import android.content.Intent;
import androidx.annotation.Nullable;
import androidx.media3.common.Player;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

/**
 * Keeps audiobook playback alive in the background and owns the media
 * notification / lock-screen controls. The player and session are created by
 * {@link InkwellPlayerPlugin}; this service only publishes the session.
 */
public class PlaybackService extends MediaSessionService {

    @Nullable
    static MediaSession session;

    @Override
    public void onCreate() {
        super.onCreate();
        if (session != null) {
            addSession(session);
        }
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
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
