package com.islemind.app

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class AndroidAccessibilityFocusPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      if (name == AndroidAccessibilityFocusModule.NAME) AndroidAccessibilityFocusModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(AndroidAccessibilityFocusModule.NAME to ReactModuleInfo(
        AndroidAccessibilityFocusModule.NAME,
        AndroidAccessibilityFocusModule::class.java.name,
        false, false, false, false
    ))
  }
}
