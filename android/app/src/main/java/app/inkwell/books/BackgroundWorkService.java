package app.inkwell.books;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * Keeps the app alive while a long download runs (e.g. a 330 MB voice), so it
 * carries on when you leave or close the app. Shows its progress as a notification.
 */
public class BackgroundWorkService extends Service {

    private static final String CHANNEL = "kathava-downloads";
    private static final int ID = 4711;
    private PowerManager.WakeLock wake;

    public static void start(Context c, String title) {
        try {
            Intent i = new Intent(c, BackgroundWorkService.class).putExtra("title", title);
            ContextCompat.startForegroundService(c, i);
        } catch (Exception ignored) {
            // Not allowed right now (e.g. started from the background): the work still runs while the app is open.
        }
    }

    /** Update the notification: pct 0..100, or -1 for "working…". */
    public static void update(Context c, String title, int pct) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(ID, build(c, title, pct));
    }

    public static void stop(Context c) {
        c.stopService(new Intent(c, BackgroundWorkService.class));
    }

    private static Notification build(Context c, String title, int pct) {
        channel(c);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW);
        if (pct >= 0) b.setProgress(100, pct, false).setContentText(pct + "%");
        else b.setProgress(0, 0, true);
        return b.build();
    }

    private static void channel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Voice and update downloads that keep going in the background");
            nm.createNotificationChannel(ch);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null && intent.getStringExtra("title") != null ? intent.getStringExtra("title") : "Downloading";
        Notification n = build(this, title, -1);
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(ID, n);
        if (wake == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "kathava:download");
                wake.acquire(60 * 60 * 1000L); // never longer than an hour
            }
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (wake != null && wake.isHeld()) wake.release();
        wake = null;
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
