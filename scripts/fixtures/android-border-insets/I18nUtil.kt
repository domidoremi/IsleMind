package com.facebook.react.modules.i18nmanager

import android.content.Context

class I18nUtil {
  var swapLeftAndRight = true

  fun doLeftAndRightSwapInRTL(context: Context): Boolean = swapLeftAndRight

  companion object {
    val instance = I18nUtil()
  }
}
