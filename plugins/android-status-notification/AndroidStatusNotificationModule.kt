package com.islemind.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
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
  fun updateStatus(payload: ReadableMap, promise: Promise) {
    if (!canPostNotifications()) {
      promise.resolve(resultMap(shown = false, reason = "permission_denied"))
      return
    }

    try {
      ensureChannel()
      val requestPromotedOngoing = shouldRequestPromotedOngoing(payload)
      notificationManager().notify(NOTIFICATION_ID, buildNotification(payload, requestPromotedOngoing))
      promise.resolve(
          resultMap(
              shown = true,
              reason = "shown",
              promotedOngoingRequested = requestPromotedOngoing,
              promotedNotificationState = promotedNotificationState(requestPromotedOngoing),
              canPostPromotedNotifications = canPostPromotedNotifications()
          )
      )
    } catch (error: Exception) {
      promise.reject("android_status_notification_failed", error.message, error)
    }
  }

  @ReactMethod
  fun clearStatus(promise: Promise) {
    notificationManager().cancel(NOTIFICATION_ID)
    promise.resolve(resultMap(shown = false, reason = "cleared"))
  }

  private fun buildNotification(payload: ReadableMap, requestPromotedOngoing: Boolean): Notification {
    val title = payload.getOptionalString("title") ?: reactContext.getString(R.string.app_name)
    val message = payload.getOptionalString("message") ?: title
    val shortText = payload.getOptionalString("shortText") ?: message
    val state = payload.getOptionalString("state") ?: "active"
    val ongoing = payload.getOptionalBoolean("ongoing") ?: state == "generating"
    val indeterminate = payload.getOptionalBoolean("indeterminate") ?: true
    val progress = payload.getOptionalDouble("progress")
    val deepLink = payload.getOptionalString("deepLink") ?: payload.getOptionalString("conversationId")?.let { "islemind://chat/$it" } ?: "islemind://"
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(reactContext, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(reactContext)
    }

    builder
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle(title)
        .setContentText(shortText)
        .setStyle(Notification.BigTextStyle().bigText(message))
        .setContentIntent(contentIntent(deepLink))
        .setOngoing(ongoing)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setLocalOnly(true)
        .setAutoCancel(!ongoing)
        .setColor(Color.parseColor("#1F73FF"))
        .setCategory(Notification.CATEGORY_PROGRESS)

    if (requestPromotedOngoing && Build.VERSION.SDK_INT >= PROMOTED_NOTIFICATIONS_API_LEVEL) {
      builder.addExtras(Bundle().apply { putBoolean(PROMOTED_ONGOING_EXTRA, true) })
    }

    if (progress != null || state == "generating") {
      val normalizedProgress = progress?.let { value ->
        val percent = if (value <= 1.0) value * 100.0 else value
        percent.coerceIn(0.0, 100.0).roundToInt()
      } ?: 0
      builder.setProgress(100, normalizedProgress, indeterminate)
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      builder.setVisibility(Notification.VISIBILITY_PUBLIC)
    }

    return builder.build()
  }

  private fun contentIntent(deepLink: String): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(deepLink)).apply {
      addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      setPackage(reactContext.packageName)
    }
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
    return PendingIntent.getActivity(reactContext, NOTIFICATION_REQUEST_CODE, intent, flags)
  }

  private fun ensureChannel() {
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
    notificationManager().createNotificationChannel(channel)
  }

  private fun notificationManager(): NotificationManager =
      reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private fun canPostNotifications(): Boolean {
    if (Build.VERSION.SDK_INT < 33) return true
    return reactContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
  }

  private fun canPostPromotedNotifications(): Boolean? {
    if (Build.VERSION.SDK_INT < PROMOTED_NOTIFICATIONS_API_LEVEL) return null
    return try {
      notificationManager().canPostPromotedNotifications()
    } catch (_: Exception) {
      false
    }
  }

  private fun shouldRequestPromotedOngoing(payload: ReadableMap): Boolean {
    if (Build.VERSION.SDK_INT < PROMOTED_NOTIFICATIONS_API_LEVEL) return false
    val requested = payload.getOptionalBoolean("requestPromotedOngoing")
    if (requested != null) return requested
    return payload.getOptionalString("state") == "generating"
  }

  private fun promotedNotificationState(requestPromotedOngoing: Boolean): String =
      when {
        !requestPromotedOngoing -> "not_requested"
        Build.VERSION.SDK_INT < PROMOTED_NOTIFICATIONS_API_LEVEL -> "unsupported_api"
        canPostPromotedNotifications() == true -> "requested"
        else -> "blocked"
      }

  private fun permissionStatusMap() = Arguments.createMap().apply {
    putBoolean("available", true)
    putBoolean("granted", canPostNotifications())
    putBoolean("backgroundReliable", false)
    putInt("androidApiLevel", Build.VERSION.SDK_INT)
    putBoolean("promotedNotificationsAvailable", Build.VERSION.SDK_INT >= PROMOTED_NOTIFICATIONS_API_LEVEL)
    val canPostPromoted = canPostPromotedNotifications()
    if (canPostPromoted == null) {
      putNull("canPostPromotedNotifications")
    } else {
      putBoolean("canPostPromotedNotifications", canPostPromoted)
    }
  }

  private fun resultMap(
      shown: Boolean,
      reason: String,
      promotedOngoingRequested: Boolean = false,
      promotedNotificationState: String = "not_requested",
      canPostPromotedNotifications: Boolean? = null
  ) = Arguments.createMap().apply {
    putBoolean("shown", shown)
    putString("reason", reason)
    putBoolean("backgroundReliable", false)
    putBoolean("promotedOngoingRequested", promotedOngoingRequested)
    putString("promotedNotificationState", promotedNotificationState)
    if (canPostPromotedNotifications == null) {
      putNull("canPostPromotedNotifications")
    } else {
      putBoolean("canPostPromotedNotifications", canPostPromotedNotifications)
    }
  }

  private fun ReadableMap.getOptionalString(key: String): String? =
      if (hasKey(key) && !isNull(key)) getString(key) else null

  private fun ReadableMap.getOptionalBoolean(key: String): Boolean? =
      if (hasKey(key) && !isNull(key)) getBoolean(key) else null

  private fun ReadableMap.getOptionalDouble(key: String): Double? =
      if (hasKey(key) && !isNull(key)) getDouble(key) else null

  companion object {
    const val NAME = "AndroidStatusNotification"
    private const val CHANNEL_ID = "islemind_status"
    private const val NOTIFICATION_ID = 1937
    private const val NOTIFICATION_REQUEST_CODE = 1938
    private const val PROMOTED_NOTIFICATIONS_API_LEVEL = 36
    private const val PROMOTED_ONGOING_EXTRA = "android.requestPromotedOngoing"
  }
}
