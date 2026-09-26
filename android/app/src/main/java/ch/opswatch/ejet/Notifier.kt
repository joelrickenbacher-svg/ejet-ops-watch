package ch.opswatch.ejet

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object Notifier {
    private const val CHANNEL = "ejw-alerts"
    private const val GROUP = "ejw-group"
    private const val SUMMARY_ID = 1

    private fun severityLabel(s: String) = when (s) {
        "grounding" -> "Grounding / AOG"
        "limitation" -> "Betriebseinschränkung"
        "inspection" -> "Inspektion / Wartung"
        else -> "Beobachten"
    }

    fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL, ctx.getString(R.string.channel_name), NotificationManager.IMPORTANCE_DEFAULT)
            ch.description = ctx.getString(R.string.channel_desc)
            ctx.getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }

    private fun canNotify(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun openIntent(ctx: Context, issueId: String?, requestCode: Int): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (issueId != null) intent.putExtra(MainActivity.EXTRA_ISSUE, issueId)
        return PendingIntent.getActivity(
            ctx, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    @SuppressLint("MissingPermission")
    fun notify(ctx: Context, changes: List<DataRepository.Change>) {
        if (!canNotify(ctx)) return
        ensureChannel(ctx)
        val nm = NotificationManagerCompat.from(ctx)
        val color = ctx.getColor(R.color.brand)

        changes.take(6).forEach { c ->
            val n = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_plane)
                .setColor(color)
                .setContentTitle((if (c.isNew) "Neu · " else "Aktualisiert · ") + severityLabel(c.severity))
                .setContentText(c.title)
                .setStyle(NotificationCompat.BigTextStyle().bigText(c.title))
                .setContentIntent(openIntent(ctx, c.id, c.id.hashCode()))
                .setAutoCancel(true)
                .setGroup(GROUP)
                .build()
            nm.notify(c.id.hashCode(), n)
        }

        if (changes.size > 1) {
            val summary = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_plane)
                .setColor(color)
                .setContentTitle("${changes.size} Änderungen bei E-Jets")
                .setContentText(changes.joinToString(" · ") { it.title })
                .setContentIntent(openIntent(ctx, null, SUMMARY_ID))
                .setAutoCancel(true)
                .setGroup(GROUP)
                .setGroupSummary(true)
                .build()
            nm.notify(SUMMARY_ID, summary)
        }
    }
}
