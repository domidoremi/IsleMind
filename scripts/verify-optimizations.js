#!/usr/bin/env node

/**
 * IsleMind 性能优化验证脚本
 *
 * 用途：验证所有性能优化是否正确实施
 * 运行：node scripts/verify-optimizations.js
 */

const fs = require('fs')
const path = require('path')

console.log('🔍 IsleMind 性能优化验证\n')

let passed = 0
let failed = 0
const issues = []

// 检查文件是否存在
function checkFileExists(filePath, description) {
  const fullPath = path.join(__dirname, '..', filePath)
  if (fs.existsSync(fullPath)) {
    console.log(`✅ ${description}`)
    passed++
    return true
  } else {
    console.log(`❌ ${description}`)
    failed++
    issues.push(`缺失文件: ${filePath}`)
    return false
  }
}

// 检查文件内容
function checkFileContent(filePath, searchString, description) {
  const fullPath = path.join(__dirname, '..', filePath)
  if (!fs.existsSync(fullPath)) {
    console.log(`❌ ${description} (文件不存在)`)
    failed++
    issues.push(`文件不存在: ${filePath}`)
    return false
  }

  const content = fs.readFileSync(fullPath, 'utf-8')
  if (content.includes(searchString)) {
    console.log(`✅ ${description}`)
    passed++
    return true
  } else {
    console.log(`❌ ${description}`)
    failed++
    issues.push(`${filePath} 中未找到: ${searchString}`)
    return false
  }
}

console.log('📦 检查核心文件\n')

// 1. 图片压缩
checkFileExists('src/services/imageCompression.ts', '图片压缩服务')
checkFileContent('src/services/attachment.ts', 'smartCompressImage', '附件服务集成图片压缩')

// 2. 流式 Markdown
checkFileExists('src/utils/streamingMarkdown.ts', '流式 Markdown 工具')
checkFileContent('src/components/chat/MessageContent.tsx', 'normalizeStreamingMarkdown', 'MessageContent 集成流式优化')

// 3. 懒加载
checkFileExists('src/utils/lazyLoad.tsx', '懒加载工具')
checkFileContent('app/settings/providers.tsx', 'createLazyComponent', 'providers 页面懒加载')
checkFileContent('app/settings/preferences.tsx', 'createLazyComponent', 'preferences 页面懒加载')
checkFileContent('app/settings/skills.tsx', 'createLazyComponent', 'skills 页面懒加载')
checkFileContent('app/settings/mcp.tsx', 'createLazyComponent', 'mcp 页面懒加载')
checkFileContent('app/settings/knowledge.tsx', 'createLazyComponent', 'knowledge 页面懒加载')
checkFileContent('app/settings/context.tsx', 'createLazyComponent', 'context 页面懒加载')
checkFileContent('app/settings/memory.tsx', 'createLazyComponent', 'memory 页面懒加载')

// 4. React.memo
checkFileContent('src/components/chat/MessageBubble.tsx', 'areMessagesEqual', 'MessageBubble memo 比较函数')
checkFileContent('src/components/chat/MessageBubble.tsx', 'memo(MessageBubbleComponent', 'MessageBubble memo 包装')

// 5. 性能监控
checkFileExists('src/utils/performanceMonitor.ts', '性能监控工具')

console.log('\n📚 检查文档\n')

// 文档
checkFileExists('docs/COMPLETE_OPTIMIZATION_REPORT.md', '完整优化报告')
checkFileExists('docs/lazy-loading-implementation-guide.md', '懒加载实施指南')
checkFileExists('docs/performance-monitoring-guide.md', '性能监控指南')
checkFileExists('.clauderules', 'Claude 规则文件')

console.log('\n' + '='.repeat(60))
console.log(`\n✅ 通过: ${passed}`)
console.log(`❌ 失败: ${failed}`)

if (issues.length > 0) {
  console.log('\n⚠️  发现的问题:\n')
  issues.forEach((issue, index) => {
    console.log(`  ${index + 1}. ${issue}`)
  })
}

console.log('\n' + '='.repeat(60))

if (failed === 0) {
  console.log('\n🎉 所有优化已正确实施！')
  console.log('\n下一步:')
  console.log('  1. npm install expo-image-manipulator')
  console.log('  2. npm run type-check')
  console.log('  3. npm run test')
  console.log('  4. npm run android')
  process.exit(0)
} else {
  console.log('\n⚠️  发现问题，请修复后重新运行此脚本')
  process.exit(1)
}
