import { MarkdownIt } from 'react-native-markdown-display'

// The guide embeds navigation anchors as HTML. Markdown tokens keep those
// anchors and link destinations separate from labels, captions and code.
const parser = new MarkdownIt({ html: true, typographer: true })

interface GuideChapter {
  title: string
  body: string
}

const chapterText = new WeakMap<GuideChapter, string>()

interface GuideToken {
  type: string
  content: string
  children?: GuideToken[] | null
}

function inlineText(tokens: GuideToken[]): string {
  return tokens.map(token => {
    if (token.children) return inlineText(token.children)
    if (token.type === 'text' || token.type === 'code_inline') return token.content
    if (token.type === 'softbreak' || token.type === 'hardbreak') return ' '
    return ''
  }).join('')
}

export function normalizeGuideSearch(text: string) {
  return text.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

export function guideSearchText(chapter: GuideChapter) {
  const cached = chapterText.get(chapter)
  if (cached !== undefined) return cached
  const blocks: GuideToken[] = parser.parse(chapter.body, {})
  const text = blocks.map(block => {
    if (block.children) return inlineText(block.children)
    if (block.type === 'fence' || block.type === 'code_block') return block.content
    return ''
  })
  const searchable = normalizeGuideSearch([chapter.title, ...text].join(' '))
  chapterText.set(chapter, searchable)
  return searchable
}
