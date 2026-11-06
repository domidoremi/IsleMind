const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const workspace = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const evidenceRoot = path.resolve(workspace, option('--evidence-root', 'test-evidence/qa/islemind-upgrade-20261106'))
const schema = 'islemind.upgrade-atlas.v1'
const indexPath = path.join(evidenceRoot, 'index.html')
const manifestPath = path.join(evidenceRoot, 'atlas-manifest.json')
assert.ok(evidenceRoot.startsWith(workspace + path.sep), 'Use local workspace evidence')
assert.ok(fs.statSync(evidenceRoot).isDirectory(), 'The completed evidence directory must exist')
if (fs.existsSync(indexPath) || fs.existsSync(manifestPath)) {
  assert.ok(args.includes('--refresh'), 'Preserve existing evidence; --refresh replaces only this generated atlas')
  assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).schema, schema, 'Only refresh this generated atlas')
}

const families = [
  { id: 'minimal', name: 'Minimal' },
  { id: 'monet', name: 'Monet' },
  { id: 'material', name: 'Material' },
  { id: 'liquid-glass', name: 'Liquid Glass' },
  { id: 'animal-island-ui', name: 'Animal Island' },
]
const routeNames = {
  '/': '首页',
  '/agent': 'Agent 工作区',
  '/agent/run/[runId]': 'Agent 运行详情',
  '/chat': '聊天入口',
  '/chat/[id]': '聊天',
  '/conversations': '会话目录',
  '/documents': '文档目录',
  '/documents/edit': '文档编辑',
  '/help': '帮助目录',
  '/history': '历史记录',
  '/memory': '记忆',
  '/request/[id]': '请求详情',
  '/settings': '设置',
  '/settings/agents': 'Agent 设置',
  '/settings/context': '上下文设置',
  '/settings/knowledge': '知识',
  '/settings/mcp': 'MCP 连接',
  '/settings/memory': '记忆设置',
  '/settings/preferences': '偏好设置',
  '/settings/providers': '供应商',
  '/settings/routing': '路由方案',
  '/settings/skills': 'Skills',
  '/settings/usage': '请求与用量',
  '/source/[id]': '来源详情',
}
const guideNames = {
  chat: '聊天', documents: '文档', knowledge: '知识与记忆', models: '模型与路由',
  personalization: '个性化', privacy: '隐私', 'quick-start': '快速开始', search: '搜索',
  tools: '工具', troubleshooting: '问题排查', usage: '用量', workspaces: '工作区',
}
const routeLabel = route => routeNames[route]
  ?? (route.startsWith('/help/') ? `帮助 · ${guideNames[route.slice(6)] ?? route.slice(6)}` : route)
const normalizeRoute = route => route === '/request/qa-missing' ? '/request/[id]' : route
const results = {}
const screenshots = []
const selections = new Map()
const evidenceSets = [
  ['baseline', '改造前基线', 'visual-before/results.json'],
  ['matrix', '全页面完成版', 'visual-pass-f/results.json'],
  ['narrow', '窄屏资源与帮助', 'visual-narrow-f/results.json'],
  ['routing', '路由任务链', 'routing-pass-f-v2/browser-results.json'],
  ['working', '真实存储工作状态', 'working-pass-f/results.json'],
  ['detail', '详情与编辑', 'detail-pass-f/results.json'],
  ['writing', '写作与来源', 'writing-pass-f-v3/results.json'],
  ['execution', '请求归属与续轮', 'execution-pass-f/results.json'],
]
for (const [id, label, relative] of evidenceSets) {
  const data = JSON.parse(fs.readFileSync(path.join(evidenceRoot, relative), 'utf8'))
  assert.ok(Array.isArray(data.pages) && data.pages.length, `${id}: completed views are required`)
  for (const key of ['errors', 'pageErrors', 'blockedExternalHosts', 'blockedHosts']) {
    assert.equal(data[key]?.length ?? 0, 0, `${id}: use passing evidence only`)
  }
  assert.ok(!data.failure, `${id}: no failed workflow`)
  results[id] = { id, label, relative, directory: path.dirname(relative), data }
}
assert.equal(results.matrix.data.exportHash, results.narrow.data.exportHash, 'Compare the same final export')

