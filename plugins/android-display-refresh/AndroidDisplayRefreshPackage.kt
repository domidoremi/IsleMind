package com.islemind.app

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class AndroidDisplayRefreshPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      if (name == AndroidDisplayRefreshModule.NAME) AndroidDisplayRefreshModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(AndroidDisplayRefreshModule.NAME to ReactModuleInfo(
        AndroidDisplayRefreshModule.NAME, AndroidDisplayRefreshModule::class.java.name,
        false, false, false, false
    ))
  }
}
