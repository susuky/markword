import { useLayoutEffect, useRef, type ReactNode } from 'react'

export function Modal({ label, onClose, className = '', children, closeOnBackdrop = true }: {
  label: string
  onClose: () => void
  className?: string
  children: ReactNode
  closeOnBackdrop?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const dialog = ref.current
    const previousFocus = document.activeElement
    dialog?.showModal()
    return () => {
      dialog?.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  return <dialog ref={ref} className={`productivity-overlay ${className}`} aria-label={label} onCancel={onClose} onMouseDown={(event) => {
    if (closeOnBackdrop && event.target === event.currentTarget) onClose()
  }} onKeyDown={(event) => {
    if (event.key !== 'Tab') return
    const fields = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex]')).filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length)
    const target = event.shiftKey ? fields.at(-1) : fields[0]
    if (fields.length && document.activeElement === (event.shiftKey ? fields[0] : fields.at(-1))) {
      event.preventDefault(); target?.focus()
    }
  }}>{children}</dialog>
}
