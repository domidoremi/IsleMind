package com.facebook.react.uimanager.style

import android.content.Context
import android.graphics.RectF
import android.util.LayoutDirection
import com.facebook.react.modules.i18nmanager.I18nUtil

private val context = Context()
private val failures = mutableListOf<String>()
private var checks = 0

private fun assertEdges(label: String, actual: RectF, expected: List<Float>) {
  checks++
  val values = listOf(actual.left, actual.top, actual.right, actual.bottom)
  if (values.any { !it.isFinite() } || values != expected) {
    failures.add("$label: expected $expected, got $values")
  }
}

private fun edges(vararg values: Int): List<Float> = values.map { it.toFloat() }
private fun uniform(value: Int): List<Float> = List(4) { value.toFloat() }

fun main() {
  val directions = listOf(
      Triple("LTR", LayoutDirection.LTR, false),
      Triple("RTL physical", LayoutDirection.RTL, false),
      Triple("RTL swapped", LayoutDirection.RTL, true),
  )
  for ((name, direction, swap) in directions) {
    I18nUtil.instance.swapLeftAndRight = swap
    for (edge in LogicalEdge.entries) {
      val widths = BorderInsets()
      widths.setBorderWidth(LogicalEdge.ALL, 3f)
      widths.setBorderWidth(edge, 9f)
      widths.setBorderWidth(edge, Float.NaN)
      assertEdges("$name removed $edge", widths.resolve(direction, context),
          uniform(if (edge == LogicalEdge.ALL) 0 else 3))

      widths.setBorderWidth(edge, 0f)
      val zero = widths.resolve(direction, context)
      checks++
      if (listOf(zero.left, zero.top, zero.right, zero.bottom).none { it == 0f }) {
        failures.add("$name explicit zero $edge did not override inheritance")
      }
      widths.setBorderWidth(edge, null)
      assertEdges("$name null $edge", widths.resolve(direction, context),
          uniform(if (edge == LogicalEdge.ALL) 0 else 3))
    }

    val widths = BorderInsets()
    widths.setBorderWidth(LogicalEdge.ALL, 1f)
    widths.setBorderWidth(LogicalEdge.LEFT, 3f)
    widths.setBorderWidth(LogicalEdge.RIGHT, 4f)
    widths.setBorderWidth(LogicalEdge.START, 5f)
    widths.setBorderWidth(LogicalEdge.END, 6f)
    assertEdges("$name logical precedence", widths.resolve(direction, context),
        if (direction == LayoutDirection.LTR) edges(5, 1, 6, 1) else edges(6, 1, 5, 1))
    widths.setBorderWidth(LogicalEdge.START, Float.NaN)
    widths.setBorderWidth(LogicalEdge.END, Float.NaN)
    assertEdges("$name restored physical edges", widths.resolve(direction, context),
        if (direction == LayoutDirection.RTL && swap) edges(4, 1, 3, 1) else edges(3, 1, 4, 1))
    widths.setBorderWidth(LogicalEdge.ALL, Float.NaN)
    assertEdges("$name removed shorthand retains specific edges", widths.resolve(direction, context),
        if (direction == LayoutDirection.RTL && swap) edges(4, 0, 3, 0) else edges(3, 0, 4, 0))
  }

  I18nUtil.instance.swapLeftAndRight = false
  val cascade = BorderInsets()
  for ((edge, value) in listOf(
      LogicalEdge.ALL to 1, LogicalEdge.HORIZONTAL to 2,
      LogicalEdge.LEFT to 3, LogicalEdge.RIGHT to 4,
      LogicalEdge.START to 5, LogicalEdge.END to 6,
      LogicalEdge.BLOCK to 7, LogicalEdge.VERTICAL to 8,
      LogicalEdge.TOP to 9, LogicalEdge.BOTTOM to 10,
      LogicalEdge.BLOCK_START to 11, LogicalEdge.BLOCK_END to 12,
  )) cascade.setBorderWidth(edge, value.toFloat())
  assertEdges("complete cascade", cascade.resolve(LayoutDirection.LTR, context), edges(5, 11, 6, 12))
  for ((edge, expected) in listOf(
      LogicalEdge.START to edges(3, 11, 6, 12),
      LogicalEdge.END to edges(3, 11, 4, 12),
      LogicalEdge.BLOCK_START to edges(3, 9, 4, 12),
      LogicalEdge.BLOCK_END to edges(3, 9, 4, 10),
      LogicalEdge.LEFT to edges(2, 9, 4, 10),
      LogicalEdge.RIGHT to edges(2, 9, 2, 10),
      LogicalEdge.TOP to edges(2, 7, 2, 10),
      LogicalEdge.BOTTOM to edges(2, 7, 2, 7),
      LogicalEdge.BLOCK to edges(2, 8, 2, 8),
      LogicalEdge.HORIZONTAL to edges(1, 8, 1, 8),
      LogicalEdge.VERTICAL to uniform(1),
      LogicalEdge.ALL to uniform(0),
  )) {
    cascade.setBorderWidth(edge, Float.NaN)
    assertEdges("cascade removed $edge", cascade.resolve(LayoutDirection.LTR, context), expected)
  }

  val retained = BorderInsets()
  repeat(10) { cycle ->
    retained.setBorderWidth(LogicalEdge.ALL, 0f)
    retained.setBorderWidth(LogicalEdge.TOP, 0f)
    retained.setBorderWidth(LogicalEdge.BOTTOM, 1f)
    assertEdges("cycle $cycle Minimal", retained.resolve(LayoutDirection.LTR, context), edges(0, 0, 0, 1))
    retained.setBorderWidth(LogicalEdge.ALL, 1f)
    retained.setBorderWidth(LogicalEdge.TOP, Float.NaN)
    retained.setBorderWidth(LogicalEdge.BOTTOM, Float.NaN)
    assertEdges("cycle $cycle Material", retained.resolve(LayoutDirection.LTR, context), uniform(1))
    retained.setBorderWidth(LogicalEdge.LEFT, 3f)
    assertEdges("cycle $cycle Monet", retained.resolve(LayoutDirection.LTR, context), edges(3, 1, 1, 1))
    retained.setBorderWidth(LogicalEdge.ALL, 0f)
    retained.setBorderWidth(LogicalEdge.LEFT, Float.NaN)
    assertEdges("cycle $cycle Glass", retained.resolve(LayoutDirection.LTR, context), uniform(0))
    retained.setBorderWidth(LogicalEdge.ALL, Float.NaN)
    retained.setBorderWidth(LogicalEdge.LEFT, 3f)
    assertEdges("cycle $cycle Island", retained.resolve(LayoutDirection.LTR, context), edges(3, 0, 0, 0))
    retained.setBorderWidth(LogicalEdge.LEFT, Float.NaN)
  }

  if (failures.isNotEmpty()) {
    System.err.println(failures.joinToString("\n"))
    error("${failures.size} of $checks native border resolution checks failed")
  }
  println("$checks native border resolution checks passed: all edges, inheritance, zero, RTL and retained transitions")
}
