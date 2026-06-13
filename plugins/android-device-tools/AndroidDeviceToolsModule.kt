package com.islemind.app

import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import java.io.File

@ReactModule(name = AndroidDeviceToolsModule.NAME)
class AndroidDeviceToolsModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun scanDirectory(directoryUri: String, maxDepthValue: Double, maxEntriesValue: Double, promise: Promise) {
    try {
      val rootUri = parseSafTreeUri(directoryUri)
      val maxDepth = maxDepthValue.toInt().coerceIn(0, 6)
      val maxEntries = maxEntriesValue.toInt().coerceIn(1, 1000)
      val entries = Arguments.createArray()
      val state = ScanState(maxEntries)
      scanChildren(rootUri, documentUriFromTree(rootUri), rootUri.toString(), 0, maxDepth, entries, state)
      promise.resolve(Arguments.createMap().apply {
        putString("directoryUri", rootUri.toString())
        putArray("entries", entries)
        putBoolean("truncated", state.truncated)
        putInt("entryCount", state.count)
      })
    } catch (error: Exception) {
      promise.reject("android_device_scan_failed", error.message, error)
    }
  }

  @ReactMethod
  fun ensureDirectory(parentUri: String, directoryName: String, promise: Promise) {
    try {
      val parent = documentUriFromTree(parseSafTreeUri(parentUri))
      val safeName = sanitizeDisplayName(directoryName)
      val existing = findChild(parent, safeName, DocumentsContract.Document.MIME_TYPE_DIR)
      if (existing != null) {
        promise.resolve(documentResult(existing, safeName, DocumentsContract.Document.MIME_TYPE_DIR, "existing"))
        return
      }
      val created = DocumentsContract.createDocument(
          reactContext.contentResolver,
          parent,
          DocumentsContract.Document.MIME_TYPE_DIR,
          safeName
      ) ?: throw IllegalStateException("Directory creation returned no URI.")
      promise.resolve(documentResult(created, safeName, DocumentsContract.Document.MIME_TYPE_DIR, "created"))
    } catch (error: Exception) {
      promise.reject("android_device_mkdir_failed", error.message, error)
    }
  }

  @ReactMethod
  fun copyDocument(
      sourceUri: String,
      targetParentUri: String,
      targetName: String,
      mimeType: String?,
      conflictPolicy: String?,
      promise: Promise
  ) {
    try {
      val source = documentUriFromTree(parseSafTreeUri(sourceUri))
      val parent = documentUriFromTree(parseSafTreeUri(targetParentUri))
      val resolvedName = resolveConflictName(parent, sanitizeDisplayName(targetName), conflictPolicy ?: "skip")
      if (resolvedName == null) {
        promise.resolve(operationResult("copy", "skipped", source, null, "target_exists"))
        return
      }
      val created = DocumentsContract.createDocument(
          reactContext.contentResolver,
          parent,
          mimeType?.takeIf { it.isNotBlank() } ?: "application/octet-stream",
          resolvedName
      ) ?: throw IllegalStateException("Target document creation returned no URI.")
      reactContext.contentResolver.openInputStream(source).use { input ->
        reactContext.contentResolver.openOutputStream(created, "w").use { output ->
          if (input == null || output == null) throw IllegalStateException("Unable to open document streams.")
          input.copyTo(output)
        }
      }
      promise.resolve(operationResult("copy", "done", source, created, if (resolvedName == targetName) "copied" else "renamed"))
    } catch (error: Exception) {
      promise.reject("android_device_copy_failed", error.message, error)
    }
  }

  @ReactMethod
  fun moveDocument(
      sourceUri: String,
      sourceParentUri: String,
      targetParentUri: String,
      targetName: String,
      conflictPolicy: String?,
      promise: Promise
  ) {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
        promise.resolve(operationResult("move", "skipped", Uri.parse(sourceUri), null, "unsupported_api"))
        return
      }
      val source = documentUriFromTree(parseSafTreeUri(sourceUri))
      val sourceParent = documentUriFromTree(parseSafTreeUri(sourceParentUri))
      val targetParent = documentUriFromTree(parseSafTreeUri(targetParentUri))
      val originalName = displayName(source) ?: sanitizeDisplayName(targetName)
      val safeTargetName = sanitizeDisplayName(targetName)
      val resolvedName = resolveConflictName(targetParent, safeTargetName, conflictPolicy ?: "skip")
      if (resolvedName == null) {
        promise.resolve(operationResult("move", "skipped", source, null, "target_exists"))
        return
      }

      var moved = DocumentsContract.moveDocument(reactContext.contentResolver, source, sourceParent, targetParent)
          ?: throw IllegalStateException("Move returned no URI.")
      if (resolvedName != originalName) {
        moved = DocumentsContract.renameDocument(reactContext.contentResolver, moved, resolvedName) ?: moved
      }
      promise.resolve(operationResult("move", "done", source, moved, if (resolvedName == safeTargetName) "moved" else "renamed"))
    } catch (error: Exception) {
      promise.reject("android_device_move_failed", error.message, error)
    }
  }

  @ReactMethod
  fun renameDocument(sourceUri: String, targetName: String, promise: Promise) {
    try {
      val source = documentUriFromTree(parseSafTreeUri(sourceUri))
      val renamed = DocumentsContract.renameDocument(
          reactContext.contentResolver,
          source,
          sanitizeDisplayName(targetName)
      ) ?: throw IllegalStateException("Rename returned no URI.")
      promise.resolve(operationResult("rename", "done", source, renamed, "renamed"))
    } catch (error: Exception) {
      promise.reject("android_device_rename_failed", error.message, error)
    }
  }

  private fun scanChildren(
      treeUri: Uri,
      parentDocumentUri: Uri,
      parentUri: String,
      depth: Int,
      maxDepth: Int,
      entries: com.facebook.react.bridge.WritableArray,
      state: ScanState
  ) {
    if (state.count >= state.maxEntries) {
      state.truncated = true
      return
    }
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
        treeUri,
        DocumentsContract.getDocumentId(parentDocumentUri)
    )
    val projection = arrayOf(
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE,
        DocumentsContract.Document.COLUMN_LAST_MODIFIED
    )
    reactContext.contentResolver.query(childrenUri, projection, null, null, null).use { cursor ->
      if (cursor == null) return
      while (cursor.moveToNext()) {
        if (state.count >= state.maxEntries) {
          state.truncated = true
          return
        }
        val documentId = cursor.getString(0)
        val name = cursor.getString(1) ?: documentId.substringAfterLast("/")
        val mimeType = cursor.getString(2)
        val childUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
        val isDirectory = mimeType == DocumentsContract.Document.MIME_TYPE_DIR
        val item = Arguments.createMap().apply {
          putString("uri", childUri.toString())
          putString("parentUri", parentUri)
          putString("name", name)
          if (mimeType == null) putNull("mimeType") else putString("mimeType", mimeType)
          putBoolean("isDirectory", isDirectory)
          putInt("depth", depth)
          putDouble("size", readLong(cursor, 3).toDouble())
          putDouble("lastModified", readLong(cursor, 4).toDouble())
        }
        entries.pushMap(item)
        state.count += 1
        if (isDirectory && depth < maxDepth) {
          scanChildren(treeUri, childUri, childUri.toString(), depth + 1, maxDepth, entries, state)
        }
      }
    }
  }

  private fun parseSafTreeUri(value: String): Uri {
    val uri = Uri.parse(value)
    if (uri.scheme != "content" || uri.pathSegments.none { it == "tree" }) {
      throw IllegalArgumentException("Only Android SAF tree URIs are supported.")
    }
    return uri
  }

  private fun documentUriFromTree(uri: Uri): Uri {
    val documentId = try {
      DocumentsContract.getDocumentId(uri)
    } catch (_: Exception) {
      DocumentsContract.getTreeDocumentId(uri)
    }
    return DocumentsContract.buildDocumentUriUsingTree(uri, documentId)
  }

  private fun findChild(parentDocumentUri: Uri, displayName: String, mimeType: String? = null): Uri? {
    val treeUri = parentDocumentUri
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
        treeUri,
        DocumentsContract.getDocumentId(parentDocumentUri)
    )
    val projection = arrayOf(
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE
    )
    reactContext.contentResolver.query(childrenUri, projection, null, null, null).use { cursor ->
      if (cursor == null) return null
      while (cursor.moveToNext()) {
        val childName = cursor.getString(1)
        val childMime = cursor.getString(2)
        if (childName == displayName && (mimeType == null || childMime == mimeType)) {
          return DocumentsContract.buildDocumentUriUsingTree(treeUri, cursor.getString(0))
        }
      }
    }
    return null
  }

  private fun resolveConflictName(parentUri: Uri, desiredName: String, policy: String): String? {
    if (findChild(parentUri, desiredName) == null) return desiredName
    if (policy != "rename") return null
    val extension = desiredName.substringAfterLast('.', "")
    val base = if (extension.isBlank() || extension == desiredName) desiredName else desiredName.removeSuffix(".$extension")
    for (index in 2..100) {
      val candidate = if (extension.isBlank()) "$base ($index)" else "$base ($index).$extension"
      if (findChild(parentUri, candidate) == null) return candidate
    }
    return null
  }

  private fun displayName(uri: Uri): String? {
    val projection = arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
    reactContext.contentResolver.query(uri, projection, null, null, null).use { cursor ->
      if (cursor != null && cursor.moveToFirst()) return cursor.getString(0)
    }
    return null
  }

  private fun readLong(cursor: android.database.Cursor, index: Int): Long =
      if (cursor.isNull(index)) 0L else cursor.getLong(index)

  private fun sanitizeDisplayName(value: String): String {
    val cleaned = value.trim().replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001F]+"), "-")
    return cleaned.takeIf { it.isNotBlank() }?.take(120) ?: "Untitled"
  }

  private fun documentResult(uri: Uri, name: String, mimeType: String, status: String): WritableMap =
      Arguments.createMap().apply {
        putBoolean("ok", true)
        putString("status", status)
        putString("uri", uri.toString())
        putString("name", name)
        putString("mimeType", mimeType)
      }

  private fun operationResult(action: String, status: String, source: Uri, target: Uri?, reason: String): WritableMap =
      Arguments.createMap().apply {
        putBoolean("ok", status == "done")
        putString("action", action)
        putString("status", status)
        putString("reason", reason)
        putString("sourceUri", source.toString())
        if (target == null) putNull("targetUri") else putString("targetUri", target.toString())
      }

  private data class ScanState(val maxEntries: Int, var count: Int = 0, var truncated: Boolean = false)

  companion object {
    const val NAME = "AndroidDeviceTools"
  }
}
