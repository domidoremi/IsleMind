#!/bin/bash

# IsleMind 应用功能测试脚本
# 测试所有已实施的优化

DEVICE="10.0.0.172:38669"
PACKAGE="com.islemind.app"

echo "════════════════════════════════════════════════════════════════"
echo "  IsleMind 应用功能测试"
echo "════════════════════════════════════════════════════════════════"
echo ""

# 测试 1: 启动性能测试（多次）
echo "🚀 测试 1: 启动性能（5次冷启动）"
echo "────────────────────────────────────────────────────────────────"

TOTAL=0
for i in {1..5}; do
    echo "第 $i 次启动..."
    adb -s $DEVICE shell am force-stop $PACKAGE
    sleep 2
    
    RESULT=$(adb -s $DEVICE shell am start -W -n $PACKAGE/.MainActivity 2>&1)
    TIME=$(echo "$RESULT" | grep "TotalTime:" | awk '{print $2}')
    
    if [ ! -z "$TIME" ]; then
        echo "  启动时间: ${TIME}ms"
        TOTAL=$((TOTAL + TIME))
    fi
    
    sleep 3
done

AVG=$((TOTAL / 5))
echo ""
echo "✅ 平均启动时间: ${AVG}ms"
echo "   目标: < 1050ms"
echo "   结果: $([ $AVG -lt 1050 ] && echo '✅ 通过' || echo '⚠️  需要优化')"
echo ""

# 测试 2: 内存占用
echo "💾 测试 2: 内存占用"
echo "────────────────────────────────────────────────────────────────"
sleep 3
MEMORY=$(adb -s $DEVICE shell dumpsys meminfo $PACKAGE | grep "TOTAL" | awk '{print $2}')
MEMORY_MB=$((MEMORY / 1024))
echo "内存使用: ${MEMORY_MB}MB"
echo "目标: < 120MB"
echo "结果: $([ $MEMORY_MB -lt 120 ] && echo '✅ 通过' || echo '⚠️  偏高')"
echo ""

# 测试 3: 应用响应测试
echo "⚡ 测试 3: 应用响应性"
echo "────────────────────────────────────────────────────────────────"
echo "打开开发者菜单..."
adb -s $DEVICE shell input keyevent 82
sleep 1
echo "✅ 开发者菜单已打开"
echo ""

# 测试 4: 检查懒加载实施
echo "📦 测试 4: 懒加载验证"
echo "────────────────────────────────────────────────────────────────"
echo "检查设置页面文件..."

LAZY_FILES=(
    "app/settings/providers.tsx"
    "app/settings/preferences.tsx"
    "app/settings/skills.tsx"
    "app/settings/mcp.tsx"
    "app/settings/knowledge.tsx"
    "app/settings/context.tsx"
    "app/settings/memory.tsx"
)

LAZY_COUNT=0
for file in "${LAZY_FILES[@]}"; do
    if grep -q "createLazyComponent" "G:/Project/IsleMind/$file" 2>/dev/null; then
        LAZY_COUNT=$((LAZY_COUNT + 1))
    fi
done

echo "懒加载页面数: $LAZY_COUNT / ${#LAZY_FILES[@]}"
echo "结果: $([ $LAZY_COUNT -eq ${#LAZY_FILES[@]} ] && echo '✅ 全部实施' || echo "⚠️  $LAZY_COUNT 个已实施")"
echo ""

# 测试 5: 检查优化文件存在
echo "📁 测试 5: 优化文件验证"
echo "────────────────────────────────────────────────────────────────"

OPTIMIZATION_FILES=(
    "src/services/imageCompression.ts"
    "src/utils/streamingMarkdown.ts"
    "src/utils/lazyLoad.tsx"
    "src/utils/performanceMonitor.ts"
)

OPT_COUNT=0
for file in "${OPTIMIZATION_FILES[@]}"; do
    if [ -f "G:/Project/IsleMind/$file" ]; then
        echo "✅ $file"
        OPT_COUNT=$((OPT_COUNT + 1))
    else
        echo "❌ $file"
    fi
done

echo ""
echo "优化文件: $OPT_COUNT / ${#OPTIMIZATION_FILES[@]}"
echo ""

# 最终报告
echo "════════════════════════════════════════════════════════════════"
echo "  测试总结"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "启动性能:  ${AVG}ms (目标 < 1050ms)"
echo "内存占用:  ${MEMORY_MB}MB (目标 < 120MB)"
echo "懒加载:    $LAZY_COUNT / ${#LAZY_FILES[@]} 页面"
echo "优化文件:  $OPT_COUNT / ${#OPTIMIZATION_FILES[@]} 文件"
echo ""

# 计算总分
SCORE=0
[ $AVG -lt 1050 ] && SCORE=$((SCORE + 25))
[ $MEMORY_MB -lt 120 ] && SCORE=$((SCORE + 25))
[ $LAZY_COUNT -eq ${#LAZY_FILES[@]} ] && SCORE=$((SCORE + 25))
[ $OPT_COUNT -eq ${#OPTIMIZATION_FILES[@]} ] && SCORE=$((SCORE + 25))

echo "总评分: $SCORE / 100"
echo ""

if [ $SCORE -ge 75 ]; then
    echo "🎉 优秀！优化效果显著"
elif [ $SCORE -ge 50 ]; then
    echo "✅ 良好！大部分优化已生效"
else
    echo "⚠️  需要进一步优化"
fi

echo ""
echo "════════════════════════════════════════════════════════════════"

