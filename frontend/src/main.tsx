import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Workspace from './Workspace'
import { I18nProvider } from './i18n'
import './persistence.css'
import './styles.css'

const baseUrl = import.meta.env.BASE_URL

if (!document.querySelector('link[rel="manifest"]')) {
  const manifest = document.createElement('link')
  manifest.rel = 'manifest'
  manifest.href = `${baseUrl}manifest.webmanifest`
  document.head.append(manifest)
}

const isProduction = (import.meta as ImportMeta & { env?: { PROD?: boolean } }).env?.PROD === true

if (isProduction && 'serviceWorker' in navigator) {
  const hadServiceWorkerController = navigator.serviceWorker.controller !== null

  if (hadServiceWorkerController) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.dispatchEvent(new Event('markword:update-available'))
    })
  }

  window.addEventListener('load', () => {
    const buildId = import.meta.env.VITE_BUILD_ID?.trim() || 'local'
    const serviceWorkerUrl = new URL(`${baseUrl}sw.js`, window.location.origin)
    serviceWorkerUrl.searchParams.set('build', buildId)

    void navigator.serviceWorker
      .register(serviceWorkerUrl.toString(), {
        scope: baseUrl,
        updateViaCache: 'none',
      })
      .then((registration) => {
        registration.active?.postMessage({ type: 'MARKWORD_CLEAN_STALE_CACHES' })
      })
      .catch(() => undefined)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <Workspace />
    </I18nProvider>
  </StrictMode>,
)
