import { useEffect, useState } from 'react'
import { analyzeText } from '../api'
import { IS_STATIC_DEPLOYMENT } from '../deployment'
import { analyzeTextLocally } from '../localStats'
import { EMPTY_STATS, type TextStats } from '../types'

export function useDebouncedStats(text: string) {
  const [stats, setStats] = useState<TextStats>(EMPTY_STATS)
  const [available, setAvailable] = useState(!IS_STATIC_DEPLOYMENT)

  useEffect(() => {
    if (!text) {
      setStats(EMPTY_STATS)
      setAvailable(!IS_STATIC_DEPLOYMENT)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      if (IS_STATIC_DEPLOYMENT) {
        setStats(analyzeTextLocally(text))
        setAvailable(false)
        return
      }
      analyzeText(text, controller.signal)
        .then((result) => {
          setStats(result)
          setAvailable(true)
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setStats(analyzeTextLocally(text))
          setAvailable(false)
        })
    }, 220)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [text])

  return { stats, available }
}
