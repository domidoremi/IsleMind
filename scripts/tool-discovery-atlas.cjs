const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const workspace = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const root = path.resolve(workspace, option('--evidence-root', 'test-evidence/qa/islemind-tool-discovery-20261106'))
const schema = 'islemind.tool-discovery-atlas.v1'
const index = path.join(root, 'index.html')
const manifestFile = path.join(root, 'atlas-manifest.json')
assert(root.startsWith(workspace + path.sep) && fs.statSync(root).isDirectory())
if (fs.existsSync(index) || fs.existsSync(manifestFile)) {
  assert(args.includes('--refresh'), 'Preserve existing evidence; --refresh replaces only this generated atlas')
  assert.equal(JSON.parse(fs.readFileSync(manifestFile, 'utf8')).schema, schema)
}
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const local = relative => {
  const file = path.resolve(root, relative)
  assert(file.startsWith(root + path.sep) && fs.statSync(file).isFile(), `Missing local evidence: ${relative}`)
  return file
}
const uri = relative => relative.split(/[\\/]/).map(encodeURIComponent).join('/')
const families = [
  { id: 'minimal', name: 'Minimal' }, { id: 'monet', name: 'Monet' },
  { id: 'material', name: 'Material' }, { id: 'liquid-glass', name: 'Liquid Glass' },
  { id: 'animal-island-ui', name: 'Animal Island' },
]
const sources = [
  { id: 'tools', label: '工具设置、保存与记录', platform: 'web', file: option('--views', 'views-g4/results.json') },
  { id: 'routes', label: '设置与共享选项入口', platform: 'web', file: option('--routes', 'routes-g4/results.json') },
  { id: 'native', label: '隔离 Android 实际控件', platform: 'android', file: option('--native', 'native-g5/results.json') },
].map(source => {
  const file = local(source.file)
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert(Array.isArray(data.pages) && data.pages.length, `${source.id}: completed views are required`)
  for (const key of ['errors', 'pageErrors', 'blockedExternalHosts']) assert.equal(data[key]?.length ?? 0, 0, `${source.id}: passing evidence only`)
  assert.equal(data.liveProviderRequests, 0)
  if (source.platform === 'android') {
    assert.equal(data.pass, true)
    assert.equal(data.package, 'com.islemind.stage9')
    assert.equal(data.fixture.legacyToolModeMissing, true)
    assert(data.nativeInput.gap >= 8, 'The focused input must be above the native keyboard')
    assert.deepEqual(data.productionBefore, data.productionAfter)
    assert.deepEqual(data.osBefore, data.osAfter)
  } else {
    assert.equal(data.isolatedBrowserData, true)
    assert(data.pages.every(page => !page.documentOverflow && !page.overflow?.length))
  }
  return { ...source, sha256: hash(file), data }
})
assert.equal(sources[0].data.exportHash, sources[1].data.exportHash, 'Use one completed Web export')
const fixtureFile = local('fixture-g2/manifest.json')
const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'))
assert.equal(fixture.externalServicesUsed, false)
const buildFile = local('native-refresh-g4/build-after.json')
const build = JSON.parse(fs.readFileSync(buildFile, 'utf8'))
assert.equal(build.apkSha256, sources[2].data.apkSha256, 'The native views must use the completed build')
const views = new Map()
const screenshots = []
const routeNames = {
  '/settings': '设置目录', '/settings/context': '上下文目录', '/settings/mcp': 'MCP 连接',
  '/settings/usage': '请求与用量', '/settings/routing': '路由方案', '/help/tools': '工具帮助入口',
}
const steps = {
  'editor-full': ['settings:full', '工具定义 · 默认完整'],
  'save-failure': ['settings:failure', '工具定义 · 保存失败与重试'],
  record: ['context:record', '上下文 · 首轮声明记录'],
  help: ['help:tools', '帮助 · 工具与自动化'],
  'legacy-full-default': ['settings:full', '工具定义 · 默认完整'],
  'unsaved-choice-after-theme': ['native:draft', 'Android · 未保存选择与主题'],
  'persisted-auto-after-restart': ['native:restart', 'Android · 保存与重启'],
  'native-input-after-theme': ['native:input', 'Android · 输入与焦点保持'],
  'offline-tools-help': ['help:tools', '帮助 · 工具与自动化'],
}
for (const source of sources) {
  for (const page of source.data.pages) {
    assert(page.screenshot, 'The atlas only indexes retained screenshots')
    const file = path.join(path.dirname(source.file), page.screenshot)
    const absolute = local(file)
    assert(families.some(family => family.id === page.family) && ['light', 'dark'].includes(page.mode))
    const width = page.width ?? ({ mobile: 390, desktop: 1280, narrow: 320 }[page.viewport])
    assert(Number.isInteger(width) && width > 0)
    let group = '任务步骤', step
    if (source.id === 'routes') {
      group = '入口回归'
      assert(routeNames[page.route], 'Use a named focused route')
      step = [`route:${page.route}`, routeNames[page.route]]
    } else if (page.view.endsWith('-editor')) {
      step = ['settings:auto', '工具定义 · 已保存自动按需']
    } else if (page.view.endsWith('-record')) {
      step = steps.record
    } else {
      step = steps[page.view]
    }
    assert(step, `Unknown captured step: ${page.view}`)
    views.set(step[0], { id: step[0], name: step[1], group })
    screenshots.push({
      id: `${source.id}:${page.screenshot}`, source: source.id, sourceLabel: source.label,
      platform: source.platform, family: page.family, mode: page.mode, width,
      widthUnit: source.platform === 'android' ? '设备像素' : 'CSS 像素',
      view: step[0], name: step[1], file: uri(file), sha256: hash(absolute),
    })
  }
}
const manifest = {
  schema, generatedAt: new Date().toISOString(), liveProviderRequests: 0, realCapabilityExecutions: 0,
  webExportSha256: sources[0].data.exportHash, nativeApkSha256: build.apkSha256,
  nativeScope: sources[2].data.scope, families, views: [...views.values()], screenshots,
  nativeInput: sources[2].data.nativeInput,
  sources: sources.map(({ data, ...source }) => ({ ...source, file: uri(source.file), views: data.pages.length, checks: data.checks?.length ?? 0 })),
  fixture: { file: 'fixture-g2/manifest.json', sha256: hash(fixtureFile),
    rows: fixture.runs.map(run => ({ protocol: run.protocol, totalCount: run.firstDeclarations.totalCount,
      full: run.firstDeclarations.fullDeclarationChars, first: run.firstDeclarations.declarationChars,
      published: run.publishedDeclarations.declarationChars })) },
  build: { file: 'native-refresh-g4/build-after.json', sha256: hash(buildFile), productionRelease: false },
}
const embedded = JSON.stringify(manifest).replace(/[<>&\u2028\u2029]/g,
  character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>IsleMind · 工具定义验收图册</title>
<style>
:root{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color-scheme:light;line-height:1.6;--bg:#f5f7f6;--surface:#fff;--text:#1c2a24;--muted:#55675d;--line:#dbe4dd;--accent:#267062;--tint:#e8f2ec}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}
body[data-family="monet"]{--accent:#597451;--tint:#edf2e7}body[data-family="material"]{--accent:#5855a7;--tint:#eeedfa}
body[data-family="liquid-glass"]{--accent:#356c9c;--tint:#eaf2fa}body[data-family="animal-island-ui"]{--accent:#8c612f;--tint:#f5ede2}
body[data-mode="dark"]{color-scheme:dark;--bg:#141d18;--surface:#1e2922;--text:#edf3ef;--muted:#b5c5bb;--line:#36483d;--accent:#a2d0b8;--tint:#2c4135}
body[data-family="monet"][data-mode="dark"]{--accent:#bfd2a6;--tint:#34412b}body[data-family="material"][data-mode="dark"]{--accent:#c8c3ff;--tint:#3a3553}
body[data-family="liquid-glass"][data-mode="dark"]{--accent:#aed3f4;--tint:#2e4256}body[data-family="animal-island-ui"][data-mode="dark"]{--accent:#eec58e;--tint:#473b2a}
main{max-width:1320px;margin:auto;padding:32px 24px 48px}header{max-width:880px}.eyebrow{font-size:13px;letter-spacing:.1em;color:var(--accent);margin:0 0 8px}
h1{font-weight:650;font-size:clamp(27px,4vw,38px);line-height:1.25;letter-spacing:-.03em;margin:0 0 14px}p{margin:0 0 12px}.muted,.notice{color:var(--muted)}.notice{font-size:13px;max-width:950px;margin:18px 0}
a{color:var(--accent);text-underline-offset:3px}.stats{display:flex;gap:12px 24px;flex-wrap:wrap;font-size:14px;color:var(--muted);margin:24px 0}.stats strong{color:var(--text)}
button,select{font:inherit;color:inherit;border:1px solid var(--line);border-radius:11px;background:var(--surface);padding:8px 12px;min-height:44px}
button{cursor:pointer}button[aria-pressed="true"]{border-color:var(--accent);background:var(--tint);color:var(--accent)}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.controls{display:flex;gap:18px 24px;align-items:end;flex-wrap:wrap;padding:22px 0;border-block:1px solid var(--line)}.field{display:flex;flex-direction:column;gap:7px;min-width:0}.field>span,.field>label{font-size:13px;color:var(--muted)}
.choices{display:flex;gap:6px;flex-wrap:wrap}.step{flex:1 1 300px}.step select{width:100%}#status{margin:24px 0 14px;color:var(--muted);min-height:28px}
.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));align-items:start;gap:20px}
figure{margin:0;min-width:0;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--surface)}figcaption{padding:16px 18px;border-bottom:1px solid var(--line)}figcaption strong{display:block;font-weight:600;font-size:15px}figcaption small{display:block;color:var(--muted);font-size:12px;margin-top:5px}
.image{display:flex;justify-content:center;padding:12px;background:var(--bg);min-height:280px}.image img{display:block;width:100%;height:auto;align-self:start;border:1px solid var(--line);border-radius:8px}
figure[data-wide="true"]{grid-column:1/-1}.empty{border:1px dashed var(--line);border-radius:14px;padding:24px;color:var(--muted)}
details{margin-top:30px;border-top:1px solid var(--line);padding-top:14px}summary{min-height:44px;font-weight:600;cursor:pointer}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left;font-size:13px}th,td{padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{font-weight:500;color:var(--muted)}.hash{font-size:12px;overflow-wrap:anywhere;color:var(--muted);margin-top:24px}
@media(max-width:600px){main{padding:24px 16px 36px}.controls{gap:16px}.step{flex-basis:100%}.image{padding:8px}th,td{padding:10px 6px}}
</style></head>
<body data-family="minimal" data-mode="light"><main>
<header><p class="eyebrow">ISLEMIND · 2026.11.06 · G</p><h1>工具定义，从选择到记录</h1>
<p class="muted">查看完整定义与自动按需的设置、保存反馈和首轮请求记录。切换平台，核对隔离 Android 上的实际选项、输入与主题呈现。</p>
<div class="stats"><span><strong>${sources[0].data.pages.length}</strong> 个 Web 任务视图</span><span><strong>${sources[1].data.pages.length}</strong> 个入口回归视图</span><span><strong>${sources[2].data.pages.length}</strong> 个 Android 视图</span><span>5 种主题 · 浅色 / 深色</span></div></header>
<section class="controls" aria-label="图册筛选">
<div class="field"><span id="platform-label">平台</span><div id="platforms" class="choices" role="group" aria-labelledby="platform-label"></div></div>
<div class="field"><span id="family-label">主题</span><div id="families" class="choices" role="group" aria-labelledby="family-label"></div></div>
<div class="field"><span id="mode-label">模式</span><div id="modes" class="choices" role="group" aria-labelledby="mode-label"></div></div>
<div class="field"><label for="width">截图宽度</label><select id="width"></select></div>
<div class="field step"><label for="view">页面 / 任务步骤</label><select id="view"></select></div>
</section>
<p class="notice">Web 使用隔离浏览器和合成记录。Android 使用独立包 com.islemind.stage9、实际 Expo 页面及 SQLite；模型和能力端口为合成实现。Android 宽度为设备像素，Web 宽度为 CSS 像素；没有截图的组合会明确说明。</p>
<p id="status" role="status" aria-live="polite"></p><section id="gallery" class="gallery" aria-label="验收截图"></section>
<details><summary>合成目录的声明字符</summary><p class="notice">24 项操作，比较完整定义、按需首轮和出版 1 项定义后的声明字符。数字只说明此目录的声明体积；首轮记录与后续请求分别捕获。字符不是供应商 Token，也不表示整体任务费用或延迟。</p>
<div class="table-wrap"><table><thead><tr><th>协议</th><th>完整定义</th><th>按需首轮</th><th>提供 1 项后</th></tr></thead><tbody id="characters"></tbody></table></div></details>
<details><summary>验证范围与原始记录</summary><div class="table-wrap"><table><thead><tr><th>范围</th><th>视图</th><th>工作流检查</th><th>记录</th></tr></thead><tbody id="sources"></tbody></table></div>
<p class="notice">不同检查存在重叠，分别记录。原生证据覆盖保存与重启、真实文本输入、主题切换后的焦点与键盘上方可见性，以及五主题双模式。正式包的公开安装身份、APK 指纹和 OS 显示、字号、夜间模式、读屏设置前后一致；未检查正式包私有数据。真实供应商、iOS 和完整读屏资格验证另行记录。</p>
<p><a href="../islemind-upgrade-20261106/index.html">A–F 全页面图册</a> · <a href="../../../docs/release/tool-discovery-implementation-2026-11-06.md">G 批实施报告</a> · <a href="atlas-manifest.json">图册清单与指纹</a></p></details>
<p id="hashes" class="hash"></p></main>
<script id="atlas-data" type="application/json">${embedded}</script>
<script>
const data = JSON.parse(document.getElementById('atlas-data').textContent);
const state = { platform: 'web', family: 'minimal', mode: 'light', width: '390', view: 'settings:full' };
const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
const familyName = id => data.families.find(f => f.id === id).name;
const available = capture => (state.platform === 'all' || capture.platform === state.platform)
  && capture.family === state.family && capture.mode === state.mode
  && (state.width === 'all' || capture.width === Number(state.width));
function choices(id, values, field) {
  const group = document.getElementById(id); group.replaceChildren();
  for (const value of values) {
    const button = el('button', value.name); button.type = 'button'; button.dataset.value = value.id;
    button.setAttribute('aria-pressed', String(state[field] === value.id));
    button.addEventListener('click', () => { state[field] = value.id; if (field === 'platform') { state.width = 'all'; state.view = 'all'; }
      render(); group.querySelector('[data-value="' + value.id + '"]').focus(); });
    group.append(button);
  }
}
function render() {
  document.body.dataset.family = state.family; document.body.dataset.mode = state.mode;
  choices('platforms', [{ id: 'web', name: 'Web' }, { id: 'android', name: 'Android' }, { id: 'all', name: '全部' }], 'platform');
  choices('families', data.families, 'family');
  choices('modes', [{ id: 'light', name: '浅色' }, { id: 'dark', name: '深色' }], 'mode');
  const width = document.getElementById('width'); width.replaceChildren(el('option', '全部宽度')); width.firstChild.value = 'all';
  const widths = [...new Set(data.screenshots.filter(c => state.platform === 'all' || c.platform === state.platform).map(c => c.width))].sort((a, b) => a - b);
  for (const value of widths) { const option = el('option', value + (state.platform === 'android' ? ' · 设备像素' : state.platform === 'web' ? ' · CSS 像素' : ' · 见截图单位')); option.value = value; width.append(option); }
  if (state.width !== 'all' && !widths.includes(Number(state.width))) state.width = 'all';
  width.value = state.width;
  const select = document.getElementById('view'); select.replaceChildren(el('option', '全部步骤')); select.firstChild.value = 'all';
  for (const name of ['任务步骤', '入口回归']) {
    const group = el('optgroup'); group.label = name;
    for (const view of data.views.filter(v => v.group === name)) {
      const count = data.screenshots.filter(c => c.view === view.id && available(c)).length;
      const option = el('option', view.name + ' · ' + count + ' 张'); option.value = view.id; group.append(option);
    }
    select.append(group);
  }
  select.value = state.view;
  const captures = data.screenshots.filter(c => available(c) && (state.view === 'all' || c.view === state.view));
  const name = data.views.find(v => v.id === state.view)?.name ?? '全部步骤';
  document.getElementById('status').textContent = name + ' · ' + captures.length + ' 张';
  const gallery = document.getElementById('gallery'); gallery.replaceChildren();
  if (!captures.length) { const empty = el('p', '这个组合未留存截图。可切换平台、宽度或任务步骤；原始检查记录可在下方查看。'); empty.className = 'empty'; gallery.append(empty); }
  for (const capture of captures) {
    const card = el('figure'); card.dataset.wide = String(capture.platform === 'web' && capture.width >= 900);
    const caption = el('figcaption'); caption.append(el('strong', capture.name), el('small', (capture.platform === 'android' ? 'Android' : 'Web') + ' · ' + familyName(capture.family) + ' / ' + (capture.mode === 'dark' ? '深色' : '浅色') + ' · ' + capture.width + ' ' + capture.widthUnit));
    const link = el('a'); link.className = 'image'; link.href = capture.file; link.target = '_blank'; link.rel = 'noopener'; link.setAttribute('aria-label', '打开原图：' + capture.name);
    const image = el('img'); image.src = capture.file; image.alt = capture.name + '，' + capture.platform + '，' + familyName(capture.family) + '，' + capture.mode;
    image.loading = 'lazy'; image.decoding = 'async'; image.style.maxWidth = (capture.platform === 'android' ? 440 : capture.width) + 'px';
    link.append(image); card.append(caption, link); gallery.append(card);
  }
}
document.getElementById('width').addEventListener('change', event => { state.width = event.target.value; render(); });
document.getElementById('view').addEventListener('change', event => { state.view = event.target.value; render(); });
for (const source of data.sources) {
  const row = el('tr'), cell = el('td'), link = el('a', 'results.json'); link.href = source.file; link.target = '_blank'; link.rel = 'noopener'; cell.append(link);
  row.append(el('td', source.label), el('td', String(source.views)), el('td', String(source.checks)), cell); document.getElementById('sources').append(row);
}
for (const item of data.fixture.rows) { const row = el('tr'); row.append(el('td', item.protocol === 'native' ? 'Native' : 'Tagged'), el('td', item.full.toLocaleString()), el('td', item.first.toLocaleString()), el('td', item.published.toLocaleString())); document.getElementById('characters').append(row); }
document.getElementById('hashes').textContent = 'Web 导出 SHA-256：' + data.webExportSha256 + '。Android APK SHA-256：' + data.nativeApkSha256 + '。图册只索引本地通过证据，可直接打开。';
render();
</script></body></html>`
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
fs.writeFileSync(index, html)
console.log(JSON.stringify({ index: path.relative(workspace, index), screenshots: screenshots.length,
  sources: manifest.sources.map(source => ({ id: source.id, views: source.views, checks: source.checks })),
  webExportSha256: manifest.webExportSha256, nativeApkSha256: manifest.nativeApkSha256 }, null, 2))
