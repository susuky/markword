import { useEffect, useRef, type ReactNode } from 'react'

export function Modal({ label, onClose, className = '', children }: {
  label: string
  onClose: () => void
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return <dialog ref={ref} className={`productivity-overlay ${className}`} aria-label={label} onCancel={onClose} onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose()
  }}>{children}</dialog>
}
