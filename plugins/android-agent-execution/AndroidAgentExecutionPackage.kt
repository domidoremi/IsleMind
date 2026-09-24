package com.islemind.app

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class AndroidAgentExecutionPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      if (name == AndroidAgentExecutionModule.NAME) AndroidAgentExecutionModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(AndroidAgentExecutionModule.NAME to ReactModuleInfo(
        AndroidAgentExecutionModule.NAME, AndroidAgentExecutionModule::class.java.name,
        false, false, false, false
    ))
  }
}
