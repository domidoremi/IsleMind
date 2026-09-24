package com.islemind.app

import android.content.ComponentCallbacks2
import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import android.os.SystemClock
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import com.facebook.react.common.LifecycleState
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.module.annotations.ReactModule
import java.lang.ref.WeakReference
import java.util.UUID

@ReactModule(name = AndroidAgentExecutionModule.NAME)
class AndroidAgentExecutionModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), ComponentCallbacks2 {
  private val ownerId = UUID.randomUUID().toString()
  @Volatile private var invalidated = false
  private var listeners = 0

  override fun getName(): String = NAME

  override fun initialize() {
    super.initialize()
    // Register alongside RN's callbacks, never replace MainApplication/RN handlers.
    context.applicationContext.registerComponentCallbacks(this)
    AndroidAgentExecutionRuntime.onMain {
      if (!invalidated) AndroidAgentExecutionRuntime.bridge = WeakReference(this)
    }
  }

  @ReactMethod
  fun getState(promise: Promise) = AndroidAgentExecutionRuntime.onMain {
    if (invalidated) promise.reject("E_AGENT_BRIDGE", "Agent execution bridge is unavailable.")
    else promise.resolve(AndroidAgentExecutionRuntime.stateMap())
  }

  @ReactMethod
  fun acquire(payload: ReadableMap, promise: Promise) {
    val run = try {
      if (payload.getType("enabled") != ReadableType.Boolean || !payload.getBoolean("enabled")) {
        promise.resolve(agentResult(false, "disabled"))
        return
      }
      AgentRunIdentity.from(payload)
    } catch (_: Exception) {
      promise.resolve(agentResult(false, "invalid_input"))
      return
    }
    AndroidAgentExecutionRuntime.onMain {
      when {
        invalidated -> promise.resolve(agentResult(false, "native_error"))
        !isVisible() -> promise.resolve(agentResult(false, "not_visible"))
        !AndroidAgentExecutionNotifications.canPost(context) -> promise.resolve(agentResult(false, "permission_denied"))
        AndroidAgentExecutionRuntime.isBarred(run) -> promise.resolve(agentResult(false, "stale"))
        !AndroidAgentExecutionRuntime.canTrack(run) -> promise.resolve(agentResult(false, "capacity"))
        AndroidAgentExecutionRuntime.pending.size >= AGENT_MAX_LEASES -> promise.resolve(agentResult(false, "capacity"))
        else -> startAcquire(run, promise)
      }
    }
  }

  private fun isVisible(): Boolean {
    val activity = context.currentActivity ?: return false
    return context.lifecycleState == LifecycleState.RESUMED && !activity.isFinishing && !activity.isDestroyed
  }

  private fun startAcquire(run: AgentRunIdentity, promise: Promise) {
    val token = UUID.randomUUID().toString()
    val timeout = Runnable {
      AndroidAgentExecutionRuntime.removePending(token)?.promise?.resolve(agentResult(false, "native_error"))
    }
    AndroidAgentExecutionRuntime.pending[token] = AgentPendingAcquire(
        run, ownerId, promise, SystemClock.elapsedRealtime() + AGENT_ACQUIRE_TIMEOUT_MS, timeout
    )
    AndroidAgentExecutionRuntime.handler.postDelayed(timeout, AGENT_ACQUIRE_TIMEOUT_MS)
    try {
      // Only this visible-Activity entry point may start the service. Renew, stop,
      // notification taps and process recreation cannot start execution.
      val intent = Intent(context, AndroidAgentExecutionService::class.java).putExtra(AGENT_REQUEST_TOKEN, token)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
    } catch (_: Exception) {
      AndroidAgentExecutionRuntime.removePending(token)?.promise?.resolve(agentResult(false, "native_error"))
    }
  }

  @ReactMethod
  fun renew(payload: ReadableMap, promise: Promise) {
    val identity = try { AgentLeaseIdentity.from(payload) } catch (_: Exception) {
      promise.resolve(agentResult(false, "invalid_input")); return
    }
    AndroidAgentExecutionRuntime.onMain {
      if (invalidated) promise.resolve(agentResult(false, "native_error"))
      else promise.resolve(AndroidAgentExecutionRuntime.service?.renew(identity) ?: agentResult(false, "stale"))
    }
  }

  @ReactMethod
  fun release(payload: ReadableMap, promise: Promise) {
    val identity = try {
      require(payload.getType("reason") == ReadableType.String && payload.getString("reason") in RELEASE_REASONS)
      AgentLeaseIdentity.from(payload)
    } catch (_: Exception) {
      promise.resolve(agentResult(false, "invalid_input")); return
    }
    AndroidAgentExecutionRuntime.onMain {
      if (invalidated) promise.resolve(agentResult(false, "native_error"))
      else promise.resolve(AndroidAgentExecutionRuntime.service?.release(identity) ?: agentResult(false, "stale"))
    }
  }

  @ReactMethod
  fun addListener(eventName: String) = AndroidAgentExecutionRuntime.onMain {
    if (eventName == AGENT_CONTROL_EVENT || eventName == AGENT_PRESSURE_EVENT) listeners = (listeners + 1).coerceAtMost(64)
  }

  @ReactMethod
  fun removeListeners(count: Double) = AndroidAgentExecutionRuntime.onMain {
    if (count.isFinite() && count >= 0) listeners = (listeners - count.toInt()).coerceAtLeast(0)
  }

  internal fun emit(name: String, payload: WritableMap) {
    if (invalidated || listeners == 0 || !context.hasActiveReactInstance()) return
    try {
      context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, payload)
    } catch (_: Exception) {
      // Native barriers/facts remain queryable if JS is unavailable or suspended.
    }
  }

  override fun onTrimMemory(level: Int) {
    AndroidAgentExecutionRuntime.onMain {
      if (!invalidated && AndroidAgentExecutionRuntime.bridge?.get() === this) AndroidAgentExecutionRuntime.recordPressure(level, false)
    }
  }

  override fun onLowMemory() {
    AndroidAgentExecutionRuntime.onMain {
      if (!invalidated && AndroidAgentExecutionRuntime.bridge?.get() === this) AndroidAgentExecutionRuntime.recordPressure(80, true)
    }
  }

  override fun onConfigurationChanged(newConfig: Configuration) = Unit

  override fun invalidate() {
    invalidated = true
    context.applicationContext.unregisterComponentCallbacks(this)
    AndroidAgentExecutionRuntime.onMain {
      val pending = AndroidAgentExecutionRuntime.pending.filterValues { it.ownerId == ownerId }.keys.toList()
      pending.forEach { token -> AndroidAgentExecutionRuntime.removePending(token)?.promise?.resolve(agentResult(false, "native_error")) }
      AndroidAgentExecutionRuntime.service?.releaseOwner(ownerId)
      if (AndroidAgentExecutionRuntime.bridge?.get() === this) AndroidAgentExecutionRuntime.bridge = null
      listeners = 0
    }
    super.invalidate()
  }

  companion object {
    const val NAME = "AndroidAgentExecution"
    private val RELEASE_REASONS = setOf("waiting", "completed", "cancelled", "pressure", "shutdown")
  }
}
