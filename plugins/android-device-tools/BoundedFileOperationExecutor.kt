package com.islemind.app

import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

internal class FileOperationStopped(val code: String) : RuntimeException(code)

/** One operation owns its slot until I/O actually returns, including after cancellation. */
internal class FileOperationContext(
    private val deadline: Long,
    private val now: () -> Long,
    private val dispatchCancellation: (() -> Unit) -> Unit,
) {
  private val stop = AtomicReference<String?>(null)
  private val cancellation = AtomicReference<(() -> Unit)?>(null)
  var effect = "none"
  var targetUri: String? = null
  var bytesCopied = 0L
  var rowsRead = 0

  fun cancel(reason: String) {
    if (stop.compareAndSet(null, reason)) cancellation.get()?.let(dispatchCancellation)
  }

  fun onCancel(action: () -> Unit) {
    cancellation.set(action)
    if (stop.get() != null) dispatchCancellation(action)
  }

  fun check() {
    if (now() >= deadline) cancel("timeout")
    stop.get()?.let { throw FileOperationStopped(it) }
  }

  fun stopReason(): String? = stop.get()

  fun readRow() {
    check()
    if (++rowsRead > 5000) throw FileOperationStopped("query_limit")
  }

  /** Mark before entering a provider: an exception may still mean the provider mutated data. */
  fun mutation() { check(); effect = "uncertain" }
}

internal class BoundedFileOperationExecutor(private val now: () -> Long) {
  private val worker = ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS,
      ArrayBlockingQueue(8), { task -> Thread(task, "IsleMind-SAF").apply { isDaemon = true } })
  private val cancellations = ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS,
      ArrayBlockingQueue(16), { task -> Thread(task, "IsleMind-SAF-cancel").apply { isDaemon = true } })
  private val deadlines = ScheduledThreadPoolExecutor(1) { task ->
    Thread(task, "IsleMind-SAF-deadline").apply { isDaemon = true }
  }.apply { removeOnCancelPolicy = true }
  private val active = ConcurrentHashMap<String, FileOperationContext>()

  fun submit(id: String, action: String, timeoutMs: Long,
      execute: (FileOperationContext) -> Map<String, Any?>,
      complete: (Map<String, Any?>) -> Unit) {
    val context = FileOperationContext(now() + timeoutMs.coerceIn(1000L, 120000L), now) { cancel ->
      // CancellationSignal may call a remote provider. Never do that on the RN bridge/deadline thread.
      try { cancellations.execute { try { cancel() } catch (_: Exception) {} } }
      catch (_: RejectedExecutionException) { /* Cooperative checks still enforce the barrier. */ }
    }
    if (!id.matches(Regex("[A-Za-z0-9_.:-]{1,160}")) || active.putIfAbsent(id, context) != null) {
      complete(receipt(id, action, context, "failed", "invalid_request_id")); return
    }
    try {
      val alarm = deadlines.schedule({ context.cancel("timeout") }, timeoutMs.coerceIn(1000L, 120000L), TimeUnit.MILLISECONDS)
      try {
        worker.execute {
          var data: Map<String, Any?>? = null
          var status = "succeeded"
          var reason: String? = null
          try {
            context.check()
            data = execute(context)
            context.check()
          } catch (error: Exception) {
            reason = context.stopReason() ?: when (error) {
              is FileOperationStopped -> error.code
              is SecurityException -> "permission_required"
              is IllegalArgumentException -> "schema_invalid"
              else -> "io_error"
            }
            status = if (reason == "cancelled" || reason == "runtime_closed") "cancelled" else "failed"
          } finally {
            alarm.cancel(false)
            active.remove(id, context)
          }
          complete(receipt(id, action, context, status, reason, data))
        }
      } catch (error: RejectedExecutionException) {
        alarm.cancel(false)
        throw error
      }
    } catch (_: RejectedExecutionException) {
      active.remove(id, context)
      complete(receipt(id, action, context, "failed", "capacity"))
    }
  }

  fun cancel(id: String): Boolean {
    val context = active[id] ?: return false
    context.cancel("cancelled")
    return true
  }

  fun close() {
    active.values.forEach { it.cancel("runtime_closed") }
    // No interrupt / early slot release: blocked providers cannot be forcibly rolled back.
    worker.shutdown()
    deadlines.shutdownNow()
    cancellations.shutdown()
  }

  private fun receipt(id: String, action: String, context: FileOperationContext, status: String,
      reason: String?, data: Map<String, Any?>? = null): Map<String, Any?> = mapOf(
      "requestId" to id, "action" to action, "status" to status, "effect" to context.effect,
      "reason" to reason, "targetUri" to context.targetUri, "bytesCopied" to context.bytesCopied.toDouble(),
      "data" to data,
  )
}
