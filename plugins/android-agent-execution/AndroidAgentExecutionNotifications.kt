package com.islemind.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build

internal const val AGENT_NOTIFICATION_ID = 42711
private const val CHANNEL_ID = "islemind_agent_execution"

internal object AndroidAgentExecutionNotifications {
  fun manager(context: Context): NotificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  fun canPost(context: Context): Boolean =
      (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
          manager(context).areNotificationsEnabled() &&
          (Build.VERSION.SDK_INT < 26 || manager(context).getNotificationChannel(CHANNEL_ID)?.importance != NotificationManager.IMPORTANCE_NONE)

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    manager(context).createNotificationChannel(NotificationChannel(CHANNEL_ID, "Agent execution", NotificationManager.IMPORTANCE_LOW).apply {
      description = "Shows explicitly enabled Agent execution and waiting state."
      setShowBadge(false)
      enableVibration(false)
      setSound(null, null)
    })
  }

  fun build(context: Context, lease: AgentLease, waiting: Boolean): Notification {
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, CHANNEL_ID)
        else @Suppress("DEPRECATION") Notification.Builder(context)
    val open = openIntent(context, lease.identity.runId)
    builder.setSmallIcon(R.drawable.ic_islemind_agent_execution)
        .setContentTitle("IsleMind Agent")
        // Idle notification is navigation, not a claim about durable run disposition.
        .setContentText(if (waiting) "Open IsleMind to review the latest task status." else "Agent work is running. Open to review.")
        .setContentIntent(open)
        .setCategory(if (waiting) Notification.CATEGORY_STATUS else Notification.CATEGORY_SERVICE)
        .setVisibility(Notification.VISIBILITY_PRIVATE)
        .setOngoing(!waiting)
        .setAutoCancel(waiting)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setLocalOnly(true)
    if (waiting) builder.addAction(Notification.Action.Builder(null, "Open", open).build())
    else builder.addAction(Notification.Action.Builder(null, "Stop", stopIntent(context, lease.identity)).build())
    return builder.build()
  }

  private fun openIntent(context: Context, runId: String): PendingIntent {
    // Stable route identity only. No resume flag, execution token or authorization.
    val route = Uri.Builder().scheme("islemind").authority("agent").appendPath("run").appendPath(runId).build()
    val intent = Intent(context, MainActivity::class.java).apply {
      action = Intent.ACTION_VIEW
      data = route
      addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    return PendingIntent.getActivity(context, AGENT_NOTIFICATION_ID, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun stopIntent(context: Context, identity: AgentLeaseIdentity): PendingIntent {
    val intent = Intent(context, AndroidAgentExecutionStopReceiver::class.java).apply {
      action = "${context.packageName}.AGENT_STOP"
      // Unique native token prevents PendingIntent reuse across service instances.
      data = Uri.Builder().scheme("islemind-agent-stop").authority("lease").appendPath(identity.leaseToken).build()
      putExtra("runId", identity.runId)
      putExtra("generation", identity.generation)
      putExtra("startId", identity.startId)
      putExtra("leaseToken", identity.leaseToken)
    }
    return PendingIntent.getBroadcast(context, AGENT_NOTIFICATION_ID, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }
}
