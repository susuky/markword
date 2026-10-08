import { isolateHistory } from '@codemirror/commands'
import { EditorSelection, StateEffect, StateField, Transaction, type EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { normalizeAssetPath } from './assets'
import { normalizeMermaidLabelWidths, renderMathBlocks, renderMermaidSvg, showMermaidError } from './dynamicMarkdown'
import { translate } from './i18n'
import { elementOffsetToSourceLine, renderMarkdown } from './markdown'
import { getAssetsByPaths } from './storage'
import type { ThemeName } from './types'

interface RenderedBlock {
  from: number
  to: number
  html: string
  heading: string
}

interface LivePreviewOptions {
  theme: ThemeName
  mermaidFontSize: number
  initiallyFocused: boolean
  onEditTable: (line: number) => void
}

const editingFocus = StateEffect.define<boolean>()
const cleanups = new WeakMap<HTMLElement, () => void>()

function renderedBlocks(state: EditorState): RenderedBlock[] {
  const root = document.createElement('div')
  root.innerHTML = renderMarkdown(state.doc.toString())
  const blocks: RenderedBlock[] = []
  const addBlock = (element: HTMLElement, html = element.outerHTML) => {
    const start = Number(element.dataset.sourceStart)
    const end = Number(element.dataset.sourceEnd)
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > state.doc.lines) return
    blocks.push({ from: state.doc.line(start).from, to: state.doc.line(end).to, html, heading: /^H[1-6]$/.test(element.tagName) ? element.tagName.slice(1) : '' })
  }
  for (const element of Array.from(root.children) as HTMLElement[]) {
    if (element.classList.contains('footnotes')) {
      element.querySelectorAll<HTMLElement>('li[data-source-start]').forEach((item, index) => {
        addBlock(item, `<section class="footnotes"><ol start="${index + 1}">${item.outerHTML}</ol></section>`)
      })
    } else {
      addBlock(element)
    }
  }
  return blocks.sort((a, b) => a.from - b.from)
}

class RenderedBlockWidget extends WidgetType {
  constructor(readonly block: RenderedBlock, readonly options: LivePreviewOptions) { super() }

  eq(other: RenderedBlockWidget) {
    return this.block.from === other.block.from && this.block.to === other.block.to
      && this.block.html === other.block.html && this.options === other.options
  }

