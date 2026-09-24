package com.islemind.app

import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import java.lang.ref.WeakReference
import java.util.ArrayDeque

internal const val AGENT_LEASE_TTL_MS = 15_000L
internal const val AGENT_RENEW_INTERVAL_MS = 5_000L
internal const val AGENT_MAX_LEASES = 8
internal const val AGENT_MAX_CONTROLS = 32
internal const val AGENT_MAX_GENERATION_BARRIERS = 4096
internal const val AGENT_ACQUIRE_TIMEOUT_MS = 4_000L
internal const val AGENT_CONTROL_EVENT = "AndroidAgentExecutionControl"
internal const val AGENT_PRESSURE_EVENT = "AndroidAgentExecutionMemoryPressure"
internal const val AGENT_REQUEST_TOKEN = "agentRequestToken"
private val runIdPattern = Regex("[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}")
private val tokenPattern = Regex("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")

internal data class AgentRunIdentity(val runId: String, val generation: Long) {
  companion object {
    fun from(map: ReadableMap): AgentRunIdentity {
      require(map.getType("runId") == ReadableType.String && map.getType("generation") == ReadableType.Number)
      val runId = requireNotNull(map.getString("runId"))
      val generation = map.getDouble("generation")
      require(runId.matches(runIdPattern) && generation.isFinite() && generation >= 1.0 &&
          generation <= 9007199254740991.0 && generation == generation.toLong().toDouble())
      return AgentRunIdentity(runId, generation.toLong())
    }
  }
}

internal data class AgentLeaseIdentity(
    val runId: String, val generation: Long, val startId: Int, val leaseToken: String
) {
  fun toMap(): WritableMap = Arguments.createMap().apply {
    putString("runId", runId)
    putDouble("generation", generation.toDouble())
    putInt("startId", startId)
    putString("leaseToken", leaseToken)
  }

  companion object {
    fun from(map: ReadableMap): AgentLeaseIdentity {
      val run = AgentRunIdentity.from(map)
      require(map.getType("startId") == ReadableType.Number && map.getType("leaseToken") == ReadableType.String)
      val startId = map.getDouble("startId")
      val token = requireNotNull(map.getString("leaseToken"))
      require(startId >= 1.0 && startId <= Int.MAX_VALUE.toDouble() && startId == startId.toInt().toDouble() && token.matches(tokenPattern))
      return AgentLeaseIdentity(run.runId, run.generation, startId.toInt(), token)
    }

    fun from(intent: Intent): AgentLeaseIdentity? = try {
      val runId = intent.getStringExtra("runId") ?: ""
      val generation = intent.getLongExtra("generation", 0L)
      val startId = intent.getIntExtra("startId", 0)
      val token = intent.getStringExtra("leaseToken") ?: ""
      if (!runId.matches(runIdPattern) || generation < 1 || generation > 9007199254740991L || startId < 1 || !token.matches(tokenPattern)) null
      else AgentLeaseIdentity(runId, generation, startId, token)
    } catch (_: Exception) { null }
  }
}

internal data class AgentLease(
    val identity: AgentLeaseIdentity,
    val ownerId: String,
    val expiresAtElapsedMs: Long
) {
  fun toMap(): WritableMap = identity.toMap().apply {
    putDouble("expiresAtElapsedMs", expiresAtElapsedMs.toDouble())
  }
}

internal data class AgentControl(val sequence: Long, val identity: AgentLeaseIdentity, val kind: String, val observedAtElapsedMs: Long) {
  fun toMap(): WritableMap = identity.toMap().apply {
    putDouble("sequence", sequence.toDouble())
    putString("kind", kind)
    putDouble("observedAtElapsedMs", observedAtElapsedMs.toDouble())
  }
}

internal data class AgentPressure(
    val sequence: Long = 0L, val level: String = "normal", val source: String = "initial",
    val androidTrimLevel: Int = 0, val cacheTrimOnly: Boolean = false, val observedAtElapsedMs: Long = 0L
) {
  fun toMap(): WritableMap = Arguments.createMap().apply {
    putDouble("sequence", sequence.toDouble())
    putString("level", level)
    putString("source", source)
    putInt("androidTrimLevel", androidTrimLevel)
    putBoolean("cacheTrimOnly", cacheTrimOnly)
    putDouble("observedAtElapsedMs", observedAtElapsedMs.toDouble())
  }
}

internal data class AgentPendingAcquire(
    val run: AgentRunIdentity, val ownerId: String, val promise: Promise,
    val deadline: Long, val timeout: Runnable
)

