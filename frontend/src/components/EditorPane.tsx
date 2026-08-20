import { markdown } from '@codemirror/lang-markdown'
import { foldAll, unfoldAll } from '@codemirror/language'
import { openSearchPanel } from '@codemirror/search'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useI18n } from '../i18n'

export interface EditorHandle {
  scrollToLine: (line: number) => void
  jumpToLine: (line: number) => void
  focus: () => void
  search: () => void
  insert: (text: string, cursorOffset?: number) => void
  foldAll: () => void
  unfoldAll: () => void
}

interface EditorPaneProps {
  value: string
  onChange: (value: string) => void
  onScrollLine: (line: number, atEnd: boolean) => void
  typewriter?: boolean
  onSlashCommand?: () => void
}

export const EditorPane = forwardRef<EditorHandle, EditorPaneProps>(function EditorPane(
  { value, onChange, onScrollLine, typewriter = false, onSlashCommand },
  ref,
) {
  const { t } = useI18n()
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const externalValueRef = useRef(value)
  const suppressScrollRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const onScrollRef = useRef(onScrollLine)
  const typewriterRef = useRef(typewriter)
  const onSlashCommandRef = useRef(onSlashCommand)
  onChangeRef.current = onChange
  onScrollRef.current = onScrollLine
  typewriterRef.current = typewriter
  onSlashCommandRef.current = onSlashCommand

  useImperativeHandle(ref, () => ({
    scrollToLine(line) {
      const view = viewRef.current
      if (!view) return
      const safeLine = Math.max(1, Math.min(view.state.doc.lines, Math.round(line)))
      const block = view.lineBlockAt(view.state.doc.line(safeLine).from)
      suppressScrollRef.current = true
      view.scrollDOM.scrollTop = block.top
      window.setTimeout(() => { suppressScrollRef.current = false }, 90)
    },
    jumpToLine(line) {
      const view = viewRef.current
      if (!view) return
      const safeLine = Math.max(1, Math.min(view.state.doc.lines, Math.round(line)))
      const position = view.state.doc.line(safeLine).from
      view.dispatch({
        selection: EditorSelection.cursor(position),
        effects: EditorView.scrollIntoView(position, { y: 'center' }),
      })
      view.focus()
    },
    focus() {
      viewRef.current?.focus()
    },
    search() {
      const view = viewRef.current
      if (!view) return
      view.focus()
      openSearchPanel(view)
    },
    insert(text, cursorOffset = text.length) {
      const view = viewRef.current
      if (!view) return
      const selection = view.state.selection.main
      const cursor = selection.from + Math.max(0, Math.min(text.length, cursorOffset))
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: text },
        selection: EditorSelection.cursor(cursor),
        scrollIntoView: true,
      })
      view.focus()
    },
    foldAll() {
      const view = viewRef.current
      if (view) foldAll(view)
    },
    unfoldAll() {
      const view = viewRef.current
      if (view) unfoldAll(view)
    },
  }), [])

  useEffect(() => {
    if (!hostRef.current) return
    const state = EditorState.create({
      doc: externalValueRef.current,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { height: '100%', fontSize: '15px' },
          '.cm-scroller': {
            fontFamily: '"JetBrains Mono", "Noto Sans Mono CJK TC", ui-monospace, monospace',
            lineHeight: '1.72',
          },
          '.cm-content': { padding: '12px 0 28px' },
          '.cm-line': { padding: '0 18px 0 12px' },
          '.cm-activeLine': { backgroundColor: 'rgb(79 70 229 / 6%)' },
          '.cm-activeLineGutter': { backgroundColor: '#eeedff', color: '#4f46e5' },
          '.cm-gutters': { backgroundColor: '#fbfcfe', color: '#94a3b8', borderRight: '1px solid #e7eaf0', paddingTop: '12px' },
          '&.cm-focused': { outline: 'none' },
          '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
            backgroundColor: '#b8c2ff !important',
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const nextValue = update.state.doc.toString()
            externalValueRef.current = nextValue
            onChangeRef.current(nextValue)
          }
          if (typewriterRef.current && (update.docChanged || update.selectionSet)) {
            const position = update.state.selection.main.head
            update.view.dispatch({ effects: EditorView.scrollIntoView(position, { y: 'center' }) })
          }
        }),
        EditorView.domEventHandlers({
          keydown: (event, view) => {
            if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return false
            const selection = view.state.selection.main
            const line = view.state.doc.lineAt(selection.head)
            if (!selection.empty || line.text.trim()) return false
            event.preventDefault()
            onSlashCommandRef.current?.()
            return true
          },
          scroll: (_event, view) => {
            if (suppressScrollRef.current) return
            const maxScroll = view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight
            const atEnd = maxScroll > 0 && view.scrollDOM.scrollTop >= maxScroll - 2
            const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop)
            const line = atEnd ? view.state.doc.lines : view.state.doc.lineAt(block.from).number
            onScrollRef.current(line, atEnd)
          },
        }),
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view || value === externalValueRef.current) return
    externalValueRef.current = value
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, [value])

  return <div className="editor-host" ref={hostRef} aria-label={t('Markdown source editor')} />
})
