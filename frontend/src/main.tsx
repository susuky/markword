import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
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
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${baseUrl}sw.js`, {
      scope: baseUrl,
      updateViaCache: 'none',
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
