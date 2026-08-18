import { X } from 'lucide-react'

interface ShortcutHelpProps {
  open: boolean
  onClose: () => void
}
const SHORTCUTS = [
  ['Cmd / Ctrl + K', '開啟命令選單'],
  ['Cmd / Ctrl + F', '搜尋文件'],
  ['Cmd / Ctrl + S', '下載 Markdown'],
  ['Cmd / Ctrl + Shift + F', '切換專注模式'],
  ['Cmd / Ctrl + Alt + T', '切換打字機模式'],
  ['Cmd / Ctrl + Shift + [', '收合目前區塊'],
  ['Cmd / Ctrl + Shift + ]', '展開目前區塊'],
  ['?', '顯示快捷鍵說明'],
  ['Esc', '關閉面板／離開專注模式'],
]

export function ShortcutHelp({ open, onClose }: ShortcutHelpProps) {
  if (!open) return null
  return (
    <div className="productivity-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="shortcut-help" role="dialog" aria-modal="true" aria-labelledby="shortcut-title">
        <header><div><h2 id="shortcut-title">鍵盤快捷鍵</h2><p>在編輯器中保留 CodeMirror 的標準操作。</p></div><button type="button" onClick={onClose} aria-label="關閉快捷鍵說明"><X size={18} /></button></header>
        <dl>{SHORTCUTS.map(([keys, action]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{action}</dd></div>)}</dl>
      </section>
    </div>
  )
}
