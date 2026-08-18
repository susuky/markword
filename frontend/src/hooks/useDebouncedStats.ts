import { useEffect, useState } from 'react'
import { analyzeText } from '../api'
import { analyzeTextLocally } from '../localStats'
import { EMPTY_STATS, type TextStats } from '../types'

export function useDebouncedStats(text: string) {
  const [stats, setStats] = useState<TextStats>(EMPTY_STATS)
  const [available, setAvailable] = useState(true)

  useEffect(() => {
    if (!text) {
      setStats(EMPTY_STATS)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
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
