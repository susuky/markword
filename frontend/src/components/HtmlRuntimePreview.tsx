import { useLayoutEffect, useMemo, useRef } from 'react'
import { createHtmlRuntimeDocument, subscribeHtmlRuntime, type HtmlRenderSnapshot } from '../htmlRuntime'

export function HtmlRuntimePreview({ value, title, onSnapshot, onError }: {
  value: string
  title: string
  onSnapshot: (snapshot: HtmlRenderSnapshot) => void
  onError: (message: string) => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const callbacks = useRef({ onSnapshot, onError })
  callbacks.current = { onSnapshot, onError }
  const srcDoc = useMemo(() => createHtmlRuntimeDocument(value), [value])
  useLayoutEffect(() => {
    if (!frameRef.current) return
    return subscribeHtmlRuntime(frameRef.current, snapshot => callbacks.current.onSnapshot(snapshot), message => callbacks.current.onError(message))
  }, [srcDoc])
  return <iframe ref={frameRef} title={title} className="html-preview-frame" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={srcDoc} />
}