/** Process-local facts only. Main-looper serialization is the native control barrier. */
internal object AndroidAgentExecutionRuntime {
  val handler = Handler(Looper.getMainLooper())
  var service: AndroidAgentExecutionService? = null
  var bridge: WeakReference<AndroidAgentExecutionModule>? = null
  var notificationOwner: String? = null
  val pending = LinkedHashMap<String, AgentPendingAcquire>()
  private val controls = ArrayDeque<AgentControl>()
  // Authorization fencing is not diagnostic history. Never evict an old barrier.
  private val generations = HashMap<String, Long>()
  private var controlSequence = 0L
  private var pressure = AgentPressure()
  private var pressureDispatchPending = false

  fun onMain(action: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) action() else handler.post(action)
  }

  fun removePending(token: String): AgentPendingAcquire? = pending.remove(token)?.also {
    handler.removeCallbacks(it.timeout)
  }

  fun recordControl(lease: AgentLease, kind: String) {
    val control = AgentControl(++controlSequence, lease.identity, kind, SystemClock.elapsedRealtime())
    if (controls.size == AGENT_MAX_CONTROLS) controls.removeFirst()
    controls.addLast(control)
    // Revoke already queued starts for the stopped generation before notifying JS.
    pending.filterValues { it.run.runId == lease.identity.runId && it.run.generation <= lease.identity.generation }
        .keys.toList().forEach { token -> removePending(token)?.promise?.resolve(agentResult(false, "stale")) }
    bridge?.get()?.emit(AGENT_CONTROL_EVENT, control.toMap())
  }

  fun isBarred(run: AgentRunIdentity): Boolean = (generations[run.runId] ?: 0L) >= run.generation

  fun canTrack(run: AgentRunIdentity): Boolean = generations.containsKey(run.runId) || generations.size < AGENT_MAX_GENERATION_BARRIERS

  fun markStarted(run: AgentRunIdentity) {
    check(canTrack(run) && !isBarred(run))
    generations[run.runId] = run.generation
  }

  fun recordPressure(trimLevel: Int, lowMemory: Boolean) {
    val uiHidden = !lowMemory && trimLevel == 20
    val critical = lowMemory || trimLevel == 10 || trimLevel == 15 || trimLevel >= 60
    // A coalesced UI_HIDDEN/moderate callback must not erase a critical signal
    // before JS has had any opportunity to observe it.
    if (pressureDispatchPending && pressure.level == "critical" && !critical) return
    pressure = AgentPressure(
        pressure.sequence + 1,
        if (uiHidden) "normal" else if (critical) "critical" else if (trimLevel >= 5) "moderate" else "normal",
        if (lowMemory) "low_memory" else "trim_memory", trimLevel.coerceAtLeast(0), uiHidden,
        SystemClock.elapsedRealtime()
    )
    // Coalesce notifications. A trim callback performs no I/O, GC, inference or JS work.
    if (!pressureDispatchPending) {
      pressureDispatchPending = true
      handler.post {
        pressureDispatchPending = false
        bridge?.get()?.emit(AGENT_PRESSURE_EVENT, pressure.toMap())
      }
    }
  }

  fun stateMap(): WritableMap {
    service?.expireDue()
    val now = SystemClock.elapsedRealtime()
    return Arguments.createMap().apply {
      putBoolean("available", true)
      putString("reason", "ready")
      putInt("androidApiLevel", Build.VERSION.SDK_INT)
      putDouble("elapsedRealtimeMs", now.toDouble())
      putDouble("leaseTtlMs", AGENT_LEASE_TTL_MS.toDouble())
      putDouble("renewIntervalMs", AGENT_RENEW_INTERVAL_MS.toDouble())
      putBoolean("foregroundServiceRunning", service?.foregroundRunning == true)
      putBoolean("wakeLockHeld", service?.wakeLockHeld() == true)
      // Android 14+ does not reliably deliver running-critical/low-memory callbacks.
      putBoolean("runningCriticalCallbacksReliable", Build.VERSION.SDK_INT < 34)
      putArray("leases", Arguments.createArray().apply { service?.activeLeases()?.forEach { pushMap(it.toMap()) } })
      putArray("controls", Arguments.createArray().apply { controls.forEach { pushMap(it.toMap()) } })
      putDouble("lastControlSequence", controlSequence.toDouble())
      putMap("pressure", pressure.toMap())
    }
  }
}

internal fun agentResult(ok: Boolean, reason: String, lease: AgentLease? = null): WritableMap = Arguments.createMap().apply {
  putBoolean("ok", ok)
  putString("reason", reason)
  if (lease != null) putMap("lease", lease.toMap())
}
