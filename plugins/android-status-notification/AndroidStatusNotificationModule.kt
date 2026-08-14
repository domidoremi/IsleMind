package com.islemind.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule
import kotlin.math.roundToInt

@ReactModule(name = AndroidStatusNotificationModule.NAME)
class AndroidStatusNotificationModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun getPermissionStatus(promise: Promise) {
    promise.resolve(permissionStatusMap())
  }

  @ReactMethod
  fun updateStatus(payloadMap: ReadableMap, promise: Promise) {
    if (!AndroidStatusNotificationSupport.canPostNotifications(reactContext)) {
      promise.resolve(resultMap(shown = false, reason = "permission_denied"))
      return
    }

    val payload = AndroidStatusNotificationPayload.fromReadableMap(payloadMap)
    val requestPromotedOngoing = AndroidStatusNotificationSupport.shouldRequestPromotedOngoing(payload)
    var foregroundServiceStarted = false
    var foregroundServiceError: Exception? = null

    try {
      AndroidStatusNotificationSupport.ensureChannel(reactContext)
      val notification = AndroidStatusNotificationSupport.buildNotification(reactContext, payload, requestPromotedOngoing)
      var notificationPosted = false
      if (payload.foregroundService == true) {
        if (payload.effectiveOngoing()) {
          try {
            AndroidStatusNotificationSupport.notificationManager(reactContext).notify(NOTIFICATION_ID, notification)
            notificationPosted = true
            startForegroundStatus(payload, requestPromotedOngoing)
            foregroundServiceStarted = true
          } catch (error: Exception) {
            foregroundServiceError = error
          }
        } else {
          stopForegroundStatus()
        }
      }

      if (!notificationPosted) {
        AndroidStatusNotificationSupport.notificationManager(reactContext).notify(
            NOTIFICATION_ID,
            notification
        )
      }

      promise.resolve(
          resultMap(
              shown = true,
              reason = "shown",
              backgroundReliable = foregroundServiceStarted,
              foregroundServiceStarted = foregroundServiceStarted,
              promotedOngoingRequested = requestPromotedOngoing,
              promotedNotificationState = AndroidStatusNotificationSupport.promotedNotificationState(requestPromotedOngoing, reactContext),
              canPostPromotedNotifications = AndroidStatusNotificationSupport.canPostPromotedNotifications(reactContext),
              errorMessage = foregroundServiceError?.message
          )
      )
    } catch (error: Exception) {
      promise.reject("android_status_notification_failed", error.message, error)
    }
  }

  @ReactMethod
  fun clearStatus(promise: Promise) {
    stopForegroundStatus()
    AndroidStatusNotificationSupport.notificationManager(reactContext).cancel(NOTIFICATION_ID)
    promise.resolve(resultMap(shown = false, reason = "cleared"))
  }

  private fun startForegroundStatus(payload: AndroidStatusNotificationPayload, requestPromotedOngoing: Boolean) {
    val intent = Intent(reactContext, AndroidStatusNotificationService::class.java).apply {
      putStatusPayloadExtras(payload, requestPromotedOngoing)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      reactContext.startForegroundService(intent)
    } else {
      reactContext.startService(intent)
    }
  }

  private fun stopForegroundStatus() {
    reactContext.stopService(Intent(reactContext, AndroidStatusNotificationService::class.java))
  }

  private fun permissionStatusMap() = Arguments.createMap().apply {
    putBoolean("available", true)
    putBoolean("granted", AndroidStatusNotificationSupport.canPostNotifications(reactContext))
    putBoolean("backgroundReliable", false)
    putInt("androidApiLevel", Build.VERSION.SDK_INT)
    putBoolean("promotedNotificationsAvailable", Build.VERSION.SDK_INT >= PROMOTED_NOTIFICATIONS_API_LEVEL)
    val canPostPromoted = AndroidStatusNotificationSupport.canPostPromotedNotifications(reactContext)
    if (canPostPromoted == null) {
      putNull("canPostPromotedNotifications")
    } else {
      putBoolean("canPostPromotedNotifications", canPostPromoted)
    }
  }

  private fun resultMap(
      shown: Boolean,
      reason: String,
      backgroundReliable: Boolean = false,
      foregroundServiceStarted: Boolean = false,
      promotedOngoingRequested: Boolean = false,
      promotedNotificationState: String = "not_requested",
      canPostPromotedNotifications: Boolean? = null,
      errorMessage: String? = null
  ) = Arguments.createMap().apply {
    putBoolean("shown", shown)
    putString("reason", reason)
    putBoolean("backgroundReliable", backgroundReliable)
    putBoolean("foregroundServiceStarted", foregroundServiceStarted)
    putBoolean("promotedOngoingRequested", promotedOngoingRequested)
    putString("promotedNotificationState", promotedNotificationState)
    if (canPostPromotedNotifications == null) {
      putNull("canPostPromotedNotifications")
    } else {
      putBoolean("canPostPromotedNotifications", canPostPromotedNotifications)
    }
    if (errorMessage != null) putString("errorMessage", errorMessage)
  }

  companion object {
    const val NAME = "AndroidStatusNotification"
  }
}

