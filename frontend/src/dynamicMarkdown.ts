import { translate } from './i18n'
import { mermaidThemeVariables } from './themeConfig'
import type { ThemeName } from './types'

export const mermaidFontScale = (fontSize: number) => Math.max(0.5, fontSize / 14)
let renderSequence = 0
let renderQueue: Promise<void> = Promise.resolve()

export function normalizeMermaidLabelWidths(svg: SVGSVGElement) {
  svg.querySelectorAll<SVGForeignObjectElement>('foreignObject').forEach((foreignObject) => {
    const container = foreignObject.firstElementChild
    const width = Number.parseFloat(foreignObject.getAttribute('width') ?? '')
    if (!(container instanceof HTMLElement) || !Number.isFinite(width) || width <= 0) return
    container.style.width = `${width}px`
    container.style.maxWidth = `${width}px`
  })
}

export function renderMermaidSvg(source: string, theme: ThemeName, fontSize: number): Promise<string> {
  // Mermaid configuration is global. Serialize preview and export renders so a
  // theme change cannot alter an in-flight document snapshot.
  const result = renderQueue.then(async () => {
    const { default: mermaid } = await import('mermaid')
    await document.fonts.ready
    const scale = mermaidFontScale(fontSize)
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'base',
      themeVariables: mermaidThemeVariables(theme, fontSize),
      fontFamily: 'Noto Sans TC, sans-serif',
      flowchart: {
        padding: Math.round(15 * scale),
        nodeSpacing: Math.round(50 * scale),
        rankSpacing: Math.round(50 * scale),
        wrappingWidth: Math.round(360 * scale),
      },
    })
    const { svg } = await mermaid.render(`mermaid-${++renderSequence}`, source)
    return svg
  })
  renderQueue = result.then(() => undefined, () => undefined)
  return result
}

export function showMermaidError(block: HTMLElement, source: string) {
  block.classList.add('has-error')
  const code = document.createElement('code')
  code.textContent = source
  const pre = document.createElement('pre')
  pre.className = 'mermaid-fallback'
  pre.append(code)
  const message = document.createElement('p')
  message.className = 'mermaid-error'
  message.textContent = translate('Could not draw this diagram. Check the Mermaid syntax.')
  block.replaceChildren(message, pre)
}

export async function renderMathBlocks(blocks: HTMLElement[]) {
  if (!blocks.length) return
  const { default: katex } = await import('katex')
  for (const block of blocks) {
    katex.render(decodeURIComponent(block.dataset.mathSource || ''), block, {
      displayMode: block.dataset.mathDisplay === 'true',
      output: 'htmlAndMathml',
      strict: 'warn',
      throwOnError: false,
      trust: false,
    })
    block.classList.add('is-rendered')
  }
}
