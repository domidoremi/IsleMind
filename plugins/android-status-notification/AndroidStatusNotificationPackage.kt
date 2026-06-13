package com.islemind.app

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class AndroidStatusNotificationPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      if (name == AndroidStatusNotificationModule.NAME) {
        AndroidStatusNotificationModule(reactContext)
      } else {
        null
      }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
        AndroidStatusNotificationModule.NAME to ReactModuleInfo(
            AndroidStatusNotificationModule.NAME,
            AndroidStatusNotificationModule::class.java.name,
            false,
            false,
            false,
            false
        )
    )
  }
}
