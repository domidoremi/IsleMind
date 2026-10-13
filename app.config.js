// Keep direct APK distribution as the default; Play builds must opt in at build time.
module.exports = ({ config }) => {
  const playProfile = process.env.EAS_BUILD_PROFILE === 'google-play'
  const distributionChannel = process.env.ISLEMIND_DISTRIBUTION || (playProfile ? 'google-play' : 'github')
  const harnessAdmission = process.env.ISLEMIND_AGENT_HARNESS_ENABLED ?? '1'
  if (!['0', '1'].includes(harnessAdmission)) throw new Error('ISLEMIND_AGENT_HARNESS_ENABLED must be 0 or 1.')
  if (!['github', 'google-play'].includes(distributionChannel)) {
    throw new Error('ISLEMIND_DISTRIBUTION must be github or google-play.')
  }
  if (playProfile && distributionChannel !== 'google-play') {
    throw new Error('The google-play build profile cannot enable external APK updates.')
  }

  const playBlockedPermissions = [
    'android.permission.REQUEST_INSTALL_PACKAGES',
    'android.permission.SYSTEM_ALERT_WINDOW',
  ]
  // Public build configuration, never a provider/user setting. Missing operations
  // information disables reporting; it is not permission to ship an unready Play build.
  const contentReporting = {
    endpoint: process.env.ISLEMIND_REPORT_ENDPOINT,
    operator: process.env.ISLEMIND_REPORT_OPERATOR,
    privacyPolicyUrl: process.env.ISLEMIND_PRIVACY_POLICY_URL,
  }
  const reportingValues = Object.values(contentReporting)
  if (reportingValues.some(Boolean) && !reportingValues.every(value => typeof value === 'string' && value.trim())) {
    throw new Error('Content reporting requires endpoint, operator and privacy policy build configuration together.')
  }
  return {
    ...config,
    extra: { ...config.extra, distributionChannel, agentHarnessEnabled: harnessAdmission === '1', contentReporting: reportingValues.every(Boolean) ? contentReporting : null },
    android: distributionChannel === 'google-play' ? {
      ...config.android,
      permissions: (config.android?.permissions || []).filter(permission => !playBlockedPermissions.includes(permission)),
      blockedPermissions: [...new Set([...(config.android?.blockedPermissions || []), ...playBlockedPermissions])],
    } : config.android,
  }
}
