const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
const evidence = path.resolve(root, process.argv[2] || 'test-evidence/qa/islemind-connection-references-20261106')
assert(evidence.startsWith(root + path.sep))
const json = name => JSON.parse(fs.readFileSync(path.join(evidence, name), 'utf8').replace(/^\uFEFF/, ''))
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
for (const file of ['index.html', 'atlas-manifest.json']) assert(!fs.existsSync(path.join(evidence, file)), 'Preserve existing atlas evidence')
const web = json('views-i5/results.json')
const native = json('native-i5-r2/results.json')
assert(web.passed && web.errors.length === 0 && native.pass && native.errors.length === 0)
const labels = {
  closed: '连接详情', references: '连接引用', 'backup-roles': '备用目标引用', 'routing-editor': '定位路由编辑',
  'scene-editor': '定位场景编辑', conversation: '定位已有会话', coverage: '检查范围', 'read-failure': '读取失败与重试',
  'delete-all': '全部连接删除影响', 'delete-invalid': '无效连接删除影响', 'delete-selected': '选中连接删除影响',
  'missing-route': '已删除路由', 'missing-scene': '已删除场景', 'routing-missing': '已删除路由', 'scene-missing': '已删除场景',
  'unsent-draft': '未发送草稿引用', 'draft-coverage': '草稿与保存范围', 'route-input': '主题切换与输入', help: '离线帮助',
  'references-final': '连接引用复核', 'conversation-reference': '会话引用复核',
  'older-conversation': '定位未加载的历史会话',
}
const screenshots = [
  ...web.pages.map(entry => ({ platform: 'web', family: entry.family, mode: entry.mode, width: String(entry.width),
    view: entry.view, label: labels[entry.view] || entry.view, file: `views-i5/${entry.screenshot}` })),
  ...native.pages.map(entry => ({ platform: 'android', family: entry.family, mode: entry.mode, width: 'android',
    view: entry.screen, label: labels[entry.screen] || entry.screen, file: `native-i5-r2/${entry.screenshot}` })),
].map(entry => {
  const file = path.resolve(evidence, entry.file)
  assert(file.startsWith(evidence + path.sep) && fs.existsSync(file))
  return { ...entry, sha256: hash(file) }
})
const data = { schema: 'islemind.connection-references-atlas.v1', createdAt: new Date().toISOString(),
  webExportSha256: web.exportHash, nativeApkSha256: native.apkSha256,
  webViews: web.pages.length, nativeViews: native.pages.length, webChecks: web.checks.length, nativeChecks: native.checks.length,
  screenshots, reports: ['views-i5/results.json', 'native-i5-r2/results.json', 'gates-i5/results.json'] }
