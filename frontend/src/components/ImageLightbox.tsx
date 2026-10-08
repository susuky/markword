import { Download, Minus, Plus, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'

export interface LightboxMedia {
  src: string
  label: string
  filename: string
  width: number
  height: number
  background?: string
}

interface ImageLightboxProps {
  media: LightboxMedia
  onClose: () => void
}

interface MediaSize {
  width: number
  height: number
}

interface ZoomAnchor {
  clientX: number
  clientY: number
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 5
const ZOOM_STEP = 0.25

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

export function ImageLightbox({ media, onClose }: ImageLightboxProps) {
  const { t } = useI18n()
  const lightboxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const dragRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null)
  const zoomRef = useRef(1)
  const [zoom, setZoom] = useState(1)
  const [mediaSize, setMediaSize] = useState<MediaSize>({ width: 1, height: 1 })

  const fitMedia = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const style = window.getComputedStyle(canvas)
    const horizontalPadding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
    const verticalPadding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
    const availableWidth = Math.max(1, canvas.clientWidth - horizontalPadding)
    const availableHeight = Math.max(1, canvas.clientHeight - verticalPadding)
    const sourceWidth = Math.max(1, media.width)
    const sourceHeight = Math.max(1, media.height)
    const fitScale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight, 1)
    setMediaSize({ width: sourceWidth * fitScale, height: sourceHeight * fitScale })
  }, [media.height, media.width])

  useLayoutEffect(() => {
    fitMedia()
    const canvas = canvasRef.current
    if (!canvas) return
    const resizeObserver = new ResizeObserver(fitMedia)
    resizeObserver.observe(canvas)
    return () => resizeObserver.disconnect()
  }, [fitMedia])

  const changeZoom = useCallback((amount: number, anchor?: ZoomAnchor) => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    const previousZoom = zoomRef.current
    const nextZoom = clampZoom(previousZoom + amount)
    if (nextZoom === previousZoom) return

    const canvasRect = canvas?.getBoundingClientRect()
    const stageRect = stage?.getBoundingClientRect()
    const anchorX = anchor?.clientX ?? (canvas && canvasRect ? canvasRect.left + canvas.clientWidth / 2 : 0)
    const anchorY = anchor?.clientY ?? (canvas && canvasRect ? canvasRect.top + canvas.clientHeight / 2 : 0)
    const ratioX = stageRect?.width ? Math.min(1, Math.max(0, (anchorX - stageRect.left) / stageRect.width)) : 0.5
    const ratioY = stageRect?.height ? Math.min(1, Math.max(0, (anchorY - stageRect.top) / stageRect.height)) : 0.5
    zoomRef.current = nextZoom
    setZoom(nextZoom)

    if (canvas && stage) {
      window.requestAnimationFrame(() => {
        const nextStageRect = stage.getBoundingClientRect()
        canvas.scrollLeft += nextStageRect.left + ratioX * nextStageRect.width - anchorX
        canvas.scrollTop += nextStageRect.top + ratioY * nextStageRect.height - anchorY
      })
    }
  }, [])

  const resetZoom = useCallback(() => {
    zoomRef.current = 1
    setZoom(1)
    window.requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.scrollTo({ left: 0, top: 0 })
    })
  }, [])

  useEffect(() => {
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const appShell = document.querySelector<HTMLElement>('.app-shell')
    const appWasInert = appShell?.hasAttribute('inert') ?? false
    const previousBodyOverflow = document.body.style.overflow
    appShell?.setAttribute('inert', '')
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    return () => {
      if (!appWasInert) appShell?.removeAttribute('inert')
      document.body.style.overflow = previousBodyOverflow
      activeElement?.focus()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        changeZoom(ZOOM_STEP)
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        changeZoom(-ZOOM_STEP)
      } else if (event.key === '0') {
        event.preventDefault()
        resetZoom()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [changeZoom, onClose, resetZoom])

  useEffect(() => {
    const lightbox = lightboxRef.current
    if (!lightbox) return
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.deltaY === 0) return
      changeZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP, {
        clientX: event.clientX,
        clientY: event.clientY,
      })
    }
    lightbox.addEventListener('wheel', handleWheel, { passive: false })
    return () => lightbox.removeEventListener('wheel', handleWheel)
  }, [changeZoom])

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage || event.button !== 0 || zoom <= 1 || event.target === canvas) return
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: canvas.scrollLeft,
      top: canvas.scrollTop,
    }
    stage.setPointerCapture(event.pointerId)
    canvas.classList.add('is-dragging')
    event.preventDefault()
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current
    const drag = dragRef.current
    if (!canvas || !drag || drag.pointerId !== event.pointerId) return
    canvas.scrollLeft = drag.left - (event.clientX - drag.x)
    canvas.scrollTop = drag.top - (event.clientY - drag.y)
  }

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage || dragRef.current?.pointerId !== event.pointerId) return
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId)
    dragRef.current = null
    canvas.classList.remove('is-dragging')
  }

  const downloadMedia = () => {
    const anchor = document.createElement('a')
    anchor.href = media.src
    anchor.download = media.filename
    anchor.rel = 'noopener'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  }

  const stageWidth = mediaSize.width * zoom
  const stageHeight = mediaSize.height * zoom

  return createPortal(
    <div ref={lightboxRef} className="image-lightbox" role="dialog" aria-modal="true" aria-label={t('Image preview')}>
      <button
        ref={closeButtonRef}
        className="image-lightbox__close"
        type="button"
        aria-label={t('Close image preview')}
        title={t('Close image preview')}
        onClick={onClose}
      >
        <X size={22} />
      </button>

      <div
        ref={canvasRef}
        className={`image-lightbox__canvas ${zoom > 1 ? 'can-pan' : ''}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <div
          ref={stageRef}
          className="image-lightbox__stage"
          style={{ width: `${stageWidth}px`, height: `${stageHeight}px`, background: media.background }}
        >
          <img
            className="image-lightbox__media"
            src={media.src}
            alt={media.label}
            draggable={false}
            style={{ width: `${mediaSize.width}px`, height: `${mediaSize.height}px`, transform: `scale(${zoom})` }}
          />
        </div>
      </div>

      <div className="image-lightbox__toolbar" role="toolbar" aria-label={t('Image controls')}>
        <button
          type="button"
          disabled={zoom <= MIN_ZOOM}
          aria-label={t('Zoom out')}
          title={t('Zoom out')}
          onClick={() => changeZoom(-ZOOM_STEP)}
        >
          <Minus size={19} />
        </button>
        <button className="image-lightbox__zoom" type="button" aria-label={t('Reset zoom')} title={t('Reset zoom')} onClick={resetZoom}>
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          disabled={zoom >= MAX_ZOOM}
          aria-label={t('Zoom in')}
          title={t('Zoom in')}
          onClick={() => changeZoom(ZOOM_STEP)}
        >
          <Plus size={19} />
        </button>
        <span className="image-lightbox__separator" aria-hidden="true" />
        <button type="button" aria-label={t('Download image')} title={t('Download image')} onClick={downloadMedia}>
          <Download size={19} />
        </button>
      </div>
    </div>,
    document.body,
  )
}
