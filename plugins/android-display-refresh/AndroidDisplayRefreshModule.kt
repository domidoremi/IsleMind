package com.islemind.app

import android.view.Window
import android.view.Choreographer
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.common.LifecycleState
import com.facebook.react.module.annotations.ReactModule

/** Temporary VSync preference for visible animated glass, never a device override. */
@ReactModule(name = AndroidDisplayRefreshModule.NAME)
class AndroidDisplayRefreshModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), LifecycleEventListener, Choreographer.FrameCallback {
  companion object { const val NAME = "AndroidDisplayRefresh" }
  private var requested = false
  private var ownedWindow: Window? = null
  private var previousRate = 0f
  private var appliedRate = 0f
  private var appliedMode = 0

  override fun getName() = NAME
  override fun initialize() {
    super.initialize()
    context.addLifecycleEventListener(this)
  }

  @ReactMethod
  fun setHighRefreshRate(enabled: Boolean) {
    UiThreadUtil.runOnUiThread {
      requested = enabled
      updateWindow()
    }
  }

  @Suppress("DEPRECATION")
  private fun updateWindow() {
    if (!requested || context.lifecycleState != LifecycleState.RESUMED) {
      restoreWindow()
      return
    }
    val activity = context.currentActivity ?: return
    val window = activity.window ?: return
    if (ownedWindow === window) return
    restoreWindow()
    val display = activity.windowManager.defaultDisplay
    val current = display.mode
    val mode = display.supportedModes.filter {
      it.physicalWidth == current.physicalWidth && it.physicalHeight == current.physicalHeight
    }.maxByOrNull { it.refreshRate } ?: return
    // Do not replace another feature's explicit display mode, or change resolution.
    val attributes = window.attributes
    if (mode.refreshRate < 90f || attributes.preferredDisplayModeId != 0) return
    previousRate = attributes.preferredRefreshRate
    appliedRate = maxOf(previousRate, mode.refreshRate)
    appliedMode = mode.modeId
    ownedWindow = window
    attributes.preferredRefreshRate = appliedRate
    attributes.preferredDisplayModeId = appliedMode
    window.attributes = attributes
    Choreographer.getInstance().postFrameCallback(this)
  }

  override fun doFrame(frameTimeNanos: Long) {
    val window = ownedWindow ?: return
    // TextureView buffer notifications can arrive after traversal. Schedule
    // composition on every animation VSync rather than waiting an extra tick.
    window.decorView.invalidate()
    Choreographer.getInstance().postFrameCallback(this)
  }

  private fun restoreWindow() {
    val window = ownedWindow ?: return
    ownedWindow = null
    Choreographer.getInstance().removeFrameCallback(this)
    val attributes = window.attributes
    // Leave a newer owner's preference alone.
    if (attributes.preferredRefreshRate == appliedRate && attributes.preferredDisplayModeId == appliedMode) {
      attributes.preferredRefreshRate = previousRate
      attributes.preferredDisplayModeId = 0
      window.attributes = attributes
    }
  }

  override fun onHostResume() = updateWindow()
  override fun onHostPause() = restoreWindow()
  override fun onHostDestroy() = restoreWindow()
  override fun invalidate() {
    context.removeLifecycleEventListener(this)
    UiThreadUtil.runOnUiThread { requested = false; restoreWindow() }
    super.invalidate()
  }
}
