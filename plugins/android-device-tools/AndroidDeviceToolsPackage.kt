package com.islemind.app

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class AndroidDeviceToolsPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      if (name == AndroidDeviceToolsModule.NAME) {
        AndroidDeviceToolsModule(reactContext)
      } else {
        null
      }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
        AndroidDeviceToolsModule.NAME to ReactModuleInfo(
            AndroidDeviceToolsModule.NAME,
            AndroidDeviceToolsModule::class.java.name,
            false,
            false,
            false,
            false
        )
    )
  }
}
