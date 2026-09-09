package com.islemind.app

import android.net.Uri
import android.system.Os
import android.system.OsConstants
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Read-only, app-private SHA-256. File bytes never cross the JS bridge. */
@ReactModule(name = AndroidFileIntegrityModule.NAME)
class AndroidFileIntegrityModule(
    reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  private val executor = ThreadPoolExecutor(
      2, 2, 30L, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(8)
  ).apply { allowCoreThreadTimeOut(true) }
  private val operations = ConcurrentHashMap<String, AtomicBoolean>()
  @Volatile private var invalidated = false

  override fun getName(): String = NAME

  @ReactMethod
  fun sha256File(operationId: String, uri: String, expectedBytes: Double, promise: Promise) {
    if (!operationId.matches(Regex("[A-Za-z0-9_-]{1,80}")) ||
        !expectedBytes.isFinite() || expectedBytes < 0 ||
        expectedBytes > 9007199254740991.0 || expectedBytes != expectedBytes.toLong().toDouble()) {
      promise.reject("E_FILE_HASH_INPUT", "Invalid file hash request.")
      return
    }
    if (invalidated) {
      promise.reject("E_FILE_HASH_CANCELLED", "File integrity module was invalidated.")
      return
    }
    val cancelled = AtomicBoolean(false)
    if (operations.putIfAbsent(operationId, cancelled) != null) {
      promise.reject("E_FILE_HASH_DUPLICATE", "File hash operation is already active.")
      return
    }
    try {
      executor.execute {
        try {
          throwIfCancelled(cancelled)
          val file = requirePrivateFile(uri)
          val digest = MessageDigest.getInstance("SHA-256")
          var bytesHashed = 0L
          FileInputStream(file).use { input ->
            val stat = Os.fstat(input.fd)
            require(OsConstants.S_ISREG(stat.st_mode) && stat.st_size == expectedBytes.toLong()) {
              "File size changed or file is not regular."
            }
            val buffer = ByteArray(READ_CHUNK_BYTES)
            while (true) {
              throwIfCancelled(cancelled)
              val count = input.read(buffer)
              throwIfCancelled(cancelled)
              if (count == -1) break
              bytesHashed += count
              require(bytesHashed <= expectedBytes.toLong()) { "File grew during verification." }
              digest.update(buffer, 0, count)
            }
            require(bytesHashed == expectedBytes.toLong()) { "File ended before verification completed." }
          }
          // Settle only after the descriptor is closed. JS also checks its signal
          // on settlement, covering cancellation racing this final native check.
          throwIfCancelled(cancelled)
          val hex = digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
          promise.resolve(Arguments.createMap().apply {
            putString("sha256", hex)
            putDouble("bytesHashed", bytesHashed.toDouble())
          })
        } catch (_: CancelledHashException) {
          promise.reject("E_FILE_HASH_CANCELLED", "File verification was cancelled.")
        } catch (_: Exception) {
          // Do not expose private paths or file contents in diagnostics.
          promise.reject("E_FILE_HASH_READ", "Could not completely verify the app-private file.")
        } finally {
          operations.remove(operationId, cancelled)
        }
      }
    } catch (_: RejectedExecutionException) {
      operations.remove(operationId, cancelled)
      promise.reject("E_FILE_HASH_BUSY", "File verification capacity is unavailable.")
    }
  }

  @ReactMethod
  fun cancel(operationId: String) {
    // sha256File registers synchronously on the native module queue before the
    // subsequent cancel call. Unknown/settled IDs leave no cancellation tombstone.
    operations[operationId]?.set(true)
  }

  override fun invalidate() {
    invalidated = true
    operations.values.forEach { it.set(true) }
    // Drain queued cancellations so their promises settle; shutdownNow would
    // discard queued Runnables without executing their cleanup.
    executor.shutdown()
    super.invalidate()
  }

  private fun throwIfCancelled(cancelled: AtomicBoolean) {
    if (invalidated || cancelled.get()) throw CancelledHashException()
  }

  private fun requirePrivateFile(value: String): File {
    val uri = Uri.parse(value)
    require(uri.scheme == "file" && uri.authority.isNullOrEmpty() && uri.query == null && uri.fragment == null)
    val file = File(requireNotNull(uri.path)).canonicalFile
    val roots = listOf(reactApplicationContext.filesDir, reactApplicationContext.cacheDir)
    require(roots.any { file.path.startsWith(it.canonicalPath + File.separator) })
    require(file.isFile)
    return file
  }

  private class CancelledHashException : Exception()

  companion object {
    const val NAME = "AndroidFileIntegrity"
    private const val READ_CHUNK_BYTES = 256 * 1024
  }
}
