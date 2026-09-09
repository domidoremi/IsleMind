package com.islemind.app

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class AndroidFileIntegrityPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      if (name == AndroidFileIntegrityModule.NAME) AndroidFileIntegrityModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(AndroidFileIntegrityModule.NAME to ReactModuleInfo(
        AndroidFileIntegrityModule.NAME,
        AndroidFileIntegrityModule::class.java.name,
        false, false, false, false
    ))
  }
}