function addCapture(setId, page, relativeFile, selectionId, label, route, stage = 'after') {
  const set = results[setId]
  const relative = path.join(set.directory, relativeFile)
  const absolute = path.resolve(evidenceRoot, relative)
  assert.ok(absolute.startsWith(evidenceRoot + path.sep), 'Screenshots stay inside the evidence directory')
  assert.ok(fs.statSync(absolute).isFile(), `Missing capture: ${relative}`)
  assert.ok(families.some(f => f.id === page.family), 'Use a canonical theme')
  const width = page.width ?? ({ mobile: 390, desktop: 1280, narrow: 320 }[page.viewport])
  assert.ok([320, 390, 1280].includes(width), 'Use an evidenced viewport')
  const mode = page.mode ?? (page.name?.endsWith('-dark') ? 'dark' : 'light')
  assert.ok(['light', 'dark'].includes(mode), 'Use an evidenced color mode')
  selections.set(selectionId, {
    id: selectionId, label, group: selectionId.startsWith('route:') ? '页面' : '任务步骤',
    evidenceLabel: selectionId.startsWith('route:') ? undefined : set.label,
  })
  screenshots.push({
    id: `${setId}:${relativeFile}`, selectionId, label, route, family: page.family, mode,
    width, stage, evidence: setId, evidenceLabel: set.label,
    file: relative.split(path.sep).map(encodeURIComponent).join('/'),
  })
}

for (const id of ['baseline', 'matrix', 'narrow']) {
  for (const page of results[id].data.pages) {
    if (!page.screenshot) continue
    const route = normalizeRoute(page.route)
    addCapture(id, page, page.screenshot, `route:${route}`, routeLabel(route), route, id === 'baseline' ? 'before' : 'after')
  }
}
for (const page of results.routing.data.pages) {
  for (const [step, label] of [['editor', '编辑首选与备用'], ['saved', '保存与恢复方案'], ['selected', '会话选用与作用范围']]) {
    addCapture('routing', page, `${step}-${page.family}-${page.mode}-${page.width}.png`,
      `step:routing/${step}`, `路由 · ${label}`, '/settings/routing')
  }
}
const workflowNames = {
  'documents-populated': ['文档 · 有内容的目录', '/documents'],
  'documents-no-results': ['文档 · 搜索无结果', '/documents'],
  'documents-refreshing': ['文档 · 刷新中', '/documents'],
  'documents-refresh-failed': ['文档 · 局部刷新失败', '/documents'],
  documents: ['文档 · 深色目录', '/documents'],
  'providers-populated': ['供应商 · 有内容的列表', '/settings/providers'],
  providers: ['供应商 · 深色列表', '/settings/providers'],
  'provider-connection': ['供应商 · 准确连接与地址', '/settings/providers'],
  'provider-models': ['供应商 · 模型管理', '/settings/providers'],
  'provider-advanced': ['供应商 · 高级配置', '/settings/providers'],
  'usage-requests': ['用量 · 请求概览', '/settings/usage'],
  'usage-request-list': ['用量 · 请求列表', '/settings/usage'],
  'usage-request-detail': ['用量 · 完整请求详情', '/request/[id]'],
  'usage-providers': ['用量 · 按供应商汇总', '/settings/usage'],
  'usage-models': ['用量 · 按模型汇总', '/settings/usage'],
  usage: ['用量 · 深色概览', '/settings/usage'],
  'usage-detail': ['请求 · 读取与返回', '/request/[id]'],
  'usage-error-detail': ['请求 · 脱敏错误', '/request/[id]'],
  'document-editor': ['文档 · 草稿编辑', '/documents/edit'],
  'document-saved': ['文档 · 持久保存', '/documents/edit'],
  'document-preview': ['文档 · 阅读预览', '/documents/edit'],
}
for (const id of ['working', 'detail']) {
  for (const page of results[id].data.pages) {
    const name = page.name.replace(/-dark$/, '')
    const [label, route] = workflowNames[name] ?? [name, null]
    addCapture(id, page, `${page.family}-${page.width}-${page.name}.jpg`, `step:${id}/${name}`, label, route)
  }
}
const writingNames = {
  catalog: ['文档 · 长目录与位置保持', '/documents'],
  preview: ['文档 · 长文预览', '/documents/edit'],
  writer: ['文档 · 稳定输入与光标', '/documents/edit'],
  source: ['来源 · 阅读与返回', '/source/[id]'],
  'home-retained': ['首页 · 底部栏保留', '/'],
}
for (const page of results.writing.data.pages) {
  const [label, route] = writingNames[page.name]
  addCapture('writing', page, path.basename(page.screenshot), `step:writing/${page.name}`, label, route)
}
for (const page of results.execution.data.pages) {
  for (const [step, label] of [['request-attempts', '首选失败与备用成功'], ['response', '同一回复的请求与工具续轮']]) {
    addCapture('execution', { ...page, width: 390 }, `${page.family}-${page.mode}-${step}.png`,
      `step:execution/${step}`, `执行 · ${label}`, '/request/[id]')
  }
}

