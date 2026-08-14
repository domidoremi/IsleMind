package com.islemind.app

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class AndroidTrustedWebFetchPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      if (name == AndroidTrustedWebFetchModule.NAME) {
        AndroidTrustedWebFetchModule(reactContext)
      } else {
        null
      }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
        AndroidTrustedWebFetchModule.NAME to ReactModuleInfo(
            AndroidTrustedWebFetchModule.NAME,
            AndroidTrustedWebFetchModule::class.java.name,
            false,
            false,
            false,
            false
        )
    )
  }
}
