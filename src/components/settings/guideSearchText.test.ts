import { guideSearchText, normalizeGuideSearch } from './guideSearchText'

it('searches link labels and image descriptions without matching their destinations or section anchors', () => {
  const text = guideSearchText({ title: 'モデル', body: `<a id="hidden-section"></a>
## 连接
为[当前**模型**](models.md#hidden-section)选择连接。
![连接设置](../assets/setup-flow.svg)` })
  expect(text).toContain('モデル 连接 为当前模型选择连接。 连接设置')
  for (const hidden of ['hidden-section', 'setup-flow.svg', 'models.md', '<a id']) expect(text).not.toContain(hidden)
})

it('retains visible paths, literal markup in code and phrases across Markdown formatting', () => {
  const text = guideSearchText({ title: 'Manual', body: "Use **two**\nproviders at `../models.md`.\n\n```html\n<a id=\"example\"></a>\n```\n\n[https://example.com](https://example.com)" })
  for (const visible of ['Use two providers', '../models.md', '<a id="example"></a>', 'https://example.com']) {
    expect(text).toContain(normalizeGuideSearch(visible))
  }
})

it('uses the same rules for wide characters, typography and whitespace in queries and text', () => {
  expect(guideSearchText({ title: 'Q&A', body: 'Open the model’s **ＡＰＩ** settings.' })).toContain(normalizeGuideSearch("MODEL'S   api\nsettings"))
})