fs.writeFileSync(path.join(evidence, 'atlas-manifest.json'), JSON.stringify(data, null, 2))
const embedded = JSON.stringify(data).replaceAll('<', '\\u003c')
const report = path.relative(evidence, path.join(root, 'docs/release/connection-references-implementation-2026-11-06.md')).replaceAll('\\', '/')
fs.writeFileSync(path.join(evidence, 'index.html'), `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>IsleMind · 连接引用验收图册</title>
<style>
:root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#203b38;background:#f4f8f7;color-scheme:light}
*{box-sizing:border-box}body{margin:0;padding:clamp(16px,4vw,48px);min-width:0}main{max-width:1280px;margin:auto}
header{max-width:840px}h1{font-size:clamp(24px,4vw,38px);line-height:1.25;letter-spacing:-.03em;margin:8px 0 16px}
p{line-height:1.7;color:#536b68;margin:10px 0}.eyebrow{font-size:14px;font-weight:650;color:#416963}
a{color:#245e55;text-underline-offset:3px}nav{display:flex;gap:18px;flex-wrap:wrap;margin:18px 0 28px}
.filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;background:#fff;border:1px solid #dce8e4;border-radius:18px;padding:18px}
label{display:grid;gap:8px;font-size:14px;font-weight:600}select{width:100%;min-width:0;min-height:44px;border:1px solid #ceddd8;border-radius:10px;background:#f8fbfa;color:#203b38;padding:8px;font:inherit}
select:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #4c8b7c;outline-offset:3px}.status{font-size:14px;margin:18px 0}
.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:22px;align-items:start}
.gallery.single{display:flex;justify-content:center}.gallery.single figure{width:100%;max-width:var(--capture-width)}
figure{margin:0;border:1px solid #dce8e4;background:white;border-radius:16px;overflow:hidden;min-width:0}
figure button{display:block;padding:0;width:100%;border:0;background:#edf3f1;cursor:zoom-in;min-height:44px}
figure img{display:block;max-width:100%;width:auto;height:auto;max-height:640px;object-fit:contain;margin:auto}
figcaption{padding:14px 16px;line-height:1.6}.meta{display:block;font-size:13px;color:#617773}
dialog{max-width:min(96vw,1120px);width:max-content;max-height:94vh;padding:16px;border:1px solid #dce8e4;border-radius:16px;overflow:auto;background:#fff}
dialog::backdrop{background:#18322ccc}dialog img{display:block;max-width:100%;width:auto;height:auto;margin:12px auto}
dialog button{min-height:44px;min-width:72px;border:1px solid #cbded7;border-radius:10px;background:#edf5f2;font:inherit;cursor:pointer;padding:8px 16px}
footer{margin-top:36px;font-size:14px;color:#617773;line-height:1.7}#empty{padding:32px;background:white;border-radius:16px}
@media(max-width:600px){.filters{grid-template-columns:repeat(2,minmax(0,1fr));padding:14px}.gallery{gap:16px}nav{gap:12px}}
</style>
<main><header><span class="eyebrow">IsleMind · I 批 · 本地验收</span><h1>连接、方案与会话，关系更清楚。</h1>
<p>按需查看连接引用，在删除前核对影响，再进入对应配置。图册收录最终 Web 与独立 Android 验收截图，可以切换主题、浅深模式与屏幕宽度。</p>
<nav><a href="${report}">实施与验收报告</a><a href="views-i5/results.json">Web 记录</a><a href="native-i5-r2/results.json">Android 记录</a><a href="gates-i5/results.json">工程检查</a></nav></header>
<div class="filters"><label>主题<select id="family"><option value="minimal">Minimal</option><option value="monet">Monet</option><option value="material">Material</option><option value="liquid-glass">Liquid Glass</option><option value="animal-island-ui">Animal Island</option></select></label>
<label>模式<select id="mode"><option value="light">浅色</option><option value="dark">深色</option></select></label>
<label>屏幕<select id="width"><option value="390">Web · 390px</option><option value="320">Web · 320px</option><option value="960">Web · 960px</option><option value="android">Android · 实际设备</option></select></label>
<label>步骤<select id="view"><option value="all">所有步骤</option></select></label></div>
<p id="status" class="status" aria-live="polite"></p><div id="gallery" class="gallery"></div><p id="empty" hidden>这个组合没有保存截图，请切换步骤或屏幕。</p>
<footer>全部数据为隔离样例。Web 与 Android 分别记录；真实供应商调用、iOS 与完整读屏资格仍需单独验证。截图可以打开查看完整尺寸。</footer></main>
<dialog id="zoom" aria-label="查看完整截图"><button id="close" type="button">关闭</button><p id="zoom-label"></p><img id="zoom-image" alt=""></dialog>
<script>const data=${embedded};const family=document.querySelector('#family'),mode=document.querySelector('#mode'),width=document.querySelector('#width'),view=document.querySelector('#view'),gallery=document.querySelector('#gallery'),zoom=document.querySelector('#zoom');let opener;
const names={minimal:'Minimal',monet:'Monet',material:'Material','liquid-glass':'Liquid Glass','animal-island-ui':'Animal Island'};
for(const [key,label] of new Map(data.screenshots.map(item=>[item.view,item.label]))){const option=document.createElement('option');option.value=key;option.textContent=label;view.append(option)}
function render(){const items=data.screenshots.filter(item=>item.family===family.value&&item.mode===mode.value&&item.width===width.value&&(view.value==='all'||item.view===view.value));gallery.replaceChildren();gallery.classList.toggle('single',items.length===1);document.querySelector('#empty').hidden=!!items.length;document.querySelector('#status').textContent=items.length+' 张当前截图 · '+data.webViews+' 张 Web / '+data.nativeViews+' 张 Android · 点击查看完整尺寸';
for(const item of items){const figure=document.createElement('figure');figure.style.setProperty('--capture-width',(item.width==='android'?'430':Number(item.width)+2)+'px');const button=document.createElement('button');button.type='button';button.setAttribute('aria-label','查看 '+item.label);const image=document.createElement('img');image.src=item.file;image.alt=item.label;image.loading='lazy';button.append(image);button.onclick=()=>{opener=button;document.querySelector('#zoom-image').src=item.file;document.querySelector('#zoom-image').alt=item.label;document.querySelector('#zoom-label').textContent=item.label+' · '+names[item.family]+' · '+(item.mode==='light'?'浅色':'深色');zoom.showModal()};const caption=document.createElement('figcaption');caption.textContent=item.label;const meta=document.createElement('span');meta.className='meta';meta.textContent=names[item.family]+' · '+(item.mode==='light'?'浅色':'深色')+' · '+(item.width==='android'?'Android':item.width+'px');caption.append(meta);figure.append(button,caption);gallery.append(figure)}}
for(const control of [family,mode,width,view])control.onchange=render;document.querySelector('#close').onclick=()=>zoom.close();zoom.onclose=()=>opener?.focus();zoom.onclick=event=>{if(event.target===zoom)zoom.close()};render();</script></html>`)
console.log(JSON.stringify({ screenshots: screenshots.length, web: web.pages.length, android: native.pages.length, index: path.join(evidence, 'index.html') }))
