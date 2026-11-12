import { useLayoutEffect, useRef, type ReactNode } from 'react'

export function Modal({ label, onClose, className = '', children, closeOnBackdrop = true }: {
  label: string
  onClose: () => void
  className?: string
  children: ReactNode
  closeOnBackdrop?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const pressedBackdrop = useRef(false)
  useLayoutEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return <dialog ref={ref} className={`productivity-overlay ${className}`} aria-label={label} onCancel={(event) => {
    event.preventDefault()
    onClose()
  }} onPointerDown={(event) => {
    // The dialog fills the viewport; its child panels contain the visible content.
    pressedBackdrop.current = event.target === event.currentTarget
  }} onPointerUp={(event) => {
    const dismiss = closeOnBackdrop && pressedBackdrop.current && event.target === event.currentTarget
    pressedBackdrop.current = false
    if (dismiss) onClose()
  }} onPointerCancel={() => { pressedBackdrop.current = false }}>{children}</dialog>
}
