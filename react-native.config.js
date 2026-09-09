module.exports = {
  dependencies: {
    'onnxruntime-react-native': {
      platforms: {
        // ORT 1.24.3 ships a legacy unimodule.json but exposes a ReactPackage,
        // not an Expo module. Expo 57 otherwise omits it from PackageList.
        // Explicit Android configuration keeps standard RN package discovery.
        android: {},
      },
    },
  },
}
