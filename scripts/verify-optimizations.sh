#!/bin/bash

# IsleMind 性能优化 - 快速验证和测试脚本
# 用途：一键验证所有优化并运行测试

echo "════════════════════════════════════════════════════════════════"
echo "  🚀 IsleMind 性能优化 - 快速验证"
echo "════════════════════════════════════════════════════════════════"
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查计数
TOTAL=0
PASSED=0
FAILED=0

check_file() {
    TOTAL=$((TOTAL + 1))
    if [ -f "$1" ]; then
        echo -e "${GREEN}✅${NC} $2"
        PASSED=$((PASSED + 1))
        return 0
    else
        echo -e "${RED}❌${NC} $2 (文件不存在: $1)"
        FAILED=$((FAILED + 1))
        return 1
    fi
}

echo "📦 检查核心优化文件"
echo "────────────────────────────────────────────────────────────────"

# 图片压缩
check_file "src/services/imageCompression.ts" "图片压缩服务"
check_file "src/services/attachment.ts" "附件服务"

# 流式 Markdown
check_file "src/utils/streamingMarkdown.ts" "流式 Markdown 工具"

# 懒加载
check_file "src/utils/lazyLoad.tsx" "懒加载工具"
check_file "app/settings/providers.tsx" "providers 页面"
check_file "app/settings/preferences.tsx" "preferences 页面"
check_file "app/settings/skills.tsx" "skills 页面"
check_file "app/settings/mcp.tsx" "mcp 页面"
check_file "app/settings/knowledge.tsx" "knowledge 页面"
check_file "app/settings/context.tsx" "context 页面"
check_file "app/settings/memory.tsx" "memory 页面"

# React.memo
check_file "src/components/chat/MessageBubble.tsx" "MessageBubble 组件"
check_file "src/components/chat/MessageContent.tsx" "MessageContent 组件"

# 性能监控
check_file "src/utils/performanceMonitor.ts" "性能监控工具"

echo ""
echo "📚 检查文档"
echo "────────────────────────────────────────────────────────────────"

check_file "docs/COMPLETE_OPTIMIZATION_REPORT.md" "完整优化报告"
check_file "docs/lazy-loading-implementation-guide.md" "懒加载指南"
check_file "docs/performance-monitoring-guide.md" "性能监控指南"
check_file ".clauderules" "Claude 规则文件"

echo ""
echo "🔧 检查脚本"
echo "────────────────────────────────────────────────────────────────"

check_file "scripts/verify-optimizations.js" "验证脚本"

echo ""
echo "════════════════════════════════════════════════════════════════"
echo -e "  ✅ 通过: ${GREEN}${PASSED}${NC} / ${TOTAL}"
echo -e "  ❌ 失败: ${RED}${FAILED}${NC} / ${TOTAL}"
echo "════════════════════════════════════════════════════════════════"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 所有文件验证通过！${NC}"
    echo ""
    echo "下一步执行："
    echo "  1. npm install expo-image-manipulator"
    echo "  2. npm run type-check"
    echo "  3. npm run test"
    echo "  4. npm run android"
    echo ""
    exit 0
else
    echo -e "${RED}⚠️  发现缺失文件，请检查！${NC}"
    echo ""
    exit 1
fi
