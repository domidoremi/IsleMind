package com.islemind.app

import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.SystemClock
import android.provider.MediaStore
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule
import java.io.File
import java.io.FileOutputStream

@ReactModule(name = AndroidDeviceToolsModule.NAME)
class AndroidDeviceToolsModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  private val activeFileRequests = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
  @Volatile private var invalidated = false
  private val fileOperations = AndroidSafFileOperations(reactContext.contentResolver)

  override fun getConstants(): Map<String, Any> = mapOf("fileOperationVersion" to 1)

  override fun invalidate() {
    invalidated = true
    activeFileRequests.forEach { fileExecutor.cancel(it) }
    super.invalidate()
  }

  @ReactMethod
  fun executeFileOperation(requestId: String, action: String, input: ReadableMap, timeoutMs: Double, promise: Promise) {
    submitFileOperation(requestId, action, input.toHashMap(), timeoutMs.toLong(), promise)
  }

  @ReactMethod
  fun cancelFileOperation(requestId: String, promise: Promise) {
    promise.resolve(activeFileRequests.contains(requestId) && fileExecutor.cancel(requestId))
  }

  private fun submitFileOperation(id: String, action: String, input: Map<String, Any?>,
      timeoutMs: Long, promise: Promise, legacy: Boolean = false) {
    if (invalidated || !activeFileRequests.add(id)) {
      if (legacy) {
        promise.reject("android_device_file_failed", "File runtime closed or request id already active")
        return
      }
      promise.resolve(Arguments.makeNativeMap(mapOf("requestId" to id, "action" to action,
          "status" to "failed", "effect" to "none", "bytesCopied" to 0,
          "reason" to if (invalidated) "runtime_closed" else "invalid_request_id")))
      return
    }
    fileExecutor.submit(id, action, timeoutMs, { context -> fileOperations.execute(action, input, context) }) { receipt ->
      activeFileRequests.remove(id)
      if (legacy && receipt["status"] != "succeeded") {
        // Older JS gets a rejection, never a false success. New JS consumes the full receipt.
        promise.reject("android_device_file_failed", receipt["reason"] as? String,
            Arguments.makeNativeMap(receipt))
      } else {
        @Suppress("UNCHECKED_CAST")
        promise.resolve(Arguments.makeNativeMap(if (legacy) receipt["data"] as Map<String, Any?> else receipt))
      }
    }
    if (invalidated) fileExecutor.cancel(id)
  }

  private fun legacy(action: String, input: Map<String, Any?>, promise: Promise) =
      submitFileOperation(java.util.UUID.randomUUID().toString(), action, input, 60000L, promise, true)

  @ReactMethod
  fun scanDirectory(directoryUri: String, maxDepthValue: Double, maxEntriesValue: Double, promise: Promise) =
      legacy("scan", mapOf("directoryUri" to directoryUri, "maxDepth" to maxDepthValue, "maxEntries" to maxEntriesValue), promise)

  @ReactMethod
  fun ensureDirectory(parentUri: String, directoryName: String, promise: Promise) =
      legacy("mkdir", mapOf("parentUri" to parentUri, "directoryName" to directoryName), promise)

  @ReactMethod
  fun copyDocument(sourceUri: String, targetParentUri: String, targetName: String, mimeType: String?,
      conflictPolicy: String?, promise: Promise) = legacy("copy", mapOf("sourceUri" to sourceUri,
      "targetParentUri" to targetParentUri, "targetName" to targetName, "mimeType" to mimeType, "conflictPolicy" to conflictPolicy), promise)

  @ReactMethod
  fun moveDocument(sourceUri: String, sourceParentUri: String, targetParentUri: String, targetName: String,
      conflictPolicy: String?, promise: Promise) = legacy("move", mapOf("sourceUri" to sourceUri,
      "sourceParentUri" to sourceParentUri, "targetParentUri" to targetParentUri,
      "targetName" to targetName, "conflictPolicy" to conflictPolicy), promise)

  @ReactMethod
  fun renameDocument(sourceUri: String, targetName: String, promise: Promise) =
      legacy("rename", mapOf("sourceUri" to sourceUri, "targetName" to targetName), promise)

  @ReactMethod
  fun publishPortableJsonFileToDownloads(sourceUri: String, displayName: String, mimeType: String?, promise: Promise) {
    try {
      val source = Uri.parse(sourceUri)
      val safeName = sanitizeDisplayName(displayName)
      val resolvedMimeType = mimeType?.takeIf { it.isNotBlank() } ?: "application/json"
      val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
      val publicFile = File(downloadsDir, safeName)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val values = ContentValues().apply {
          put(MediaStore.MediaColumns.DISPLAY_NAME, safeName)
          put(MediaStore.MediaColumns.MIME_TYPE, resolvedMimeType)
          put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
          put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val published = reactContext.contentResolver.insert(collection, values)
            ?: throw IllegalStateException("Download publication returned no URI.")
        reactContext.contentResolver.openInputStream(source).use { input ->
          reactContext.contentResolver.openOutputStream(published, "w").use { output ->
            if (input == null || output == null) throw IllegalStateException("Unable to open portable export file streams.")
            input.copyTo(output)
          }
        }
        ContentValues().apply {
          put(MediaStore.MediaColumns.IS_PENDING, 0)
          reactContext.contentResolver.update(published, this, null, null)
        }
      } else {
        if (!downloadsDir.exists() && !downloadsDir.mkdirs()) {
          throw IllegalStateException("Unable to create the Downloads directory.")
        }
        reactContext.contentResolver.openInputStream(source).use { input ->
          FileOutputStream(publicFile).use { output ->
            if (input == null) throw IllegalStateException("Unable to open portable export source file.")
            input.copyTo(output)
          }
        }
      }
      reactContext.sendBroadcast(Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE, Uri.fromFile(publicFile)))
      promise.resolve(Uri.fromFile(publicFile).toString())
    } catch (error: Exception) {
      promise.reject("android_device_publish_failed", error.message, error)
    }
  }

  private fun sanitizeDisplayName(value: String): String {
    val cleaned = value.trim().replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001F]+"), "-")
    return cleaned.takeIf { it.isNotBlank() }?.take(120) ?: "Untitled"
  }

  companion object {
    const val NAME = "AndroidDeviceTools"
    // Bridge reload must not create another I/O lane while an old provider is still blocked.
    private val fileExecutor = BoundedFileOperationExecutor { SystemClock.elapsedRealtime() }
  }
}
