package com.islemind.app

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule
import java.net.Inet4Address
import java.net.InetAddress
import java.net.Proxy
import java.net.UnknownHostException
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okio.Buffer

@ReactModule(name = AndroidTrustedWebFetchModule.NAME)
class AndroidTrustedWebFetchModule(
    reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  private data class TargetPermit(
      val canonicalUrl: String,
      val hostname: String,
      val addresses: List<InetAddress>,
      val addressDigest: String,
      val expiresAt: Long
  )

  private val resolverExecutor: ExecutorService = Executors.newFixedThreadPool(2)
  private val permits = ConcurrentHashMap<String, TargetPermit>()
  private val activeCalls = ConcurrentHashMap<String, Call>()
  private val cancelledOperations = ConcurrentHashMap.newKeySet<String>()

  override fun getName(): String = NAME

  @ReactMethod
  fun admitTarget(operationId: String, url: String, promise: Promise) {
    if (!isSafeOperationId(operationId)) {
      promise.resolve(admissionResult("unavailable", "Invalid operation identity."))
      return
    }
    resolverExecutor.execute {
      try {
        throwIfCancelled(operationId)
        val parsed = requirePublicHttpsUrl(url)
        val addresses = InetAddress.getAllByName(parsed.host).toList()
        throwIfCancelled(operationId)
        if (addresses.isEmpty()) {
          promise.resolve(admissionResult("unresolved", "The target hostname did not resolve."))
          return@execute
        }
        if (addresses.any { !isPublicAddress(it) }) {
          promise.resolve(admissionResult("denied", "The target resolved outside the public network boundary."))
          return@execute
        }

        prunePermits()
        if (permits.size >= MAX_PERMITS) {
          promise.resolve(admissionResult("unavailable", "The trusted target permit limit was reached."))
          return@execute
        }
        val token = UUID.randomUUID().toString()
        val digest = digestAddresses(addresses)
        permits[token] = TargetPermit(
            canonicalUrl = url,
            hostname = parsed.host,
            addresses = addresses,
            addressDigest = digest,
            expiresAt = System.currentTimeMillis() + PERMIT_TTL_MS
        )
        promise.resolve(Arguments.createMap().apply {
          putString("status", "allowed")
          putString("canonicalUrl", url)
          putString("permitToken", token)
          putString("resolvedAddressDigest", digest)
          putString("classification", "public")
        })
      } catch (_: CancelledOperationException) {
        promise.reject(ERROR_CANCELLED, "Trusted target admission was cancelled.")
      } catch (_: UnknownHostException) {
        promise.resolve(admissionResult("unresolved", "The target hostname did not resolve."))
      } catch (_: IllegalArgumentException) {
        promise.resolve(admissionResult("denied", "The target is outside the public HTTPS boundary."))
      } catch (_: Exception) {
        promise.resolve(admissionResult("unavailable", "Trusted target admission is unavailable."))
      } finally {
        cancelledOperations.remove(operationId)
      }
    }
  }

  @ReactMethod
  fun fetchPage(
      operationId: String,
      url: String,
      permitToken: String,
      maxBytesValue: Double,
      acceptedMimeTypesValue: ReadableArray,
      timeoutMsValue: Double,
      promise: Promise
  ) {
    if (!isSafeOperationId(operationId)) {
      promise.reject(ERROR_TARGET_DENIED, "Invalid operation identity.")
      return
    }
    val maxBytes = maxBytesValue.toInt()
    val timeoutMs = timeoutMsValue.toLong()
    if (maxBytes !in 1..MAX_RESPONSE_BYTES || timeoutMs !in MIN_TIMEOUT_MS..MAX_TIMEOUT_MS) {
      promise.reject(ERROR_TARGET_DENIED, "The trusted fetch bounds are invalid.")
      return
    }
    if (cancelledOperations.contains(operationId)) {
      promise.reject(ERROR_CANCELLED, "Trusted fetch was cancelled.")
      cancelledOperations.remove(operationId)
      return
    }

    prunePermits()
    val permit = permits.remove(permitToken)
    if (permit == null || permit.expiresAt < System.currentTimeMillis() || permit.canonicalUrl != url) {
      promise.reject(ERROR_TARGET_DENIED, "The trusted target permit is missing, expired, or does not match the request.")
      return
    }
    val acceptedMimeTypes = (0 until acceptedMimeTypesValue.size())
        .mapNotNull { acceptedMimeTypesValue.getString(it)?.trim()?.lowercase() }
        .filter { it.isNotEmpty() }
        .toSet()
    if (acceptedMimeTypes.isEmpty()) {
      promise.reject(ERROR_MIME_UNSUPPORTED, "No response MIME type was admitted.")
      return
    }

    val pinnedDns = object : Dns {
      override fun lookup(hostname: String): List<InetAddress> {
        if (!hostname.equals(permit.hostname, ignoreCase = true)) {
          throw UnknownHostException("Unadmitted hostname.")
        }
        return permit.addresses
      }
    }
    val client = OkHttpClient.Builder()
        .dns(pinnedDns)
        .proxy(Proxy.NO_PROXY)
        .followRedirects(false)
        .followSslRedirects(false)
        .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
        .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
        .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
        .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
        .build()
    val request = Request.Builder()
        .url(url)
        .get()
        .header("Accept", acceptedMimeTypes.joinToString(", "))
        .header("Cache-Control", "no-store")
        .build()
    val call = client.newCall(request)
    activeCalls[operationId] = call
    call.enqueue(object : Callback {
      override fun onFailure(call: Call, error: java.io.IOException) {
        activeCalls.remove(operationId)
        val wasCancelled = cancelledOperations.remove(operationId) || call.isCanceled()
        if (wasCancelled) {
          promise.reject(ERROR_CANCELLED, "Trusted fetch was cancelled.")
        } else {
          promise.reject(ERROR_FETCH_FAILED, "Trusted fetch failed before a bounded response was received.")
        }
      }

      override fun onResponse(call: Call, response: Response) {
        activeCalls.remove(operationId)
        try {
          throwIfCancelled(operationId)
          response.use {
            val responseUrl = it.request.url.toString()
            if (responseUrl != permit.canonicalUrl) {
              promise.reject(ERROR_TARGET_DENIED, "The connected request target does not match its permit.")
              return
            }
            val status = it.code
            val isRedirect = status in 300..399
            val mimeType = it.header("Content-Type")
                ?.substringBefore(';')
                ?.trim()
                ?.lowercase()
                ?.takeIf { value -> value.isNotEmpty() }
            if (!isRedirect && (mimeType == null || !acceptedMimeTypes.contains(mimeType))) {
              promise.reject(ERROR_MIME_UNSUPPORTED, "The response MIME type is outside the admitted set.")
              return
            }
            val body = it.body
            val declaredLength = body?.contentLength() ?: 0L
            if (declaredLength > maxBytes) {
              promise.reject(ERROR_SIZE_LIMIT, "The response exceeded the admitted byte limit.")
              return
            }
            val bytes = if (isRedirect || body == null) {
              ByteArray(0)
            } else {
              readBoundedBody(body.source(), maxBytes)
            }
            throwIfCancelled(operationId)
            val text = if (isRedirect) "" else decodeUtf8(bytes)
            promise.resolve(Arguments.createMap().apply {
              putString("requestedUrl", permit.canonicalUrl)
              putString("finalUrl", permit.canonicalUrl)
              putInt("status", status)
              if (mimeType == null) putNull("mimeType") else putString("mimeType", mimeType)
              putInt("byteLength", bytes.size)
              putString("body", text)
              val redirectUrl = it.header("Location")
              if (redirectUrl == null) putNull("redirectUrl") else putString("redirectUrl", redirectUrl)
            })
          }
        } catch (_: CancelledOperationException) {
          promise.reject(ERROR_CANCELLED, "Trusted fetch was cancelled.")
        } catch (_: ResponseTooLargeException) {
          promise.reject(ERROR_SIZE_LIMIT, "The response exceeded the admitted byte limit.")
        } catch (_: Exception) {
          promise.reject(ERROR_FETCH_FAILED, "Trusted fetch returned an invalid bounded response.")
        } finally {
          cancelledOperations.remove(operationId)
        }
      }
    })
  }

  @ReactMethod
  fun cancelOperation(operationId: String) {
    if (!isSafeOperationId(operationId)) return
    cancelledOperations.add(operationId)
    activeCalls.remove(operationId)?.cancel()
  }

  override fun invalidate() {
    activeCalls.values.forEach { it.cancel() }
    activeCalls.clear()
    permits.clear()
    cancelledOperations.clear()
    resolverExecutor.shutdownNow()
    super.invalidate()
  }

  private fun requirePublicHttpsUrl(value: String): okhttp3.HttpUrl {
    val parsed = value.toHttpUrlOrNull() ?: throw IllegalArgumentException("Invalid URL.")
    if (parsed.scheme != "https" || parsed.port != 443 || parsed.username.isNotEmpty() || parsed.password.isNotEmpty()) {
      throw IllegalArgumentException("Only public HTTPS targets on port 443 are supported.")
    }
    if (parsed.host.isBlank()) throw IllegalArgumentException("A hostname is required.")
    return parsed
  }

  private fun isPublicAddress(address: InetAddress): Boolean {
    if (
        address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress ||
        address.isSiteLocalAddress || address.isMulticastAddress
    ) return false
    val bytes = address.address
    if (address is Inet4Address) return isPublicIpv4(bytes)
    if (bytes.size != 16) return false
    if ((bytes[0].toInt() and 0xfe) == 0xfc) return false
    if (
        bytes[0].toInt() == 0x20 && bytes[1].toInt() == 0x01 &&
        bytes[2].toInt() == 0x0d && (bytes[3].toInt() and 0xff) == 0xb8
    ) return false
    val isMappedIpv4 = bytes.sliceArray(0..9).all { it.toInt() == 0 } &&
        (bytes[10].toInt() and 0xff) == 0xff && (bytes[11].toInt() and 0xff) == 0xff
    return !isMappedIpv4 || isPublicIpv4(bytes.sliceArray(12..15))
  }

  private fun isPublicIpv4(bytes: ByteArray): Boolean {
    if (bytes.size != 4) return false
    val a = bytes[0].toInt() and 0xff
    val b = bytes[1].toInt() and 0xff
    val c = bytes[2].toInt() and 0xff
    return !(
        a == 0 || a == 10 || a == 127 || a >= 224 ||
        (a == 100 && b in 64..127) ||
        (a == 169 && b == 254) ||
        (a == 172 && b in 16..31) ||
        (a == 192 && b == 0) ||
        (a == 192 && b == 168) ||
        (a == 198 && (b == 18 || b == 19)) ||
        (a == 198 && b == 51 && c == 100) ||
        (a == 203 && b == 0 && c == 113)
    )
  }

  private fun readBoundedBody(source: okio.BufferedSource, maxBytes: Int): ByteArray {
    val buffer = Buffer()
    var total = 0L
    while (true) {
      val allowance = maxBytes.toLong() + 1L - total
      val read = source.read(buffer, minOf(8_192L, allowance))
      if (read == -1L) break
      total += read
      if (total > maxBytes) throw ResponseTooLargeException()
    }
    return buffer.readByteArray()
  }

  private fun decodeUtf8(bytes: ByteArray): String {
    val decoder = Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
    return decoder.decode(ByteBuffer.wrap(bytes)).toString()
  }

  private fun digestAddresses(addresses: List<InetAddress>): String {
    val value = addresses.mapNotNull { it.hostAddress }.sorted().joinToString(",")
    val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
    return digest.joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
  }

  private fun admissionResult(status: String, reason: String) = Arguments.createMap().apply {
    putString("status", status)
    putString("reason", reason)
  }

  private fun prunePermits() {
    val now = System.currentTimeMillis()
    permits.entries.removeIf { it.value.expiresAt < now }
  }

  private fun throwIfCancelled(operationId: String) {
    if (cancelledOperations.contains(operationId)) throw CancelledOperationException()
  }

  private fun isSafeOperationId(value: String): Boolean =
      value.length in 8..160 && value.all { it.isLetterOrDigit() || it == '.' || it == '_' || it == ':' || it == '-' }

  private class CancelledOperationException : RuntimeException()
  private class ResponseTooLargeException : RuntimeException()

  companion object {
    const val NAME = "AndroidTrustedWebFetch"
    private const val MAX_PERMITS = 128
    private const val PERMIT_TTL_MS = 30_000L
    private const val MAX_RESPONSE_BYTES = 2 * 1024 * 1024
    private const val MIN_TIMEOUT_MS = 1_000L
    private const val MAX_TIMEOUT_MS = 15_000L
    private const val ERROR_CANCELLED = "trusted_fetch_cancelled"
    private const val ERROR_TARGET_DENIED = "trusted_fetch_target_denied"
    private const val ERROR_SIZE_LIMIT = "trusted_fetch_size_limit"
    private const val ERROR_MIME_UNSUPPORTED = "trusted_fetch_mime_unsupported"
    private const val ERROR_FETCH_FAILED = "trusted_fetch_failed"
  }
}