class AndroidStatusNotificationService : Service() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!AndroidStatusNotificationSupport.canPostNotifications(this)) {
      stopSelf(startId)
      return START_NOT_STICKY
    }

    val payload = AndroidStatusNotificationPayload.fromIntent(intent)
    val requestPromotedOngoing = intent?.getBooleanExtra(EXTRA_REQUEST_PROMOTED_ONGOING, false)
        ?: AndroidStatusNotificationSupport.shouldRequestPromotedOngoing(payload)

    AndroidStatusNotificationSupport.ensureChannel(this)
    val notification = AndroidStatusNotificationSupport.buildNotification(this, payload, requestPromotedOngoing)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null
}

private object AndroidStatusNotificationSupport {
  fun buildNotification(context: Context, payload: AndroidStatusNotificationPayload, requestPromotedOngoing: Boolean): Notification {
    val title = payload.title ?: context.getString(R.string.app_name)
    val message = payload.message ?: title
    val shortText = payload.shortText ?: message
    val deepLink = payload.deepLink ?: payload.conversationId?.let { "islemind://chat/$it" } ?: "islemind://"
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }

    builder
        .setSmallIcon(R.drawable.ic_islemind_status)
        .setContentTitle(title)
        .setContentText(shortText)
        .setStyle(Notification.BigTextStyle().bigText(message))
        .setContentIntent(contentIntent(context, deepLink))
        .setOngoing(payload.effectiveOngoing())
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setLocalOnly(true)
        .setAutoCancel(!payload.effectiveOngoing())
        .setColor(notificationAccent(payload.state))
        .setCategory(if (payload.effectiveOngoing()) Notification.CATEGORY_PROGRESS else Notification.CATEGORY_STATUS)
        .setGroup(NOTIFICATION_GROUP_KEY)

    if (!payload.effectiveOngoing()) {
      builder.setTimeoutAfter(TERMINAL_NOTIFICATION_TIMEOUT_MS)
    }

    if (requestPromotedOngoing && Build.VERSION.SDK_INT >= PROMOTED_NOTIFICATIONS_API_LEVEL) {
      builder.addExtras(Bundle().apply { putBoolean(PROMOTED_ONGOING_EXTRA, true) })
    }

    if (payload.progress != null || payload.state == "generating" || payload.state == "running") {
      val normalizedProgress = payload.progress?.let { value ->
        val percent = if (value <= 1.0) value * 100.0 else value
        percent.coerceIn(0.0, 100.0).roundToInt()
      } ?: 0
      builder.setProgress(100, normalizedProgress, payload.indeterminate ?: payload.progress == null)
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      builder.setVisibility(Notification.VISIBILITY_PUBLIC)
    }

    return builder.build()
  }

  private fun notificationAccent(state: String?): Int = when (state) {
    "completed" -> Color.parseColor("#2F7D61")
    "error" -> Color.parseColor("#C94F5D")
    else -> Color.parseColor("#315A73")
  }

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
        CHANNEL_ID,
        "IsleMind status",
        NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "Shows active IsleMind generation and runtime status."
      setShowBadge(false)
      enableVibration(false)
      setSound(null, null)
    }
    notificationManager(context).createNotificationChannel(channel)
  }

  fun notificationManager(context: Context): NotificationManager =
      context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  fun canPostNotifications(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 33) return true
    return context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
  }

  fun canPostPromotedNotifications(context: Context): Boolean? {
    if (Build.VERSION.SDK_INT < PROMOTED_NOTIFICATIONS_API_LEVEL) return null
    return try {
      notificationManager(context).canPostPromotedNotifications()
    } catch (_: Exception) {
      false
    }
  }

  fun shouldRequestPromotedOngoing(payload: AndroidStatusNotificationPayload): Boolean {
    if (Build.VERSION.SDK_INT < PROMOTED_NOTIFICATIONS_API_LEVEL) return false
    if (payload.requestPromotedOngoing != null) return payload.requestPromotedOngoing
    return payload.state == "generating" || payload.effectiveOngoing()
  }

  fun promotedNotificationState(requestPromotedOngoing: Boolean, context: Context): String =
      when {
        !requestPromotedOngoing -> "not_requested"
        Build.VERSION.SDK_INT < PROMOTED_NOTIFICATIONS_API_LEVEL -> "unsupported_api"
        canPostPromotedNotifications(context) == true -> "requested"
        else -> "blocked"
      }

  private fun contentIntent(context: Context, deepLink: String): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(deepLink)).apply {
      addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      setPackage(context.packageName)
    }
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
    return PendingIntent.getActivity(context, NOTIFICATION_REQUEST_CODE, intent, flags)
  }
}