const coverage = [...new Set(results.matrix.data.pages.map(page => page.route))].map(route => {
  const pages = results.matrix.data.pages.filter(page => page.route === route)
  assert.ok(pages.every(page => !page.documentOverflow && !page.overflow.length), `${route}: no overflow`)
  return {
    route, label: routeLabel(route), combinations: pages.length,
    captures: screenshots.filter(capture => capture.stage === 'after' && capture.route === route).length,
  }
})
for (const row of coverage) {
  const id = `route:${row.route}`
  if (!selections.has(id)) selections.set(id, { id, label: row.label, group: '页面' })
}
const manifest = {
  schema, generatedAt: new Date().toISOString(), exportHash: results.matrix.data.exportHash,
  isolatedBrowserData: true, liveProviderRequests: 0, nativeAcceptance: false,
  families, coverage,
  selections: [...selections.values()],
  summaries: evidenceSets.map(([id]) => ({
    id, label: results[id].label, views: results[id].data.pages.length,
    checks: results[id].data.checks?.length ?? 0, file: results[id].relative,
    screenshots: screenshots.filter(capture => capture.evidence === id).length,
  })),
  screenshots,
}
const embedded = JSON.stringify(manifest).replace(/[<>&\u2028\u2029]/g,
  character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>IsleMind · 升级验收图册</title>
<style>
:root{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;line-height:1.55;color-scheme:light;--bg:#f5f7f6;--surface:#fff;--text:#182722;--muted:#52635c;--line:#dbe3df;--accent:#267262;--tint:#e8f2ec}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text)}
body[data-theme="monet"]{--accent:#567452;--tint:#edf1e6}
body[data-theme="material"]{--accent:#5357aa;--tint:#ededfc}
body[data-theme="liquid-glass"]{--accent:#35699e;--tint:#eaf2fa}
body[data-theme="animal-island-ui"]{--accent:#93602d;--tint:#f5eddf}
body[data-mode="dark"]{color-scheme:dark;--bg:#131b18;--surface:#1c2722;--text:#ebf2ee;--muted:#b6c6bc;--line:#35463d;--accent:#9acdb9;--tint:#293f33}
body[data-theme="monet"][data-mode="dark"]{--accent:#bfd2a7;--tint:#343e2b}
body[data-theme="material"][data-mode="dark"]{--accent:#c5c0ff;--tint:#37324d}
body[data-theme="liquid-glass"][data-mode="dark"]{--accent:#a9cef7;--tint:#293b50}
body[data-theme="animal-island-ui"][data-mode="dark"]{--accent:#efc58d;--tint:#483728}
button,select,input{font:inherit;color:inherit}
button,select{min-height:44px;border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:8px 14px}
button{cursor:pointer}
button[aria-pressed="true"]{background:var(--tint);border-color:var(--accent);color:var(--accent)}
button:hover,select:hover{border-color:var(--accent)}
:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
a{color:var(--accent);text-underline-offset:3px}
.wrap{max-width:1320px;margin:auto;padding:32px 24px 48px}
header{max-width:850px;margin-bottom:26px}
.eyebrow{color:var(--accent);font-size:13px;letter-spacing:.1em;margin:0 0 8px}
h1{font-size:clamp(26px,4vw,38px);line-height:1.2;font-weight:650;letter-spacing:-.03em;margin:0 0 12px}
p{margin:0 0 12px}.muted{color:var(--muted)}
.stats{display:flex;flex-wrap:wrap;gap:12px 24px;margin:20px 0;color:var(--muted);font-size:14px}
.stats strong{color:var(--text);font-weight:650}
.controls{display:flex;flex-wrap:wrap;align-items:end;gap:16px 24px;padding:20px 0;border-block:1px solid var(--line)}
.field{display:flex;flex-direction:column;gap:6px;min-width:0}
.field>span,.field>label{font-size:13px;color:var(--muted)}
.choices{display:flex;flex-wrap:wrap;gap:6px}
.selection{flex:1 1 330px}.selection select{width:100%;max-width:580px}
.compare{display:flex;align-items:center;gap:9px;min-height:44px;cursor:pointer}
.compare input{width:19px;height:19px;accent-color:var(--accent)}
.notice{font-size:13px;color:var(--muted);max-width:900px;margin:16px 0}
#status{min-height:28px;color:var(--muted);margin:24px 0 14px}
.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:20px;align-items:start}
.capture{margin:0;min-width:0;background:var(--surface);border:1px solid var(--line);border-radius:18px;overflow:hidden}
.caption{padding:16px 18px;display:flex;gap:12px;align-items:start;justify-content:space-between;border-bottom:1px solid var(--line)}
.caption strong{display:block;font-size:15px;font-weight:620}
.caption small{display:block;font-size:12px;color:var(--muted);margin-top:4px}
.badge{flex-shrink:0;color:var(--accent);background:var(--tint);border-radius:7px;padding:3px 7px;font-size:12px}
.image-link{display:flex;justify-content:center;background:var(--bg);padding:14px;min-height:280px}
.image-link img{display:block;width:100%;height:auto;align-self:start;border:1px solid var(--line);border-radius:9px}
.capture[data-wide="true"]{grid-column:1/-1}
.capture[data-wide="true"] img{max-width:1280px}
.empty{padding:32px 22px;border:1px dashed var(--line);border-radius:16px;max-width:800px}
.empty p{margin:0}
details{margin-top:32px;border-top:1px solid var(--line);padding-top:16px}
summary{min-height:44px;cursor:pointer;font-weight:600}
.table-wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px;text-align:left}
th,td{padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500}
td code{overflow-wrap:anywhere}
.route-button{padding:3px 7px;text-align:left;border:0;background:transparent;min-height:44px;color:var(--accent)}
.footnote{margin-top:24px;font-size:12px;color:var(--muted);overflow-wrap:anywhere}
@media(max-width:600px){.wrap{padding:24px 16px 36px}.controls{gap:16px}.selection{flex-basis:100%}.choices button{padding-inline:10px}.image-link{padding:10px}th,td{padding:10px 6px}.stats{gap:8px 18px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important}}
</style>
</head>
<body data-theme="minimal" data-mode="light">
<main class="wrap">
<header>
<p class="eyebrow">ISLEMIND · 2026.11.06</p>
<h1>协调的页面，连续的工作</h1>
<p class="muted">从首页底部栏延伸到设置、供应商、路由与详情。切换主题查看完成版，或沿任务步骤核对编辑、返回和执行归属。</p>
<div class="stats"><span><strong>48</strong> 个目的页面</span><span><strong>960</strong> 个全页面组合</span><span><strong>5</strong> 种主题 · 浅色 / 深色</span><span><strong id="capture-count"></strong> 张留存截图</span></div>
</header>
<section class="controls" aria-label="图册筛选">
<div class="field"><span id="theme-label">主题</span><div id="themes" class="choices" role="group" aria-labelledby="theme-label"></div></div>
<div class="field"><span id="mode-label">颜色模式</span><div id="modes" class="choices" role="group" aria-labelledby="mode-label"></div></div>
<div class="field"><label for="width">截图宽度</label><select id="width"><option value="390">390 · 手机</option><option value="320">320 · 窄屏</option><option value="1280">1280 · 宽屏</option><option value="all">全部宽度</option></select></div>
<div class="field selection"><label for="selection">页面 / 任务步骤</label><select id="selection"></select></div>
<label class="compare"><input id="compare" type="checkbox" checked>改造前对照</label>
</section>
<p class="notice">截图来自隔离浏览器；任务内容使用合成数据。基线与完成版的文字、记录和状态可能不同，对照用于查看层级和布局。仅在相同主题、模式、宽度下展示基线；没有截图的组合会明确说明。</p>
<p id="status" role="status" aria-live="polite"></p>
<section id="gallery" class="gallery" aria-label="页面截图"></section>
<details><summary>全部页面覆盖 · 48 个目的页面</summary><p class="notice">每个目的页面检查 5 种主题 × 2 种模式 × 2 个宽度。动态详情入口使用隔离数据或缺失状态；编辑、保存、失败与返回另见任务步骤证据。自动布局通过与人工视觉审阅的范围分别记录。</p><div class="table-wrap"><table><thead><tr><th scope="col">页面</th><th scope="col">路由</th><th scope="col">完成版检查</th><th scope="col">留存截图</th></tr></thead><tbody id="coverage"></tbody></table></div></details>
<details><summary>行为与验收记录</summary><div class="table-wrap"><table><thead><tr><th scope="col">证据</th><th scope="col">视图 / 用例</th><th scope="col">工作流检查</th><th scope="col">记录</th></tr></thead><tbody id="evidence"></tbody></table></div><p class="notice">不同任务的测试存在重叠，不按独立测试相加。所有列出的浏览器记录通过，页面异常与外部请求为零。工作状态与请求归属使用实际导出的 SQLite 适配器读取合成记录；供应商真实调用、Android/iOS 原生输入法、读屏和动态效果仍需单独验收。</p></details>
<p id="hash" class="footnote"></p>
</main>
<script id="atlas-data" type="application/json">${embedded}</script>
<script>
const data = JSON.parse(document.getElementById('atlas-data').textContent);
const state = { family: 'minimal', mode: 'light', width: '390', selection: 'route:/settings/routing', compare: true };
let directSelections = new Set();
const element = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
const familyName = id => data.families.find(f => f.id === id).name;
const available = capture => capture.family === state.family && capture.mode === state.mode && (state.width === 'all' || capture.width === Number(state.width));
const fitsSelection = (capture, selection = state.selection) => selection === 'all' || capture.selectionId === selection
  || selection.startsWith('route:') && !directSelections.has(selection) && capture.route === selection.slice(6);
function renderChoices() {
  for (const [container, choices, field] of [['themes', data.families, 'family'], ['modes', [{ id: 'light', name: '浅色' }, { id: 'dark', name: '深色' }], 'mode']]) {
    const group = document.getElementById(container); group.replaceChildren();
    for (const choice of choices) {
      const button = element('button', choice.name); button.type = 'button'; button.dataset.value = choice.id;
      button.setAttribute('aria-pressed', String(state[field] === choice.id));
      button.addEventListener('click', () => { state[field] = choice.id; render(); group.querySelector('[data-value="' + choice.id + '"]').focus(); });
      group.append(button);
    }
  }
}
function renderSelection() {
  const select = document.getElementById('selection'); select.replaceChildren(element('option', '全部完成版截图'));
  select.firstChild.value = 'all';
  for (const name of ['页面', '任务步骤']) {
    const group = element('optgroup'); group.label = name;
    for (const choice of data.selections.filter(s => s.group === name)) {
      const count = data.screenshots.filter(c => c.stage === 'after' && fitsSelection(c, choice.id) && available(c)).length;
      const label = choice.label + (choice.evidenceLabel ? ' · ' + choice.evidenceLabel : '');
      const option = element('option', label + ' · ' + count + ' 张'); option.value = choice.id; group.append(option);
    }
    select.append(group);
  }
  if (!data.selections.some(s => s.id === state.selection) && state.selection !== 'all') {
    const route = state.selection.replace(/^route:/, '');
    const item = data.coverage.find(c => c.route === route);
    const option = element('option', (item?.label ?? route) + ' · 未留截图'); option.value = state.selection; select.append(option);
  }
  select.value = state.selection;
}
function captureCard(capture) {
  const card = element('figure', undefined, 'capture'); card.dataset.wide = String(capture.width >= 1000); card.dataset.stage = capture.stage;
  const caption = element('figcaption', undefined, 'caption'); const text = element('div');
  text.append(element('strong', capture.label), element('small', capture.evidenceLabel + ' · ' + capture.width + ' px · ' + familyName(capture.family) + ' / ' + (capture.mode === 'dark' ? '深色' : '浅色')));
  caption.append(text, element('span', capture.stage === 'before' ? '改造前' : '完成版', 'badge'));
  const link = element('a', undefined, 'image-link'); link.href = capture.file; link.target = '_blank'; link.rel = 'noopener';
  link.setAttribute('aria-label', '打开原图：' + capture.label + '，' + (capture.stage === 'before' ? '改造前' : '完成版'));
  const image = element('img'); image.src = capture.file; image.alt = capture.label + '，' + familyName(capture.family) + '，' + (capture.mode === 'dark' ? '深色' : '浅色') + '，' + capture.width + ' 像素';
  image.loading = 'lazy'; image.decoding = 'async'; image.style.maxWidth = capture.width + 'px';
  link.append(image); card.append(caption, link); return card;
}
function render() {
  document.body.dataset.theme = state.family; document.body.dataset.mode = state.mode;
  directSelections = new Set(data.screenshots.filter(c => c.stage === 'after' && available(c)).map(c => c.selectionId));
  renderChoices(); renderSelection();
  const after = data.screenshots.filter(c => c.stage === 'after' && available(c) && fitsSelection(c));
  const before = state.compare ? data.screenshots.filter(c => c.stage === 'before' && available(c) && fitsSelection(c)) : [];
  const gallery = document.getElementById('gallery'); gallery.replaceChildren();
  const selected = data.selections.find(s => s.id === state.selection)?.label ?? data.coverage.find(c => 'route:' + c.route === state.selection)?.label ?? '全部完成版截图';
  document.getElementById('status').textContent = selected + ' · 完成版 ' + after.length + ' 张' + (state.compare ? ' · 改造前 ' + before.length + ' 张' : '');
  const captures = [...before, ...after];
  if (!captures.length) {
    const empty = element('div', undefined, 'empty');
    empty.append(element('p', '这个组合未留存截图。可切换宽度或选择任务步骤；全部页面检查记录仍在下方。'));
    gallery.append(empty);
  } else {
    for (const capture of captures) gallery.append(captureCard(capture));
    if (!after.length) {
      const empty = element('div', undefined, 'empty');
      empty.append(element('p', '该组合仅留存改造前截图。完成版检查记录可在下方查看，完成版截图可尝试切换宽度或任务步骤。'));
      gallery.append(empty);
    }
  }
}
document.getElementById('width').addEventListener('change', event => { state.width = event.target.value; render(); });
document.getElementById('selection').addEventListener('change', event => { state.selection = event.target.value; render(); });
document.getElementById('compare').addEventListener('change', event => { state.compare = event.target.checked; render(); });
document.getElementById('capture-count').textContent = data.screenshots.length;
for (const row of data.coverage) {
  const tr = element('tr'); const name = element('td'); const button = element('button', row.label, 'route-button'); button.type = 'button';
  button.addEventListener('click', () => { state.selection = 'route:' + row.route; render(); document.getElementById('selection').focus(); });
  name.append(button); const route = element('td'); route.append(element('code', row.route));
  tr.append(name, route, element('td', row.combinations + ' / ' + row.combinations + '，无横向溢出'), element('td', String(row.captures)));
  document.getElementById('coverage').append(tr);
}
for (const summary of data.summaries) {
  const tr = element('tr'); const linkCell = element('td'); const link = element('a', 'results.json');
  link.href = summary.file; link.target = '_blank'; link.rel = 'noopener'; linkCell.append(link);
  tr.append(element('td', summary.label), element('td', String(summary.views)), element('td', summary.checks ? String(summary.checks) : '见记录'), linkCell);
  document.getElementById('evidence').append(tr);
}
document.getElementById('hash').textContent = '完成版 Web 导出 SHA-256：' + data.exportHash + '。图册仅索引本地证据，可直接从 index.html 打开。';
render();
</script>
</body>
</html>
`

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
fs.writeFileSync(indexPath, html, 'utf8')
console.log(JSON.stringify({
  index: path.relative(workspace, indexPath), manifest: path.relative(workspace, manifestPath),
  routes: coverage.length, screenshots: screenshots.length,
  completedScreenshots: screenshots.filter(capture => capture.stage === 'after').length,
  exportHash: manifest.exportHash,
}, null, 2))
