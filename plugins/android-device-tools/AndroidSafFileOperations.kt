package com.islemind.app

import android.content.ContentResolver
import android.net.Uri
import android.os.CancellationSignal
import android.provider.DocumentsContract
import java.io.InputStream
import java.io.OutputStream

/** SAF only. This is an I/O boundary, not an authorization or task scheduler. */
internal class AndroidSafFileOperations(private val resolver: ContentResolver) {
  fun execute(action: String, input: Map<String, Any?>, context: FileOperationContext): Map<String, Any?> {
    val signal = CancellationSignal()
    context.onCancel { signal.cancel() }
    val operation = Operation(context, signal)
    return when (action) {
      "scan" -> operation.scan(input)
      "mkdir" -> operation.mkdir(input)
      "copy" -> operation.copy(input)
      "move" -> operation.move(input)
      "rename" -> operation.rename(input)
      else -> throw IllegalArgumentException("Unsupported file operation")
    }
  }

  private inner class Operation(val context: FileOperationContext, val signal: CancellationSignal) {
    private fun query(uri: Uri, columns: Array<String>) = run {
      context.check()
      resolver.query(uri, columns, null, null, null, signal)
          ?: throw IllegalStateException("Provider returned no cursor")
    }

    private fun authorized(value: String, write: Boolean = false): Uri {
      context.check()
      require(value.length <= 8192)
      val uri = Uri.parse(value)
      require(uri.scheme == "content" && DocumentsContract.isTreeUri(uri) && uri.query == null && uri.fragment == null)
      val treeId = DocumentsContract.getTreeDocumentId(uri)
      val grant = resolver.persistedUriPermissions.any {
        it.isReadPermission && (!write || it.isWritePermission) && it.uri.authority == uri.authority &&
            DocumentsContract.isTreeUri(it.uri) && DocumentsContract.getTreeDocumentId(it.uri) == treeId
      }
      if (!grant) throw SecurityException("A persisted directory grant is required")
      val id = if (DocumentsContract.isDocumentUri(null, uri)) DocumentsContract.getDocumentId(uri) else treeId
      val root = DocumentsContract.buildDocumentUriUsingTree(uri, treeId)
      val document = DocumentsContract.buildDocumentUriUsingTree(uri, id)
      if (id != treeId && !DocumentsContract.isChildDocument(resolver, root, document)) {
        throw SecurityException("Document is outside the selected tree")
      }
      context.check()
      return document
    }

    private fun children(parent: Uri) = DocumentsContract.buildChildDocumentsUriUsingTree(parent, DocumentsContract.getDocumentId(parent))

    fun scan(input: Map<String, Any?>): Map<String, Any?> {
      val rootValue = input.string("directoryUri")
      val root = authorized(rootValue)
      val maxDepth = input.int("maxDepth", 1).coerceIn(0, 6)
      val limit = input.int("maxEntries", 300).coerceIn(1, 1000)
      val entries = mutableListOf<Map<String, Any?>>()
      var truncated = false
      fun walk(parent: Uri, parentValue: String, depth: Int) {
        query(children(parent), arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED)).use { cursor ->
          while (cursor.moveToNext()) {
            context.readRow()
            if (entries.size >= limit) { truncated = true; return }
            val child = DocumentsContract.buildDocumentUriUsingTree(root, cursor.getString(0))
            val mime = cursor.getString(2)
            val directory = mime == DocumentsContract.Document.MIME_TYPE_DIR
            entries.add(mapOf("uri" to child.toString(), "parentUri" to parentValue,
                "name" to cursor.getString(1), "mimeType" to mime, "isDirectory" to directory,
                "depth" to depth, "size" to if (cursor.isNull(3)) 0.0 else cursor.getLong(3).toDouble(),
                "lastModified" to if (cursor.isNull(4)) 0.0 else cursor.getLong(4).toDouble()))
            if (directory && depth < maxDepth) walk(authorized(child.toString()), child.toString(), depth + 1)
            if (truncated) return
          }
        }
      }
      walk(root, rootValue, 0)
      return mapOf("directoryUri" to rootValue, "entries" to entries, "truncated" to truncated, "entryCount" to entries.size)
    }

