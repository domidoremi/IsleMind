const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const evidence = path.resolve(root, option('--evidence-root', 'test-evidence/qa/islemind-scene-plans-20261106'))
assert(evidence.startsWith(root + path.sep))
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const local = relative => {
  const file = path.resolve(evidence, relative)
  assert(file.startsWith(evidence + path.sep) && fs.statSync(file).isFile(), `Missing local evidence: ${relative}`)
  return file
}
const uri = relative => relative.split(/[\\/]/).map(encodeURIComponent).join('/')
const schema = 'islemind.scene-plans-atlas.v1'
const manifestFile = path.join(evidence, 'atlas-manifest.json'), index = path.join(evidence, 'index.html')
if (fs.existsSync(manifestFile) || fs.existsSync(index)) {
  assert(args.includes('--refresh') && JSON.parse(fs.readFileSync(manifestFile)).schema === schema, 'Preserve earlier evidence')
}
const sources = [
  { id: 'scenes', label: '场景方案操作', platform: 'web', file: option('--views', 'views-h6/results.json') },
  { id: 'routes', label: '关联页面回归', platform: 'web', file: option('--routes', 'routes-h6/results.json') },
  { id: 'native', label: '独立 Android', platform: 'android', file: option('--native', 'native-h6/results.json') },
].map(source => {
  const file = local(source.file), data = JSON.parse(fs.readFileSync(file))
  assert(data.pages.length)
  for (const key of ['errors', 'pageErrors', 'blockedExternalHosts']) assert.equal(data[key]?.length ?? 0, 0)
  assert.equal(data.liveProviderRequests, 0)
  if (source.platform === 'web') {
    assert(data.isolatedBrowserData && data.pages.every(page => !page.documentOverflow && !page.overflow?.length))
  } else {
    assert(data.pass && data.package === 'com.islemind.stage9' && data.nativeInput.gap >= 8)
    assert.deepEqual(data.productionBefore, data.productionAfter); assert.deepEqual(data.osBefore, data.osAfter)
  }
  return { ...source, data, sha256: hash(file) }
})
assert.equal(sources[0].data.exportHash, sources[1].data.exportHash)
const buildPath = option('--build', 'native-refresh-h6/build-after.json')
const build = JSON.parse(fs.readFileSync(local(buildPath)))
assert.equal(build.apkSha256, sources[2].data.apkSha256)
const families = [
  { id: 'minimal', name: 'Minimal' }, { id: 'monet', name: 'Monet' }, { id: 'material', name: 'Material' },
  { id: 'liquid-glass', name: 'Liquid Glass' }, { id: 'animal-island-ui', name: 'Animal Island' },
]
const labels = {
  list: '已保存方案', 'editor-conversation': '编辑 · 会话', 'editor-resources': '编辑 · 资源',
  'editor-context': '编辑 · 上下文', 'save-failure': '保存失败与重试', preview: '应用作用范围与变化',
  'apply-failure': '会话保存失败与重试', applied: '应用到已有会话', 'missing-references': '缺失引用',
  'template-conflict': '模板冲突与草稿', 'new-draft': '新的未发送草稿', 'chat-shortcuts': '完整 AI 配置与来源',
  'capture-current': '从当前会话保存', help: '离线帮助',
  'native-select': 'Android · 会话目标选择',
  '/settings': '设置目录', '/settings/providers': '供应商连接', '/settings/routing': '路由方案',
  '/settings/context': '上下文', '/settings/mcp': 'MCP 工具', '/settings/usage': '请求与用量',
  '/help/models': '模型与场景帮助',
}
const nativeSteps = {
  'initial-list': 'list', 'captured-resource-scope': 'editor-resources', 'input-after-theme': 'native-input',
  'saved-after-restart': 'native-restart', 'route-resource-preview': 'preview', 'applied-existing': 'applied',
  'missing-references': 'missing-references', 'template-conflict': 'template-conflict',
  'new-unsent-draft': 'new-draft', 'native-target-choice': 'native-select', 'opened-unsent-chat': 'native-chat',
  'offline-models-help': 'help', 'offline-scene-help': 'help',
}
labels['native-input'] = 'Android · 输入、主题与键盘'; labels['native-restart'] = 'Android · 保存与重启'
labels['native-chat'] = 'Android · 打开未发送会话'; labels['native-editor'] = 'Android · 会话编辑'
const views = new Map(), screenshots = []
for (const source of sources) for (const page of source.data.pages) {
  assert(families.some(family => family.id === page.family) && ['light', 'dark'].includes(page.mode))
  let step = source.id === 'routes' ? page.route : page.view
  if (source.platform === 'android') step = nativeSteps[page.view]
    ?? (page.view.endsWith('-list') ? 'list' : page.view.endsWith('-preview') ? 'preview' : page.view.endsWith('-editor') ? 'native-editor' : undefined)
  assert(step && labels[step], `Unknown scene evidence step: ${page.view}`)
  const relative = path.join(path.dirname(source.file), page.screenshot)
  const file = local(relative)
  // Both Web collectors use the default deviceScaleFactor=1; retain the actual viewport.
  const width = page.width ?? fs.readFileSync(file).readUInt32BE(16)
  assert(Number.isInteger(width) && width > 0)
  views.set(step, { id: step, label: labels[step] })
  screenshots.push({ platform: source.platform, family: page.family, mode: page.mode, width, view: step,
    label: labels[step], file: uri(relative), sha256: hash(file), source: source.label,
    widthUnit: source.platform === 'android' ? '设备像素' : 'CSS 像素' })
}
const manifest = { schema, generatedAt: new Date().toISOString(), families, views: [...views.values()], screenshots,
  webExportSha256: sources[0].data.exportHash, nativeApkSha256: build.apkSha256, nativeInput: sources[2].data.nativeInput,
  liveProviderRequests: 0, realCapabilityExecutions: 0,
  sources: sources.map(({ data, ...source }) => ({ ...source, file: uri(source.file), pages: data.pages.length, checks: data.checks?.length ?? 0 })),
  build: { file: uri(buildPath), sha256: hash(local(buildPath)) } }
