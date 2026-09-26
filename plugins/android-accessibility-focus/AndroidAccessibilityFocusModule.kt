package com.islemind.app

import android.content.Context
import android.view.View
import android.view.ViewTreeObserver
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityNodeInfo
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.IllegalViewOperationException
import com.facebook.react.uimanager.UIManagerHelper

/** Restore a retained control after its covering native dialog releases the window. */
@ReactModule(name = AndroidAccessibilityFocusModule.NAME)
class AndroidAccessibilityFocusModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), View.OnAttachStateChangeListener {
  companion object { const val NAME = "AndroidAccessibilityFocus" }
  override fun getName() = NAME
  private var pending: View? = null
  private var observer: ViewTreeObserver? = null
  private var listener: ViewTreeObserver.OnWindowFocusChangeListener? = null
  private var requestId = 0.0

  private fun clear() {
    listener?.let { if (observer?.isAlive == true) observer?.removeOnWindowFocusChangeListener(it) }
    pending?.removeOnAttachStateChangeListener(this)
    listener = null
    observer = null
    pending = null
  }

  @ReactMethod
  fun cancel(id: Double) {
    UiThreadUtil.runOnUiThread { if (requestId == id) clear() }
  }

  @ReactMethod
  fun restore(tag: Double, id: Double) {
    UiThreadUtil.runOnUiThread {
      clear()
      requestId = id
      val manager = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
      if (manager?.isEnabled != true || !manager.isTouchExplorationEnabled) return@runOnUiThread
      val view = try {
        UIManagerHelper.getUIManagerForReactTag(context, tag.toInt())?.resolveView(tag.toInt())
      } catch (_: IllegalViewOperationException) {
        null // The owner may have left before this UI-thread command arrived.
      } ?: return@runOnUiThread
      if (!view.isAttachedToWindow) return@runOnUiThread
      pending = view
      view.addOnAttachStateChangeListener(this)
      fun focus() {
        if (pending !== view || !view.hasWindowFocus()) return
        clear()
        if (view.isShown && view.width > 0 && view.height > 0) {
          // This is accessibility focus only: never request input focus or an IME.
          view.performAccessibilityAction(AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS, null)
        }
      }
      if (view.hasWindowFocus()) focus() else {
        observer = view.viewTreeObserver
        listener = ViewTreeObserver.OnWindowFocusChangeListener { hasFocus -> if (hasFocus) focus() }
        observer?.addOnWindowFocusChangeListener(listener)
      }
    }
  }

  override fun onViewAttachedToWindow(view: View) = Unit
  override fun onViewDetachedFromWindow(view: View) { if (pending === view) clear() }
  override fun invalidate() {
    UiThreadUtil.runOnUiThread { clear() }
    super.invalidate()
  }
}
