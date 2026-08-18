const androidReleaseSigningEvidenceSchema = 'islemind.android-release-signing-evidence.v1'

function normalizeCertificateDigest(value) {
  return String(value || '').replace(/[^0-9a-f]/gi, '').toLowerCase()
}

function parseApkSignerOutput(output, apkPath = '') {
  const text = String(output || '')
  const schemes = {}
  const schemePattern = /Verified using v([0-9.]+) scheme \([^\n]*\):\s*(true|false)/gi
  for (const match of text.matchAll(schemePattern)) {
    schemes[`v${match[1]}`] = match[2].toLowerCase() === 'true'
  }

  const subjects = new Map()
  const subjectPattern = /((?:Signer #\d+)|(?:V[0-9.]+ Signer(?: #\d+)?)):?\s+certificate DN:\s*([^\r\n]+)/gi
  for (const match of text.matchAll(subjectPattern)) {
    subjects.set(match[1].toLowerCase(), match[2].trim())
  }

  const signerByDigest = new Map()
  const digestPattern = /((?:Signer #\d+)|(?:V[0-9.]+ Signer(?: #\d+)?)):?\s+certificate SHA-256 digest:\s*([0-9a-f:]+)/gi
  for (const match of text.matchAll(digestPattern)) {
    const digest = normalizeCertificateDigest(match[2])
    if (!signerByDigest.has(digest)) {
      signerByDigest.set(digest, {
        index: signerByDigest.size + 1,
        subject: subjects.get(match[1].toLowerCase()) || '',
        sha256: digest,
      })
    }
  }

  return {
    path: apkPath,
    verified: /^Verifies\s*$/m.test(text),
    schemes,
    signers: [...signerByDigest.values()],
  }
}

function validateAndroidReleaseSigningEvidence({ artifacts, debugCertificateSha256 }) {
  const issues = []
  const normalizedDebugDigest = normalizeCertificateDigest(debugCertificateSha256)
  if (!/^[0-9a-f]{64}$/.test(normalizedDebugDigest)) {
    issues.push('Debug certificate SHA-256 evidence is missing or invalid.')
  }
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    issues.push('No Android release APK signing evidence was provided.')
    return issues
  }

  const releaseDigests = new Set()
  for (const artifact of artifacts) {
    const label = artifact?.path || '<unknown APK>'
    if (!artifact?.verified) {
      issues.push(`${label}: APK signature verification did not pass.`)
    }
    const hasModernSignatureScheme = Object.entries(artifact?.schemes || {})
      .some(([scheme, verified]) => verified && Number.parseFloat(scheme.slice(1)) >= 2)
    if (!hasModernSignatureScheme) {
      issues.push(`${label}: APK must verify with signature scheme v2 or newer.`)
    }
    if (!Array.isArray(artifact?.signers) || artifact.signers.length !== 1) {
      issues.push(`${label}: expected exactly one APK signer.`)
      continue
    }

    const signer = artifact.signers[0]
    const digest = normalizeCertificateDigest(signer.sha256)
    if (!/^[0-9a-f]{64}$/.test(digest)) {
      issues.push(`${label}: signer SHA-256 digest is missing or invalid.`)
      continue
    }
    releaseDigests.add(digest)
    if (normalizedDebugDigest && digest === normalizedDebugDigest) {
      issues.push(`${label}: APK is signed with the Android debug certificate.`)
    }
    if (/\bCN=Android Debug\b/i.test(String(signer.subject || ''))) {
      issues.push(`${label}: signer subject identifies the Android debug certificate.`)
    }
  }

  if (releaseDigests.size > 1) {
    issues.push('Release APKs are not signed by one consistent certificate.')
  }
  return issues
}

module.exports = {
  androidReleaseSigningEvidenceSchema,
  normalizeCertificateDigest,
  parseApkSignerOutput,
  validateAndroidReleaseSigningEvidence,
}