const embedded = JSON.stringify(manifest).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>IsleMind · 场景方案验收</title><style>
:root{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;line-height:1.6;--bg:#f5f8f6;--surface:#fff;--text:#1c2b23;--muted:#52645a;--line:#d9e3dd;--accent:#246d60;--tint:#e4f1eb}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}
body[data-mode="dark"]{color-scheme:dark;--bg:#131c17;--surface:#1c2921;--text:#edf4ef;--muted:#b5c7bc;--line:#35473c;--accent:#aad4be;--tint:#2c4336}
body[data-family="monet"]{--accent:#62794c}body[data-family="material"]{--accent:#6254a4}body[data-family="liquid-glass"]{--accent:#376e9a}body[data-family="animal-island-ui"]{--accent:#936830}
body[data-mode="dark"][data-family="monet"]{--accent:#c2d4a8}body[data-mode="dark"][data-family="material"]{--accent:#c9c1fa}body[data-mode="dark"][data-family="liquid-glass"]{--accent:#b1d1f0}body[data-mode="dark"][data-family="animal-island-ui"]{--accent:#efc993}
main{max-width:1320px;margin:auto;padding:30px 24px 48px}.eyebrow{color:var(--accent);font-size:13px;letter-spacing:.08em}
h1{font-size:clamp(27px,4vw,38px);line-height:1.25;font-weight:650;letter-spacing:-.03em;margin:8px 0 16px}p{max-width:920px;margin:0 0 12px}.muted{color:var(--muted)}a{color:var(--accent);text-underline-offset:3px}
.stats{display:flex;flex-wrap:wrap;gap:8px 24px;margin:24px 0;color:var(--muted)}.stats strong{color:var(--text)}
.controls{display:flex;flex-wrap:wrap;gap:14px 20px;align-items:end;padding:20px 0;border-block:1px solid var(--line)}
label{display:flex;flex-direction:column;gap:7px;font-size:13px;color:var(--muted);min-width:0}.step{flex:1 1 270px}
select,button{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:9px 12px;min-height:44px;max-width:100%}
button{cursor:pointer}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}#status{color:var(--muted);margin:22px 0 14px;min-height:26px}
.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:20px;align-items:start}
figure{margin:0;min-width:0;width:100%;max-width:var(--shot-width);justify-self:start;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--surface)}
figcaption{padding:14px 16px;border-bottom:1px solid var(--line)}figcaption strong{display:block;font-size:15px;font-weight:600}figcaption small{color:var(--muted);font-size:12px;display:block;margin-top:5px}
.image{display:flex;justify-content:center;padding:10px;background:var(--bg)}.image img{width:100%;height:auto;border:1px solid var(--line);border-radius:6px;display:block}
figure[data-wide="true"]{grid-column:1/-1}.links{display:flex;flex-wrap:wrap;gap:8px 24px;border-top:1px solid var(--line);padding-top:20px;margin-top:30px;font-size:14px}
.scope{font-size:13px;color:var(--muted);margin:22px 0}#empty{border:1px dashed var(--line);padding:24px;border-radius:12px;color:var(--muted)}
@media(max-width:480px){main{padding:22px 14px 32px}.controls>label{flex:1 1 42%}.controls .step{flex-basis:100%}select{width:100%}.stats{gap:6px 16px}}
</style></head><body><main>
<header><p class="eyebrow">ISLEMIND · H 阶段</p><h1>场景方案，从保存到应用</h1>
<p>保存常用配置，先核对作用范围、路由和引用，再应用到已有会话或新的未发送草稿。这里展示完成版源码的实际页面与离线操作证据。</p>
<p class="muted">五套主题共用编辑、选择、阅读和反馈控件。网页按 CSS 像素标注，Android 按设备像素标注。</p></header>
<div class="stats" id="stats"></div>
<div class="controls" aria-label="截图筛选">
<label>平台<select id="platform"><option value="all">全部</option><option value="web">网页</option><option value="android">Android</option></select></label>
<label>主题<select id="family"></select></label><label>模式<select id="mode"><option value="light">浅色</option><option value="dark">深色</option></select></label>
<label>宽度<select id="width"><option value="all">全部宽度</option></select></label>
<label class="step">步骤或关联页面<select id="step"><option value="all">全部步骤</option></select></label>
<button id="reset" type="button">重置筛选</button></div>
<p id="status" role="status" aria-live="polite"></p><div id="empty" hidden>此组合未保留截图。请选择其他步骤或宽度；验收范围以结果记录为准。</div>
<div id="gallery" class="gallery"></div>
<p class="scope">Android 使用独立、无 INTERNET 权限的优化 Hermes 构建和合成连接/资源。网页使用隔离浏览器数据与真实 Expo SQLite。真实供应商和真实工具执行均为零；这些记录不认证 iOS、完整读屏或真实调用收益。</p>
<div class="links" id="links"></div></main>
<script id="manifest" type="application/json">${embedded}</script><script>
const data=JSON.parse(document.getElementById('manifest').textContent),byId=id=>document.getElementById(id);
for(const family of data.families)byId('family').add(new Option(family.name,family.id));
for(const width of [...new Set(data.screenshots.map(page=>page.width))].sort((a,b)=>a-b))byId('width').add(new Option(String(width),String(width)));
for(const view of data.views)byId('step').add(new Option(view.label,view.id));
const web=data.screenshots.filter(page=>page.platform==='web').length,native=data.screenshots.length-web;
byId('stats').innerHTML='<span><strong>'+web+'</strong> 网页截图</span><span><strong>'+native+'</strong> Android 截图</span><span><strong>5 × 2</strong> 主题与模式</span><span><strong>0</strong> 真实供应商调用</span>';
for(const source of data.sources){const link=document.createElement('a');link.href=source.file;link.textContent=source.label+' · 结果记录';byId('links').append(link)}
const build=document.createElement('a');build.href=data.build.file;build.textContent='独立 Android 构建记录';byId('links').append(build);
function render(){
 const platform=byId('platform').value,family=byId('family').value,mode=byId('mode').value,width=byId('width').value,step=byId('step').value;
 document.body.dataset.family=family;document.body.dataset.mode=mode;
 const pages=data.screenshots.filter(page=>(platform==='all'||page.platform===platform)&&page.family===family&&page.mode===mode&&(width==='all'||String(page.width)===width)&&(step==='all'||page.view===step));
 byId('status').textContent=pages.length+' 张截图 · '+data.families.find(item=>item.id===family).name+' · '+(mode==='light'?'浅色':'深色');
 byId('empty').hidden=pages.length>0;byId('gallery').replaceChildren();
 for(const page of pages){const figure=document.createElement('figure');figure.dataset.wide=String(page.platform==='web'&&page.width>=900);
  figure.style.setProperty('--shot-width',(page.platform==='android'?420:page.width+22)+'px');
  const caption=document.createElement('figcaption'),title=document.createElement('strong'),detail=document.createElement('small');
  title.textContent=page.label;detail.textContent=(page.platform==='web'?'网页':'Android')+' · '+page.width+' '+page.widthUnit+' · '+page.source;caption.append(title,detail);
  const image=document.createElement('img');image.src=page.file;image.alt=page.label+' · '+page.family+' · '+page.mode;image.loading='lazy';
  const link=document.createElement('a');link.className='image';link.href=page.file;link.append(image);figure.append(caption,link);byId('gallery').append(figure)}
}
for(const id of ['platform','family','mode','width','step'])byId(id).addEventListener('change',render);
byId('reset').addEventListener('click',()=>{byId('platform').value='all';byId('family').value='minimal';byId('mode').value='light';byId('width').value='all';byId('step').value='all';render()});
render();
</script></body></html>`
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2)); fs.writeFileSync(index, html)
console.log(JSON.stringify({ index, screenshots: screenshots.length, sources: manifest.sources.length, manifestSha256: hash(manifestFile) }))
