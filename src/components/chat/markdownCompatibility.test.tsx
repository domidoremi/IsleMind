import { Linking, Text } from 'react-native'
import { fireEvent, render } from '@testing-library/react-native'
import Markdown, { MarkdownIt as RendererMarkdownIt, type ASTNode, type RenderRules } from 'react-native-markdown-display'

// Exercise the renderer's real parser/AST boundary, not a Markdown component mock.
const MarkdownIt = require('markdown-it')
const LinkifyIt = require('linkify-it')
// The upstream declaration describes one ASTNode, but this runtime API passes an array.
const { parser } = require('react-native-markdown-display')

function flatten(nodes: ASTNode[]): ASTNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children)])
}

it('preserves the CommonJS constructor and renderer token-to-AST contract', () => {
  expect(RendererMarkdownIt).toBe(MarkdownIt)
  const source = '# Heading\n\n**bold** and `code`\n\n- first\n- second\n\n> quote\n\n```js\nconst x = 1\n```\n\n| A | B |\n| - | - |\n| x | y |\n\n[reference](https://example.com "title")'
  let nodes: ASTNode[] = []
  parser(source, (tree: ASTNode[]) => { nodes = flatten(tree); return null }, MarkdownIt({ typographer: true }))
  expect(nodes.map(node => node.type)).toEqual(expect.arrayContaining(['heading1', 'strong', 'code_inline', 'bullet_list', 'list_item', 'blockquote', 'fence', 'table', 'link']))
  expect(nodes.find(node => node.type === 'fence')).toMatchObject({ content: 'const x = 1\n', sourceInfo: 'js' })
  expect(nodes.find(node => node.type === 'link')?.attributes).toMatchObject({ href: 'https://example.com', title: 'title' })
})

it('keeps default typography, literal HTML and opt-in linkification semantics', () => {
  const md = MarkdownIt({ typographer: true })
  expect(md.render('"quoted" -- ... <b>raw</b>')).toContain('“quoted” – … &lt;b&gt;raw&lt;/b&gt;')
  expect(md.render('https://example.com')).not.toContain('<a ')
  const linked = MarkdownIt({ linkify: true }).render('https://example.com mail@example.com')
  expect(linked).toContain('href="https://example.com"')
  expect(linked).toContain('href="mailto:mail@example.com"')
  expect(md.render('[blocked](javascript:alert(1))')).not.toContain('<a ')
})

it('preserves linkifier CommonJS, Unicode, match offsets and validation boundaries', () => {
  const source = '中文 https://例え.テスト/path and mail@example.com.'
  const linkifier = LinkifyIt()
  expect(linkifier.test(source)).toBe(true)
  const matches = linkifier.match(source)
  expect(matches.map((match: { url: string }) => match.url)).toEqual(['https://例え.テスト/path', 'mailto:mail@example.com'])
  for (const match of matches) expect(source.slice(match.index, match.lastIndex)).toBe(match.raw)
  expect(linkifier.match('javascript:alert(1)')).toBeNull()
  expect(linkifier.match('`not a URL`')).toBeNull()
})

it('renders selectable custom text and inline-code rules through the real native renderer', async () => {
  const rules: RenderRules = {
    text: (node, _children, _parent, styles) => <Text key={node.key} selectable style={styles.text}>{node.content}</Text>,
    textgroup: (node, children, _parent, styles) => <Text key={node.key} selectable style={styles.textgroup}>{children}</Text>,
    code_inline: node => <Text key={node.key} selectable>{node.content}</Text>,
  }
  const view = await render(<Markdown rules={rules}>{'Plain **strong** and `inline-code`'}</Markdown>)
  expect(view.getByText('strong').props.selectable).toBe(true)
  expect(view.getByText('inline-code').props.selectable).toBe(true)
})

it('honors blocked native link callbacks and image placeholder rules used by document previews', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
  try {
    const onLinkPress = jest.fn(() => false)
    const view = await render(<Markdown onLinkPress={onLinkPress} rules={{ image: node => <Text key={node.key}>Image omitted</Text> }}>{'[reference](https://example.com)\n\n![alt](https://example.com/image.png)'}</Markdown>)
    await fireEvent.press(view.getByText('reference'))
    expect(onLinkPress).toHaveBeenCalledWith('https://example.com')
    expect(open).not.toHaveBeenCalled()
    expect(view.getByText('Image omitted')).toBeTruthy()
  } finally {
    open.mockRestore()
  }
})
