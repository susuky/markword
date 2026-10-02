import { inlineAssetsInHtml } from './assets'
import { normalizeMermaidLabelWidths, renderMathBlocks, renderMermaidSvg, showMermaidError } from './dynamicMarkdown'
import { renderMarkdown } from './markdown'
import type { DocumentMode, ThemeName } from './types'

async function embeddedMathStyles() {
  const { default: css } = await import('katex/dist/katex.min.css?raw')
  const fonts = import.meta.glob<string>('../node_modules/katex/dist/fonts/*.woff2', { query: '?inline', import: 'default' })
  const urls = new Map(await Promise.all(Object.entries(fonts).map(async ([path, load]) => [path.split('/').at(-1)!, await load()] as const)))
  return css.replace(/src:url\(fonts\/([^)]+\.woff2)\)[^;}]+/g, (_match, name: string) => {
    const url = urls.get(name)
    if (!url?.startsWith('data:')) throw new Error('Could not embed math fonts')
    return `src:url(${url}) format("woff2")`
  })
}

export async function renderHtmlSnapshot(markdown: string, mode: DocumentMode, theme: ThemeName, mermaidFontSize: number) {
  const content = document.createElement('div')
  content.innerHTML = renderMarkdown(markdown, mode)
  content.querySelectorAll('.copy-code').forEach((button) => button.remove())
  const math = Array.from(content.querySelectorAll<HTMLElement>('[data-math-source]'))
  const mathStyles = math.length ? embeddedMathStyles() : Promise.resolve('')
  const diagrams = async () => {
    for (const block of content.querySelectorAll<HTMLElement>('.mermaid-block')) {
      const source = decodeURIComponent(block.dataset.mermaidSource || '')
      try {
        block.innerHTML = await renderMermaidSvg(source, theme, mermaidFontSize)
        const svg = block.querySelector('svg')
        if (svg) normalizeMermaidLabelWidths(svg)
        block.classList.add('is-rendered')
      } catch {
        showMermaidError(block, source)
      }
    }
  }
  const [css] = await Promise.all([mathStyles, renderMathBlocks(math), diagrams()])
  return { html: await inlineAssetsInHtml(content.innerHTML), css }
}
