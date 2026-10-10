import { useCallback, useEffect, useRef, useState } from 'react'
import { DraftConflictError, loadCurrentDraft, saveCurrentDraft, type PersistenceStatus } from '../storage'

export function useHtmlDraft(initialContent: string) {
  const [draft, setDraft] = useState({ content: initialContent, filename: 'page.html' })
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState<PersistenceStatus>('idle')
  const current = useRef(draft)
  const saved = useRef<typeof draft | null>(null)
  const version = useRef<number | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const initialized = useRef(false)
  const initial = useRef(initialContent)
  current.current = draft

  const flush = useCallback(() => {
    const next = current.current
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (!initialized.current || next === saved.current) return
      try {
        const result = await saveCurrentDraft(next.content, { filename: next.filename }, version.current, 'html')
        version.current = result.version ?? 0
        saved.current = next
        if (current.current === next) setStatus('saved')
      } catch (error) {
        setStatus(error instanceof DraftConflictError ? 'conflict' : 'error')
        throw error
      }
    })
    return queue.current
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadCurrentDraft(initial.current, { filename: 'page.html' }, 'html').then((stored) => {
      if (cancelled) return
      const next = { content: stored.content, filename: typeof stored.metadata.filename === 'string' ? stored.metadata.filename : 'page.html' }
      version.current = stored.version ?? 0
      current.current = next
      saved.current = next
      initialized.current = true
      setDraft(next)
      setStatus('saved')
      setReady(true)
    }).catch(() => { if (!cancelled) { initialized.current = true; setStatus('error'); setReady(true) } })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!ready || draft === saved.current) return
    const timer = window.setTimeout(() => { void flush().catch(() => {}) }, 300)
    return () => window.clearTimeout(timer)
  }, [draft, flush, ready])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (initialized.current && current.current !== saved.current) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      void flush().catch(() => {})
    }
  }, [flush])

  const update = useCallback((next: typeof draft) => {
    current.current = next
    setDraft(next)
    setStatus('saving')
  }, [])

  return { draft, ready, status, update, flush }
}