    private fun findChild(parent: Uri, name: String): Pair<Uri, String?>? {
      query(children(parent), arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID,
          DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE)).use { cursor ->
        while (cursor.moveToNext()) {
          context.readRow()
          if (cursor.getString(1) == name) return Pair(
              DocumentsContract.buildDocumentUriUsingTree(parent, cursor.getString(0)), cursor.getString(2))
        }
      }
      return null
    }

    private fun conflictName(parent: Uri, name: String, policy: String): String? {
      require(policy == "skip" || policy == "rename")
      if (findChild(parent, name) == null) return name
      if (policy == "skip") return null
      val dot = name.lastIndexOf('.').takeIf { it > 0 } ?: name.length
      for (index in 2..100) {
        val candidate = "${name.take(dot)} ($index)${name.substring(dot)}"
        if (findChild(parent, candidate) == null) return candidate
      }
      throw FileOperationStopped("conflict_limit")
    }

    fun mkdir(input: Map<String, Any?>): Map<String, Any?> {
      val parent = authorized(input.string("parentUri"), true)
      val name = safeName(input.string("directoryName"))
      val existing = findChild(parent, name)
      if (existing != null) {
        require(existing.second == DocumentsContract.Document.MIME_TYPE_DIR)
        return mapOf("ok" to true, "status" to "existing", "uri" to existing.first.toString(), "name" to name)
      }
      authorized(parent.toString(), true)
      context.mutation()
      val created = DocumentsContract.createDocument(resolver, parent, DocumentsContract.Document.MIME_TYPE_DIR, name)
          ?: throw IllegalStateException("Creation returned no URI")
      context.targetUri = created.toString()
      context.effect = "applied"
      return mapOf("ok" to true, "status" to "created", "uri" to created.toString(), "name" to name)
    }

    fun copy(input: Map<String, Any?>): Map<String, Any?> {
      val source = authorized(input.string("sourceUri"))
      val parent = authorized(input.string("targetParentUri"), true)
      val name = conflictName(parent, safeName(input.string("targetName")), input["conflictPolicy"] as? String ?: "skip")
          ?: return result("copy", "skipped", source, null, "target_exists")
      query(source, arrayOf(DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_MIME_TYPE)).use { cursor ->
        if (!cursor.moveToFirst()) throw IllegalStateException("Source is missing")
        require(cursor.getString(1) != DocumentsContract.Document.MIME_TYPE_DIR)
        if (!cursor.isNull(0) && cursor.getLong(0) > MAX_COPY_BYTES) throw FileOperationStopped("byte_limit")
      }
      // Open/read-authorize the source before creating any destination.
      authorized(source.toString())
      resolver.openInputStream(source).use { stream ->
        val inputStream = stream ?: throw IllegalStateException("Source cannot be opened")
        authorized(parent.toString(), true)
        context.mutation()
        val created = DocumentsContract.createDocument(resolver, parent,
            (input["mimeType"] as? String)?.takeIf { it.isNotBlank() && it.length <= 200 } ?: "application/octet-stream", name)
            ?: throw IllegalStateException("Creation returned no URI")
        context.targetUri = created.toString()
        context.effect = "partial"
        context.check()
        authorized(created.toString(), true)
        resolver.openOutputStream(created, "w").use { output ->
          copyBounded(inputStream, output ?: throw IllegalStateException("Destination cannot be opened"), context)
        }
      }
      context.effect = "applied"
      return result("copy", "done", source, Uri.parse(context.targetUri!!), "copied")
    }

    fun move(input: Map<String, Any?>): Map<String, Any?> {
      val source = authorized(input.string("sourceUri"), true)
      val sourceParent = authorized(input.string("sourceParentUri"), true)
      val parent = authorized(input.string("targetParentUri"), true)
      val name = conflictName(parent, safeName(input.string("targetName")), input["conflictPolicy"] as? String ?: "skip")
          ?: return result("move", "skipped", source, null, "target_exists")
      val original = query(source, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME)).use { cursor ->
        if (!cursor.moveToFirst()) throw IllegalStateException("Source is missing")
        cursor.getString(0)
      }
      authorized(source.toString(), true); authorized(sourceParent.toString(), true); authorized(parent.toString(), true)
      context.mutation()
      var moved = DocumentsContract.moveDocument(resolver, source, sourceParent, parent)
          ?: throw IllegalStateException("Move returned no URI")
      context.targetUri = moved.toString()
      context.effect = if (name == original) "applied" else "partial"
      if (name != original) {
        authorized(moved.toString(), true)
        context.mutation()
        moved = DocumentsContract.renameDocument(resolver, moved, name)
            ?: throw IllegalStateException("Rename returned no URI")
        context.targetUri = moved.toString()
        context.effect = "applied"
      }
      return result("move", "done", source, moved, "moved")
    }

    fun rename(input: Map<String, Any?>): Map<String, Any?> {
      val name = safeName(input.string("targetName"))
      val source = authorized(input.string("sourceUri"), true)
      context.mutation()
      val renamed = DocumentsContract.renameDocument(resolver, source, name)
          ?: throw IllegalStateException("Rename returned no URI")
      context.targetUri = renamed.toString()
      context.effect = "applied"
      return result("rename", "done", source, renamed, "renamed")
    }
  }

  private fun result(action: String, status: String, source: Uri, target: Uri?, reason: String) = mapOf(
      "ok" to (status == "done"), "action" to action, "status" to status, "sourceUri" to source.toString(),
      "targetUri" to target?.toString(), "reason" to reason)

  private fun safeName(value: String): String {
    require(value.isNotBlank() && value.length <= 120 && value != "." && value != ".." &&
        !Regex("[\\\\/:*?\"<>|\\u0000-\\u001F]").containsMatchIn(value))
    return value
  }

  private fun Map<String, Any?>.string(key: String): String = this[key] as? String ?: throw IllegalArgumentException(key)
  private fun Map<String, Any?>.int(key: String, default: Int): Int = (this[key] as? Number)?.toInt() ?: default

  companion object {
    const val MAX_COPY_BYTES = 64L * 1024 * 1024

    internal fun copyBounded(input: InputStream, output: OutputStream, context: FileOperationContext) {
      val buffer = ByteArray(64 * 1024)
      while (true) {
        context.check()
        val size = input.read(buffer)
        context.check()
        if (size < 0) break
        if (context.bytesCopied + size > MAX_COPY_BYTES) throw FileOperationStopped("byte_limit")
        output.write(buffer, 0, size)
        context.bytesCopied += size
      }
      context.check()
      output.flush()
    }
  }
}
