package app.inkwell.books;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

/**
 * Home-screen widget: "Play a scene" (opens the app listening for the scene to play)
 * and "Drive" (driving mode). Both open the app through its own links.
 */
public class SceneWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_scene);
            views.setOnClickPendingIntent(R.id.widget_scene, open(context, "app.inkwell.books://scene", 1));
            views.setOnClickPendingIntent(R.id.widget_drive, open(context, "app.inkwell.books://drive", 2));
            manager.updateAppWidget(id, views);
        }
    }

    private static PendingIntent open(Context context, String link, int code) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(link));
        intent.setClass(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
