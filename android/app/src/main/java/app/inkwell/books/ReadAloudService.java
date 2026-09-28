package app.inkwell.books;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Keeps reading aloud going with the screen off or the app closed, and shows
 * play / pause / previous / next controls in the notification and lock screen.
 */
public class ReadAloudService extends Service {

    private static final String CHANNEL = "kathava-readaloud";
    private static final int ID = 4712;
    private static final String TOGGLE = "toggle";
    private static final String NEXT = "next";
    private static final String PREV = "prev";
    private static final String CLOSE = "close";

    private final Runnable refresh = this::update;
    private boolean foreground = false;

    public static void start(Context c) {
        if (c == null) return;
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(new Intent(c, ReadAloudService.class));
            else c.startService(new Intent(c, ReadAloudService.class));
        } catch (Exception ignored) {
            // Not allowed from the background right now: reading still works while the app is open.
        }
    }

    public static void stop(Context c) {
        if (c != null) c.stopService(new Intent(c, ReadAloudService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Reading aloud", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        ReadAloudEngine.addListener(refresh);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent != null ? intent.getAction() : null;
        if (TOGGLE.equals(a)) ReadAloudEngine.toggle();
        else if (NEXT.equals(a)) ReadAloudEngine.next();
        else if (PREV.equals(a)) ReadAloudEngine.previous();
        else if (CLOSE.equals(a)) {
            ReadAloudEngine.stop();
            stopSelf();
            return START_NOT_STICKY;
        }
        Notification n = build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(ID, n);
        foreground = true;
        return START_NOT_STICKY;
    }

    private void update() {
        if (!foreground) return;
        if (!ReadAloudEngine.isActive()) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(ID, build());
    }

    private Notification.Action action(int icon, String title, String act) {
        PendingIntent pi = PendingIntent.getService(this, act.hashCode(), new Intent(this, ReadAloudService.class).setAction(act),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Action.Builder(icon, title, pi).build();
    }

    private Notification build() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent open = launch == null ? null : PendingIntent.getActivity(this, 0, launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE);
        String chapter = ReadAloudEngine.chapter();
        String text = (chapter.isEmpty() ? "" : chapter + " · ") + "paragraph " + (ReadAloudEngine.para() + 1) + " of " + ReadAloudEngine.total();
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        boolean playing = ReadAloudEngine.isPlaying();
        b.setSmallIcon(android.R.drawable.ic_lock_silent_mode_off)
            .setContentTitle(ReadAloudEngine.title().isEmpty() ? "Reading aloud" : ReadAloudEngine.title())
            .setContentText(text)
            .setOngoing(playing)
            .setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(action(android.R.drawable.ic_media_previous, "Previous", PREV))
            .addAction(playing ? action(android.R.drawable.ic_media_pause, "Pause", TOGGLE) : action(android.R.drawable.ic_media_play, "Play", TOGGLE))
            .addAction(action(android.R.drawable.ic_media_next, "Next", NEXT))
            .addAction(action(android.R.drawable.ic_menu_close_clear_cancel, "Close", CLOSE))
            .setStyle(new Notification.MediaStyle().setShowActionsInCompactView(0, 1, 2));
        if (open != null) b.setContentIntent(open);
        return b.build();
    }

    @Override
    public void onDestroy() {
        ReadAloudEngine.removeListener(refresh);
        foreground = false;
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
