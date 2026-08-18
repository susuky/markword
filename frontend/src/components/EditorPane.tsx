import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

export interface EditorHandle {
  scrollToLine: (line: number) => void
}

interface EditorPaneProps {
  value: string
  onChange: (value: string) => void
  onScrollLine: (line: number, atEnd: boolean) => void
}

export const EditorPane = forwardRef<EditorHandle, EditorPaneProps>(function EditorPane(
  { value, onChange, onScrollLine },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const externalValueRef = useRef(value)
  const suppressScrollRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const onScrollRef = useRef(onScrollLine)
  onChangeRef.current = onChange
  onScrollRef.current = onScrollLine

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
          '.cm-activeLine': { backgroundColor: '#f0efff' },
          '.cm-activeLineGutter': { backgroundColor: '#eeedff', color: '#4f46e5' },
          '.cm-gutters': { backgroundColor: '#fbfcfe', color: '#94a3b8', borderRight: '1px solid #e7eaf0', paddingTop: '12px' },
          '&.cm-focused': { outline: 'none' },
          '.cm-selectionBackground, ::selection': { backgroundColor: '#dddafe !important' },
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          const nextValue = update.state.doc.toString()
          externalValueRef.current = nextValue
          onChangeRef.current(nextValue)
        }),
        EditorView.domEventHandlers({
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

  return <div className="editor-host" ref={hostRef} aria-label="Markdown 原始碼編輯器" />
})
