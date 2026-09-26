import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { getChunks, goToNextChunk, goToPreviousChunk, unifiedMergeView } from '@codemirror/merge'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useI18n } from '../i18n'

export default function RevisionDiff({ original, current }: { original: string; current: string }) {
  const { t } = useI18n()
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!host.current) return
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: current,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({
            role: 'region', tabindex: '0',
            'aria-label': t('Changes from the selected revision to the current document'),
          }),
          lineNumbers(),
          EditorView.lineWrapping,
          unifiedMergeView({ original, mergeControls: false, syntaxHighlightDeletions: false }),
        ],
      }),
    })
    view.current = editor
    const firstChange = getChunks(editor.state)?.chunks[0]
    if (firstChange) editor.dispatch({
      selection: { anchor: Math.min(firstChange.fromB, editor.state.doc.length) },
      effects: EditorView.scrollIntoView(Math.min(firstChange.fromB, editor.state.doc.length), { y: 'center' }),
    })
    return () => { view.current = null; editor.destroy() }
  }, [original, current, t])

  return <div className="revision-diff">
    <div className="revision-diff__legend">
      <span className="revision-diff__removed">− {t('Removed')}</span>
      <span className="revision-diff__added">+ {t('Added')}</span>
      <div>
        <button type="button" aria-label={t('Previous change')} title={t('Previous change')} onClick={() => { if (view.current) goToPreviousChunk(view.current) }}><ArrowUp size={16} aria-hidden="true" /></button>
        <button type="button" aria-label={t('Next change')} title={t('Next change')} onClick={() => { if (view.current) goToNextChunk(view.current) }}><ArrowDown size={16} aria-hidden="true" /></button>
      </div>
    </div>
    <div className="revision-diff__editor" ref={host} />
  </div>
}
