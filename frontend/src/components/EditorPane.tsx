import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { indentWithTab, insertNewline, insertNewlineKeepIndent, isolateHistory } from '@codemirror/commands'
import { foldAll, indentUnit, unfoldAll } from '@codemirror/language'
import { openSearchPanel } from '@codemirror/search'
import { Compartment, EditorSelection, EditorState, Prec, Transaction } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { continueMarkdownLine, removeMarkdownMarker, renumberAfterDeletion } from '../editorCommands'
import type { DocumentMode } from '../types'
import { tableAtPosition, tableMarkdown, type TableEdit } from '../tableEditing'
import { TableEditor } from './TableEditor'

function modeExtensions(mode: DocumentMode) {
  return mode === 'markdown' ? [
    markdown({ base: markdownLanguage, addKeymap: false }),
    renumberAfterDeletion,
    indentUnit.of('    '),
    Prec.high(keymap.of([
      { key: 'Enter', run: continueMarkdownLine },
      { key: 'Enter', run: insertNewlineKeepIndent },
      { key: 'Shift-Enter', run: insertNewline },
      { key: 'Backspace', run: removeMarkdownMarker },
      indentWithTab,
    ])),
  ] : Prec.high(keymap.of([
    { key: 'Enter', run: mode === 'text' ? insertNewline : insertNewlineKeepIndent },
    { key: 'Shift-Enter', run: insertNewline },
    ...(mode === 'mermaid' ? [indentWithTab] : []),
  ]))
}

export interface EditorHandle {
  scrollToLine: (line: number) => void
  jumpToLine: (line: number) => void
  focus: () => void
  search: () => void
  insert: (text: string, cursorOffset?: number) => void
  foldAll: () => void
  unfoldAll: () => void
  editTable: (line?: number) => void
}

interface EditorPaneProps {
  mode: DocumentMode
  value: string
  onChange: (value: string) => void
  onScrollLine: (line: number, atEnd: boolean) => void
  typewriter?: boolean
  onSlashCommand?: () => void
  onPasteFiles?: (files: File[]) => void
}

export const EditorPane = forwardRef<EditorHandle, EditorPaneProps>(function EditorPane(
  { value, mode, onChange, onScrollLine, typewriter = false, onSlashCommand, onPasteFiles },
  ref,
) {
  const { t } = useI18n()
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const languageRef = useRef(new Compartment())
  const modeRef = useRef(mode)
  modeRef.current = mode
  const externalValueRef = useRef(value)
  const suppressScrollRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const onScrollRef = useRef(onScrollLine)
  const typewriterRef = useRef(typewriter)
  const onSlashCommandRef = useRef(onSlashCommand)
  const onPasteFilesRef = useRef(onPasteFiles)
  const [tableEdit, setTableEdit] = useState<TableEdit | null>(null)
  const [tableError, setTableError] = useState('')
  onChangeRef.current = onChange
  onScrollRef.current = onScrollLine
  typewriterRef.current = typewriter
  onSlashCommandRef.current = onSlashCommand
  onPasteFilesRef.current = onPasteFiles

  const editTable = useCallback((line?: number) => {
    const view = viewRef.current
    if (!view || modeRef.current !== 'markdown') return
    try {
      const position = line === undefined ? view.state.selection.main.head : view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines))).from
      const table = tableAtPosition(view.state, position)
      // A deferred preview may refer to a table that has just been removed.
      if (line !== undefined && !table) return
      setTableError('')
      setTableEdit(table ?? {
        from: view.state.selection.main.from,
        to: view.state.selection.main.to,
        source: view.state.doc.toString(),
        prefix: '', continuation: '', existing: false,
        data: { rows: [Array.from({ length: 3 }, (_, index) => t('Column {number}', { number: index + 1 })), ['', '', '']], alignments: ['', '', ''] },
      })
    } catch (error) {
      setTableError(t(error instanceof Error ? error.message : 'Could not open the table editor.'))
    }
  }, [t])

  useImperativeHandle(ref, () => ({
    editTable,
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
  }), [editTable])

  useEffect(() => {
    if (!hostRef.current) return
    const state = EditorState.create({
      doc: externalValueRef.current,
      extensions: [
        basicSetup,
        languageRef.current.of(modeExtensions(modeRef.current)),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { height: '100%', fontSize: '15px' },
          '.cm-scroller': {
            fontFamily: '"JetBrains Mono", "Noto Sans Mono CJK TC", ui-monospace, monospace',
            lineHeight: '1.72',
          },
          '.cm-content': { padding: '28px 0 60px' },
          '.cm-line': { padding: '0 18px 0 12px' },
          '.cm-activeLine': { backgroundColor: 'rgb(22 116 105 / 5%)' },
          '.cm-activeLineGutter': { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' },
          '.cm-gutters': { backgroundColor: 'var(--surface)', color: '#76877e', borderRight: 'none' },
          '&.cm-focused': { outline: 'none' },
          '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
            backgroundColor: '#c2e3d7 !important',
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
          paste: (event) => {
            const files = Array.from(event.clipboardData?.files ?? [])
            if (!files.length) return false
            event.preventDefault()
            onPasteFilesRef.current?.(files)
            return true
          },
          keydown: (event, view) => {
            if (modeRef.current !== 'markdown' || event.isComposing || event.keyCode === 229) return false
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
    viewRef.current?.dispatch({ effects: languageRef.current.reconfigure(modeExtensions(mode)) })
  }, [mode])

  useEffect(() => {
    viewRef.current?.contentDOM.setAttribute('aria-label', t('Source editor'))
  }, [t])

  useEffect(() => {
    const view = viewRef.current
    if (!view || value === externalValueRef.current) return
    externalValueRef.current = value
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, [value])

  return <>
    {tableError ? <p className="table-editor__error" role="alert">{tableError}</p> : null}
    <div className="editor-host" ref={hostRef} aria-label={t('Source editor')} />
    {tableEdit ? <TableEditor initial={tableEdit.data} existing={tableEdit.existing} onClose={() => setTableEdit(null)} onApply={(data) => {
      const view = viewRef.current
      if (!view || view.state.doc.toString() !== tableEdit.source) return false
      let insert = tableMarkdown(data, tableEdit.prefix, tableEdit.continuation)
      if (!tableEdit.existing) {
        const before = tableEdit.source.slice(0, tableEdit.from)
        const after = tableEdit.source.slice(tableEdit.to)
        insert = (before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '') + insert
          + (after ? (after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n') : '\n')
      }
      view.dispatch({
        changes: { from: tableEdit.from, to: tableEdit.to, insert },
        selection: EditorSelection.cursor(tableEdit.from + insert.length),
        scrollIntoView: true,
        annotations: [Transaction.userEvent.of('input.table'), isolateHistory.of('full')],
      })
      setTableEdit(null)
      requestAnimationFrame(() => view.focus())
      return true
    }} /> : null}
  </>
})