private data class AndroidStatusNotificationPayload(
    val state: String? = null,
    val title: String? = null,
    val message: String? = null,
    val shortText: String? = null,
    val conversationId: String? = null,
    val deepLink: String? = null,
    val progress: Double? = null,
    val indeterminate: Boolean? = null,
    val ongoing: Boolean? = null,
    val requestPromotedOngoing: Boolean? = null,
    val foregroundService: Boolean? = null
) {
  fun effectiveOngoing(): Boolean = ongoing ?: (state == "generating" || state == "running")

  companion object {
    fun fromReadableMap(map: ReadableMap): AndroidStatusNotificationPayload =
        AndroidStatusNotificationPayload(
            state = map.getOptionalString("state"),
            title = map.getOptionalString("title"),
            message = map.getOptionalString("message"),
            shortText = map.getOptionalString("shortText"),
            conversationId = map.getOptionalString("conversationId"),
            deepLink = map.getOptionalString("deepLink"),
            progress = map.getOptionalDouble("progress"),
            indeterminate = map.getOptionalBoolean("indeterminate"),
            ongoing = map.getOptionalBoolean("ongoing"),
            requestPromotedOngoing = map.getOptionalBoolean("requestPromotedOngoing"),
            foregroundService = map.getOptionalBoolean("foregroundService")
        )

    fun fromIntent(intent: Intent?): AndroidStatusNotificationPayload =
        AndroidStatusNotificationPayload(
            state = intent.getOptionalStringExtra(EXTRA_STATE),
            title = intent.getOptionalStringExtra(EXTRA_TITLE),
            message = intent.getOptionalStringExtra(EXTRA_MESSAGE),
            shortText = intent.getOptionalStringExtra(EXTRA_SHORT_TEXT),
            conversationId = intent.getOptionalStringExtra(EXTRA_CONVERSATION_ID),
            deepLink = intent.getOptionalStringExtra(EXTRA_DEEP_LINK),
            progress = intent.getOptionalDoubleExtra(EXTRA_PROGRESS),
            indeterminate = intent.getOptionalBooleanExtra(EXTRA_INDETERMINATE),
            ongoing = intent.getOptionalBooleanExtra(EXTRA_ONGOING),
            requestPromotedOngoing = intent.getOptionalBooleanExtra(EXTRA_REQUEST_PROMOTED_ONGOING),
            foregroundService = true
        )
  }
}

private fun Intent.putStatusPayloadExtras(payload: AndroidStatusNotificationPayload, requestPromotedOngoing: Boolean) {
  payload.state?.let { putExtra(EXTRA_STATE, it) }
  payload.title?.let { putExtra(EXTRA_TITLE, it) }
  payload.message?.let { putExtra(EXTRA_MESSAGE, it) }
  payload.shortText?.let { putExtra(EXTRA_SHORT_TEXT, it) }
  payload.conversationId?.let { putExtra(EXTRA_CONVERSATION_ID, it) }
  payload.deepLink?.let { putExtra(EXTRA_DEEP_LINK, it) }
  payload.progress?.let { putExtra(EXTRA_PROGRESS, it) }
  payload.indeterminate?.let { putExtra(EXTRA_INDETERMINATE, it) }
  payload.ongoing?.let { putExtra(EXTRA_ONGOING, it) }
  putExtra(EXTRA_REQUEST_PROMOTED_ONGOING, requestPromotedOngoing)
}

private fun Intent?.getOptionalStringExtra(key: String): String? =
    if (this != null && hasExtra(key)) getStringExtra(key) else null

private fun Intent?.getOptionalBooleanExtra(key: String): Boolean? =
    if (this != null && hasExtra(key)) getBooleanExtra(key, false) else null

private fun Intent?.getOptionalDoubleExtra(key: String): Double? =
    if (this != null && hasExtra(key)) getDoubleExtra(key, 0.0) else null

private fun ReadableMap.getOptionalString(key: String): String? =
    if (hasKey(key) && !isNull(key)) getString(key) else null

private fun ReadableMap.getOptionalBoolean(key: String): Boolean? =
    if (hasKey(key) && !isNull(key)) getBoolean(key) else null

private fun ReadableMap.getOptionalDouble(key: String): Double? =
    if (hasKey(key) && !isNull(key)) getDouble(key) else null

private const val CHANNEL_ID = "islemind_status"
private const val NOTIFICATION_ID = 1937
private const val NOTIFICATION_REQUEST_CODE = 1938
private const val NOTIFICATION_GROUP_KEY = "islemind_generation_status"
private const val TERMINAL_NOTIFICATION_TIMEOUT_MS = 12_000L
private const val PROMOTED_NOTIFICATIONS_API_LEVEL = 36
private const val PROMOTED_ONGOING_EXTRA = "android.requestPromotedOngoing"
private const val EXTRA_STATE = "state"
private const val EXTRA_TITLE = "title"
private const val EXTRA_MESSAGE = "message"
private const val EXTRA_SHORT_TEXT = "shortText"
private const val EXTRA_CONVERSATION_ID = "conversationId"
private const val EXTRA_DEEP_LINK = "deepLink"
private const val EXTRA_PROGRESS = "progress"
private const val EXTRA_INDETERMINATE = "indeterminate"
private const val EXTRA_ONGOING = "ongoing"
private const val EXTRA_REQUEST_PROMOTED_ONGOING = "requestPromotedOngoing"
