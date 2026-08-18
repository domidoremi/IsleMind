const androidReleaseOptimizationGradleArgs = Object.freeze([
  '-Pandroid.enableMinifyInReleaseBuilds=true',
  '-Pandroid.enableShrinkResourcesInReleaseBuilds=true',
])

function resolveAndroidReleaseOptimization({ buildType, optimizeRelease = false }) {
  if (optimizeRelease && buildType !== 'release') {
    throw new Error('--optimize-release can only be used with --release.')
  }

  return {
    enabled: buildType === 'release' && optimizeRelease,
    gradleArgs: buildType === 'release' && optimizeRelease
      ? [...androidReleaseOptimizationGradleArgs]
      : [],
  }
}

module.exports = {
  androidReleaseOptimizationGradleArgs,
  resolveAndroidReleaseOptimization,
}
