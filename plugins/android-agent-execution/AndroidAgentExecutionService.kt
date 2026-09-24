package com.islemind.app

import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.os.SystemClock
import com.facebook.react.bridge.WritableMap

/** Holds resources for existing Hermes work, not a worker or another JS runtime. */
class AndroidAgentExecutionService : Service() {
  private val leases = LinkedHashMap<String, AgentLease>()
  private var lastStartId = 0
  private var displayedLease: AgentLease? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private val cpuGuard = Any()
  private val cpuDeadlineThread = HandlerThread("AgentWakeDeadline").apply { start() }
  private val cpuHandler = Handler(cpuDeadlineThread.looper)
  private var cpuDeadline = 0L
  private val cpuExpiry = object : Runnable {
    override fun run() {
      synchronized(cpuGuard) {
        if (cpuDeadline == 0L) return
        val remaining = cpuDeadline - SystemClock.elapsedRealtime()
        if (remaining > 0L) {
          cpuHandler.postDelayed(this, remaining)
          return
        }
        cpuDeadline = 0L
        try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) { /* Expired. */ }
      }
      // Lease maps and Service lifecycle remain main-looper owned. CPU release
      // above must not wait for a blocked main looper to recover.
      AndroidAgentExecutionRuntime.handler.post { expireDue() }
    }
  }
  internal var foregroundRunning = false
    private set
  private val expiryCheck = Runnable { expireDue() }

  override fun onCreate() {
    super.onCreate()
    AndroidAgentExecutionRuntime.service = this
    wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:AgentExecution")
        .apply { setReferenceCounted(false) }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    lastStartId = startId
    val token = intent?.getStringExtra(AGENT_REQUEST_TOKEN)
    val pending = token?.let { AndroidAgentExecutionRuntime.removePending(it) }
    // Never reconstruct authority from a redelivered intent or a notification.
    if (pending == null || pending.deadline <= SystemClock.elapsedRealtime()) {
      pending?.promise?.resolve(agentResult(false, "native_error"))
      expireDue()
      if (leases.isEmpty()) finishIdle()
      return START_NOT_STICKY
    }

    // Do not stopSelf between retiring old leases and admitting this startId.
    removeExpired()
    val old = leases[pending.run.runId]
    val denial = when {
      !AndroidAgentExecutionNotifications.canPost(this) -> "permission_denied"
      AndroidAgentExecutionRuntime.isBarred(pending.run) -> "stale"
      !AndroidAgentExecutionRuntime.canTrack(pending.run) -> "capacity"
      old != null && pending.run.generation <= old.identity.generation -> "stale"
      old == null && leases.size >= AGENT_MAX_LEASES -> "capacity"
      else -> null
    }
    if (denial != null) {
      pending.promise.resolve(agentResult(false, denial))
      reconcileResources()
      return START_NOT_STICKY
    }

    val lease = AgentLease(
        AgentLeaseIdentity(pending.run.runId, pending.run.generation, startId, requireNotNull(token)),
        pending.ownerId, SystemClock.elapsedRealtime() + AGENT_LEASE_TTL_MS
    )
    AndroidAgentExecutionRuntime.markStarted(pending.run)
    if (old != null) {
      leases.remove(old.identity.runId)
      AndroidAgentExecutionRuntime.recordControl(old, "superseded")
    }
    leases[lease.identity.runId] = lease
    try {
      AndroidAgentExecutionNotifications.ensureChannel(this)
      val notification = AndroidAgentExecutionNotifications.build(this, lease, waiting = false)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(AGENT_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(AGENT_NOTIFICATION_ID, notification)
      }
      foregroundRunning = true
      displayedLease = lease
      AndroidAgentExecutionRuntime.notificationOwner = lease.identity.leaseToken
      scheduleResources()
      pending.promise.resolve(agentResult(true, "acquired", lease))
    } catch (_: Exception) {
      stopAll("native_error")
      pending.promise.resolve(agentResult(false, "native_error"))
    }
    return START_NOT_STICKY
  }

  internal fun activeLeases(): List<AgentLease> = leases.values.toList()

  internal fun wakeLockHeld(): Boolean = wakeLock?.isHeld == true

  internal fun renew(identity: AgentLeaseIdentity): WritableMap {
    val before = leases[identity.runId]
    expireDue()
    val current = leases[identity.runId]
    if (current == null || current.identity != identity) {
      return agentResult(false, if (before?.identity == identity && before.expiresAtElapsedMs <= SystemClock.elapsedRealtime()) "expired" else "stale")
    }
    if (!AndroidAgentExecutionNotifications.canPost(this)) {
      stopAll("native_error")
      return agentResult(false, "permission_denied")
    }
    val renewed = current.copy(expiresAtElapsedMs = SystemClock.elapsedRealtime() + AGENT_LEASE_TTL_MS)
    leases[identity.runId] = renewed
    return try {
      scheduleResources()
      agentResult(true, "renewed", renewed)
    } catch (_: Exception) {
      stopAll("native_error")
      agentResult(false, "native_error")
    }
  }

  internal fun release(identity: AgentLeaseIdentity): WritableMap {
    expireDue()
    if (leases[identity.runId]?.identity != identity) return agentResult(false, "stale")
    leases.remove(identity.runId)
    reconcileResources()
    return agentResult(true, "released")
  }

  internal fun requestStop(identity: AgentLeaseIdentity) {
    expireDue()
    val current = leases[identity.runId] ?: return
    if (current.identity != identity) return
    // Delete admission before signalling JS: a suspended JS loop cannot renew it.
    leases.remove(identity.runId)
    AndroidAgentExecutionRuntime.recordControl(current, "stop_requested")
    reconcileResources()
  }

  internal fun releaseOwner(ownerId: String) {
    val owned = leases.values.filter { it.ownerId == ownerId }
    owned.forEach {
      leases.remove(it.identity.runId)
      AndroidAgentExecutionRuntime.recordControl(it, "bridge_invalidated")
    }
    if (owned.isNotEmpty()) reconcileResources()
  }

  internal fun expireDue() {
    if (AndroidAgentExecutionRuntime.service !== this) return
    if (removeExpired()) reconcileResources()
  }

  private fun removeExpired(): Boolean {
    val now = SystemClock.elapsedRealtime()
    val expired = leases.values.filter { it.expiresAtElapsedMs <= now }
    expired.forEach {
      leases.remove(it.identity.runId)
      AndroidAgentExecutionRuntime.recordControl(it, "expired")
    }
    return expired.isNotEmpty()
  }

  private fun reconcileResources() {
    if (AndroidAgentExecutionRuntime.service !== this) return
    if (leases.isEmpty()) {
      finishIdle()
      return
    }
    try {
      val representative = leases.values.last()
      if (displayedLease?.identity != representative.identity) {
        AndroidAgentExecutionNotifications.manager(this).notify(
            AGENT_NOTIFICATION_ID, AndroidAgentExecutionNotifications.build(this, representative, waiting = false)
        )
        displayedLease = representative
        AndroidAgentExecutionRuntime.notificationOwner = representative.identity.leaseToken
      }
      scheduleResources()
    } catch (_: Exception) {
      stopAll("native_error")
    }
  }

  private fun scheduleResources() {
    AndroidAgentExecutionRuntime.handler.removeCallbacks(expiryCheck)
    val now = SystemClock.elapsedRealtime()
    val earliest = leases.values.minOfOrNull { it.expiresAtElapsedMs } ?: return
    val latest = leases.values.maxOf { it.expiresAtElapsedMs }
    synchronized(cpuGuard) {
      cpuDeadline = latest
      // PowerManager's timed acquire also uses a Handler, not a kernel deadline.
      // The dedicated scheduler is independent of both Hermes and the main looper.
      wakeLock?.acquire((latest - now).coerceIn(1L, AGENT_LEASE_TTL_MS))
      cpuHandler.removeCallbacks(cpuExpiry)
      cpuHandler.postDelayed(cpuExpiry, (latest - now).coerceAtLeast(1L))
    }
    AndroidAgentExecutionRuntime.handler.postDelayed(expiryCheck, (earliest - now).coerceAtLeast(1L))
  }

  private fun releaseWakeLock() {
    AndroidAgentExecutionRuntime.handler.removeCallbacks(expiryCheck)
    synchronized(cpuGuard) {
      cpuDeadline = 0L
      cpuHandler.removeCallbacks(cpuExpiry)
      try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) { /* Already expired. */ }
    }
  }

  private fun finishIdle(stopSelf: Boolean = true) {
    if (AndroidAgentExecutionRuntime.service !== this || leases.isNotEmpty()) return
    releaseWakeLock()
    val shown = displayedLease
    if (shown != null && AndroidAgentExecutionRuntime.notificationOwner == shown.identity.leaseToken) {
      try {
        // Same notification slot becomes ordinary actionable waiting state before
        // detachment. There is intentionally no notification cancel/remove path.
        AndroidAgentExecutionNotifications.manager(this).notify(
            AGENT_NOTIFICATION_ID, AndroidAgentExecutionNotifications.build(this, shown, waiting = true)
        )
      } catch (_: Exception) { /* Revoked permission never keeps CPU resources alive. */ }
    }
    if (foregroundRunning) {
      stopForeground(STOP_FOREGROUND_DETACH)
      foregroundRunning = false
    }
    displayedLease = null
    if (stopSelf && lastStartId > 0) stopSelfResult(lastStartId)
  }

  private fun stopAll(kind: String, stopSelf: Boolean = true) {
    val stopped = leases.values.toList()
    leases.clear()
    stopped.forEach { AndroidAgentExecutionRuntime.recordControl(it, kind) }
    finishIdle(stopSelf)
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    if (AndroidAgentExecutionRuntime.service === this && startId == lastStartId) stopAll("timeout")
  }

  override fun onTimeout(startId: Int) {
    if (AndroidAgentExecutionRuntime.service === this && startId == lastStartId) stopAll("timeout")
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    if (AndroidAgentExecutionRuntime.service === this) stopAll("task_removed")
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    if (AndroidAgentExecutionRuntime.service === this) {
      stopAll("service_destroyed", stopSelf = false)
      AndroidAgentExecutionRuntime.service = null
    }
    releaseWakeLock()
    cpuDeadlineThread.quitSafely()
    // A retired instance never clears the notification/resources of a newer one.
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}

/** Explicit immutable PendingIntent only; never starts a service or a JS runtime. */
class AndroidAgentExecutionStopReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action != "${context.packageName}.AGENT_STOP") return
    val identity = AgentLeaseIdentity.from(intent) ?: return
    AndroidAgentExecutionRuntime.onMain { AndroidAgentExecutionRuntime.service?.requestStop(identity) }
  }
}
