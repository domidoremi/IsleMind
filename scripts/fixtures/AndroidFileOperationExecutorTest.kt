package com.islemind.app

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

private fun BoundedFileOperationExecutor.run(id: String, work: (FileOperationContext) -> Map<String, Any?>): CompletableFuture<Map<String, Any?>> {
  val result = CompletableFuture<Map<String, Any?>>()
  submit(id, "copy", 60000, work) { result.complete(it) }
  return result
}
private fun <T> CompletableFuture<T>.finish(): T = get(5, TimeUnit.SECONDS)

fun main() {
  val clock = AtomicLong(0)
  val executor = BoundedFileOperationExecutor { clock.get() }
  val entered = CountDownLatch(1)
  val release = CountDownLatch(1)
  try {
    val first = executor.run("first") { context ->
      context.mutation(); context.targetUri = "content://test/partial"; context.effect = "partial"
      entered.countDown()
      check(release.await(5, TimeUnit.SECONDS))
      context.check()
      error("cancelled operation continued")
    }
    check(entered.await(5, TimeUnit.SECONDS))
    check(executor.run("first") { error("duplicate dispatched") }.finish()["reason"] == "invalid_request_id")
    val dispatched = AtomicBoolean(false)
    val queued = (1..8).map { index -> executor.run("queued-$index") { dispatched.set(true); emptyMap() } }
    check(executor.run("overflow") { error("overflow dispatched") }.finish()["reason"] == "capacity")
    check(executor.cancel("first"))
    check(!first.isDone) // A blocked provider still owns the single slot.
    check(!dispatched.get())
    check(executor.cancel("queued-1"))
    clock.set(60001) // Deadline includes queue time, not only execution time.
    release.countDown()
    val receipt = first.finish()
    check(receipt["status"] == "cancelled" && receipt["effect"] == "partial")
    check(receipt["targetUri"] == "content://test/partial")
    check(queued.first().finish()["status"] == "cancelled")
    queued.drop(1).forEach { check(it.finish()["reason"] == "timeout") }
    check(!dispatched.get())
    check(!executor.cancel("first"))
    check(executor.run("throw-after-effect") { context ->
      context.completedSteps.add("moved")
      context.mutation(); throw IllegalStateException("provider failed after dispatch")
    }.finish().let { it["status"] == "failed" && it["effect"] == "uncertain" && it["completedSteps"] == listOf("moved") })
    check(executor.run("permission") { throw SecurityException() }.finish().let {
      it["reason"] == "permission_required" && it["effect"] == "none"
    })
    check(executor.run("success") { context -> context.effect = "applied"; mapOf("status" to "done") }
      .finish().let { it["status"] == "succeeded" && it["effect"] == "applied" })
  } finally { release.countDown(); executor.close() }
  check(executor.run("after-close") { error("closed executor dispatched") }.finish()["reason"] == "capacity")

  val deadlineExecutor = BoundedFileOperationExecutor { 0L }
  val cancellationDelivered = CountDownLatch(1)
  val providerRelease = CountDownLatch(1)
  val timed = CompletableFuture<Map<String, Any?>>()
  try {
    deadlineExecutor.submit("deadline-live", "scan", 1000, { context ->
      context.onCancel { cancellationDelivered.countDown() }
      check(providerRelease.await(5, TimeUnit.SECONDS))
      emptyMap()
    }) { timed.complete(it) }
    check(cancellationDelivered.await(4, TimeUnit.SECONDS))
    check(!timed.isDone) // Deadline signals the provider but cannot fabricate completed cancellation.
    providerRelease.countDown()
    check(timed.finish().let { it["reason"] == "timeout" && it["status"] == "failed" && it["effect"] == "none" })
  } finally { providerRelease.countDown(); deadlineExecutor.close() }

  val context = FileOperationContext(1000, { 0 }, { it() })
  val output = ByteArrayOutputStream()
  BoundedFileCopy.copy(ByteArrayInputStream(byteArrayOf(1, 2, 3)), output, context)
  check(output.toByteArray().contentEquals(byteArrayOf(1, 2, 3)) && context.bytesCopied == 3L)
  val cancel = FileOperationContext(1000, { 0 }, { it() })
  val cancelledOutput = ByteArrayOutputStream()
  val cancelDuringRead = object : InputStream() {
    override fun read(): Int = error("bulk reads required")
    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
      cancel.cancel("cancelled"); return 1
    }
  }
  try { BoundedFileCopy.copy(cancelDuringRead, cancelledOutput, cancel); error("copy ignored cancellation") }
  catch (error: FileOperationStopped) { check(error.code == "cancelled") }
  check(cancelledOutput.size() == 0 && cancel.bytesCopied == 0L)

  val bounded = FileOperationContext(1000, { 0 }, { it() })
  var written = 0L
  val endless = object : InputStream() {
    override fun read(): Int = 0
    override fun read(buffer: ByteArray, offset: Int, length: Int): Int = length
  }
  val sink = object : OutputStream() {
    override fun write(value: Int) { written++ }
    override fun write(buffer: ByteArray, offset: Int, length: Int) { written += length }
  }
  try { BoundedFileCopy.copy(endless, sink, bounded); error("byte limit ignored") }
  catch (error: FileOperationStopped) { check(error.code == "byte_limit") }
  check(written == BoundedFileCopy.MAX_BYTES && bounded.bytesCopied == written)
  val failedWrite = FileOperationContext(1000, { 0 }, { it() })
  try {
    BoundedFileCopy.copy(ByteArrayInputStream(byteArrayOf(1, 2)), object : OutputStream() {
      override fun write(value: Int) { throw java.io.IOException("write failed") }
    }, failedWrite)
    error("failed write succeeded")
  } catch (_: java.io.IOException) { check(failedWrite.bytesCopied == 0L) }
  val resultBound = FileOperationContext(1000, { 0 }, { it() })
  repeat(64) { check(resultBound.retainResultText("x".repeat(4096), 4096).length == 4096) }
  try { resultBound.retainResultText("x", 4096); error("response budget ignored") }
  catch (error: FileOperationStopped) { check(error.code == "response_limit") }
  val fieldBound = FileOperationContext(1000, { 0 }, { it() })
  try { fieldBound.retainResultText("x".repeat(256), 255); error("field limit ignored") }
  catch (error: FileOperationStopped) { check(error.code == "response_limit") }
  check(fieldBound.effect == "none")
  println("Android file executor JVM checks passed: capacity, duplicate, cancellation, deadline, effects, copy/response bounds, I/O failure")
}