  toDOM(view: EditorView) {
    const dom = document.createElement('div')
    dom.className = 'live-preview-block'
    dom.innerHTML = this.block.html
    dom.tabIndex = 0
    dom.setAttribute('role', 'group')
    dom.setAttribute('aria-label', translate('Click or press Enter to edit this block'))

    const edit = (target: HTMLElement, clientY?: number) => {
      const lineNumber = clientY === undefined ? null : elementOffsetToSourceLine(target, clientY)
      const position = lineNumber === null ? this.block.from
        : view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, Math.round(lineNumber)))).from
      view.dispatch({ selection: EditorSelection.cursor(position), effects: editingFocus.of(true) })
      view.focus()
    }
    dom.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || (event.target as Element).closest('button, input, a, video, audio')) return
      event.preventDefault()
      edit(event.target as HTMLElement, event.clientY)
    })
    // Touch screens do not always send mousedown after a tap.
    dom.addEventListener('click', (event) => {
      if ((event.target as Element).closest('button, input, a, video, audio')) return
      edit(event.target as HTMLElement, event.clientY)
    })
    dom.addEventListener('keydown', (event) => {
      if (event.target !== dom || !['Enter', ' '].includes(event.key)) return
      event.preventDefault()
      edit(dom)
    })

    dom.querySelectorAll<HTMLInputElement>('.task-list-checkbox').forEach((checkbox) => {
      checkbox.disabled = false
      checkbox.addEventListener('change', () => {
        const line = view.state.doc.line(Number(checkbox.closest<HTMLElement>('li[data-source-start]')!.dataset.sourceStart))
        const marker = /^\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[([ xX])\]/.exec(line.text)
        if (!marker) return
        const from = line.from + marker[0].length - 2
        view.dispatch({
          changes: { from, to: from + 1, insert: checkbox.checked ? 'x' : ' ' },
          annotations: [Transaction.userEvent.of('input.task'), isolateHistory.of('full')],
        })
      })
    })
    dom.querySelectorAll<HTMLTableElement>('table[data-source-start]').forEach((table) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'preview-table__edit'
      button.textContent = translate('Edit table')
      button.addEventListener('click', () => this.options.onEditTable(Number(table.dataset.sourceStart)))
      table.before(button)
    })
    dom.querySelectorAll<HTMLButtonElement>('.copy-code').forEach((button) => {
      button.addEventListener('click', () => {
        void navigator.clipboard.writeText(button.parentElement?.querySelector('code')?.textContent ?? '')
          .then(() => { button.textContent = translate('Copied') })
          .catch(() => { button.textContent = translate('Could not copy code') })
      })
    })

    let disposed = false
    const urls: string[] = []
    const observer = new ResizeObserver(() => view.requestMeasure())
    observer.observe(dom)
    const math = Array.from(dom.querySelectorAll<HTMLElement>('[data-math-source]'))
    if (math.length) void Promise.all([renderMathBlocks(math), import('katex/dist/katex.min.css')])
      .then(() => { if (!disposed) view.requestMeasure() })
      .catch((error) => console.warn('Math render failed', error))

    const timer = window.setTimeout(() => {
      for (const block of dom.querySelectorAll<HTMLElement>('.mermaid-block')) {
        const source = decodeURIComponent(block.dataset.mermaidSource ?? '')
        void renderMermaidSvg(source, this.options.theme, this.options.mermaidFontSize).then((svg) => {
          if (disposed) return
          block.innerHTML = svg
          const element = block.querySelector<SVGSVGElement>('svg')
          if (element) normalizeMermaidLabelWidths(element)
          block.classList.add('is-rendered')
          view.requestMeasure()
        }).catch(() => {
          if (!disposed) { showMermaidError(block, source); view.requestMeasure() }
        })
      }
    }, 300)

    const elements = Array.from(dom.querySelectorAll<HTMLElement>('[data-asset-path]'))
    const paths = [...new Set(elements.map((element) => normalizeAssetPath(element.dataset.assetPath)).filter((path): path is string => Boolean(path)))]
    if (paths.length) void getAssetsByPaths(paths).then((assets) => {
      if (disposed) return
      const byPath = new Map<string, string>()
      assets.forEach((asset, path) => {
        const url = URL.createObjectURL(asset.blob)
        urls.push(url)
        byPath.set(path, url)
      })
      for (const element of elements) {
        const url = byPath.get(normalizeAssetPath(element.dataset.assetPath) ?? '')
        const container = element.closest<HTMLElement>('.local-media')
        element.classList.remove('is-loading')
        container?.classList.remove('is-loading')
        if (!url) {
          element.classList.add('is-missing')
          element.title = translate('Local asset is missing')
          if (element instanceof HTMLAnchorElement) element.setAttribute('aria-disabled', 'true')
          container?.classList.add('is-missing')
          container?.setAttribute('data-missing-label', translate('Local asset is missing'))
        } else {
          element.classList.add('is-resolved')
          container?.classList.add('is-resolved')
          if (element instanceof HTMLAnchorElement) element.href = url
          else if (element instanceof HTMLImageElement || element instanceof HTMLMediaElement) element.src = url
        }
      }
      view.requestMeasure()
    }).catch(() => {
      if (disposed) return
      elements.forEach((element) => { element.classList.remove('is-loading'); element.classList.add('is-missing') })
      const message = document.createElement('p')
      message.className = 'live-preview-error'
      message.setAttribute('role', 'status')
      message.textContent = translate('Could not load local assets. Try reopening the document.')
      dom.append(message)
    })
    cleanups.set(dom, () => {
      disposed = true
      window.clearTimeout(timer)
      observer.disconnect()
      urls.forEach((url) => URL.revokeObjectURL(url))
    })
    return dom
  }

  destroy(dom: HTMLElement) { cleanups.get(dom)?.(); cleanups.delete(dom) }
}

export function livePreview(options: LivePreviewOptions) {
  function decorations(state: EditorState, blocks: RenderedBlock[], focused: boolean) {
    const ranges: Range<Decoration>[] = []
    for (const block of blocks) {
      const selected = state.selection.ranges.some((range) => range.from <= block.to && range.to >= block.from && (focused || !range.empty))
      if (selected) {
        const first = state.doc.lineAt(block.from)
        const last = state.doc.lineAt(block.to)
        for (let number = first.number; number <= last.number; number++) {
          ranges.push(Decoration.line({ class: `live-source-line${block.heading && number === first.number ? ` live-source-heading-${block.heading}` : ''}` }).range(state.doc.line(number).from))
        }
      } else if (block.from < block.to) {
        ranges.push(Decoration.replace({ widget: new RenderedBlockWidget(block, options), block: true }).range(block.from, block.to))
      }
    }
    return Decoration.set(ranges, true)
  }

  const field = StateField.define<{ blocks: RenderedBlock[]; focused: boolean; decorations: DecorationSet }>({
    create(state) {
      const blocks = renderedBlocks(state)
      return { blocks, focused: options.initiallyFocused, decorations: decorations(state, blocks, options.initiallyFocused) }
    },
    update(value, transaction) {
      const focused = transaction.effects.reduce((current, effect) => effect.is(editingFocus) ? effect.value : current, value.focused)
      if (!transaction.docChanged && !transaction.selection && focused === value.focused) return value
      const blocks = transaction.docChanged ? renderedBlocks(transaction.state) : value.blocks
      return { blocks, focused, decorations: decorations(transaction.state, blocks, focused) }
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  })
  return [field, EditorView.domEventHandlers({
    focus: (_event, view) => { view.dispatch({ effects: editingFocus.of(true) }) },
    blur: (_event, view) => { view.dispatch({ effects: editingFocus.of(false) }) },
  })]
}
