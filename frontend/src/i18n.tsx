import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Locale = 'en' | 'zh-TW'
type Variables = Record<string, string | number>

const LOCALE_KEY = 'markword.preference.locale'

const ZH_TW: Record<string, string> = {
  'Markword': '文字工具箱',
  'A Markdown editor with live preview, Mermaid, word count, and document export.': '支援 Mermaid、字數統計與文件匯出的 Markdown 編輯器。',
  'Open': '開啟',
  'Open Markdown': '開啟 Markdown',
  'Open a local .md file': '從本機開啟 .md 檔',
  'Please choose a .md or .markdown file': '請選擇 .md 或 .markdown 檔案',
  'This file is larger than 5 MB. Please choose a smaller file.': '檔案超過 5 MB，請先縮小後再開啟',
  'Opened {file}': '已開啟 {file}',
  'Download Markdown': '下載 Markdown',
  'Keep the editable source': '保留可繼續編輯的原始碼',
  'Markdown downloaded': 'Markdown 已下載',
  'Download portable HTML': '下載可攜 HTML',
  'Portable HTML': '可攜 HTML',
  'Embedded styles for offline reading': '內嵌樣式，可離線閱讀',
  'Portable HTML downloaded': '可攜 HTML 已下載',
  'Search document': '搜尋文件',
  'Insert: Heading 2': '插入：二級標題',
  '## Heading': '## 標題',
  'Insert: Table': '插入：表格',
  'Three-column Markdown table': '三欄 Markdown 表格',
  'Insert: Code block': '插入：程式碼區塊',
  'Fenced code block': '程式碼圍欄區塊',
  'Insert: Mermaid diagram': '插入：Mermaid 圖表',
  'Basic flowchart': '基本流程圖',
  'Start': '開始',
  'Done': '完成',
  'Enter focus mode': '進入專注模式',
  'Exit focus mode': '離開專注模式',
  'Enable typewriter mode': '開啟打字機模式',
  'Disable typewriter mode': '關閉打字機模式',
  'Enable synchronized scrolling': '開啟同步捲動',
  'Disable synchronized scrolling': '關閉同步捲動',
  'Fold all sections': '收合所有區塊',
  'Unfold all sections': '展開所有區塊',
  'Create current revision': '建立目前版本',
  'Save to local revision history': '保存到本機版本歷史',
  'Open revision history': '開啟版本歷史',
  'Preview, download, or restore an older revision': '預覽、下載或還原舊版本',
  'Show keyboard shortcuts': '顯示快捷鍵',
  'Loading local draft…': '正在載入本機草稿…',
  'Document tools': '文件工具',
  'Word count': '字數統計',
  'Preview theme: {theme}': '預覽主題：{theme}',
  'Preview theme': '預覽主題',
  'Also applied to exported documents': '同時套用到匯出文件',
  'Synchronized scrolling on': '同步開',
  'Synchronized scrolling off': '同步關',
  'Toggle synchronized scrolling': '切換同步捲動',
  'Commands': '命令',
  'Command palette': '命令選單',
  'Keyboard shortcuts': '鍵盤快捷鍵',
  'Switch to Traditional Chinese': '切換成繁體中文',
  'Switch to English': '切換成英文',
  'Traditional Chinese': '繁中',
  'Export': '匯出',
  '{format} export in progress': '{format} 匯出中',
  '{format} export in progress…': '{format} 匯出中…',
  'Download and export': '下載與匯出',
  'Choose a layout, then select an output format': '選擇版型，再輸出需要的格式',
  'Document layout': '成品版型',
  'Source and web': '原始與網頁',
  'Uses the {style} layout and current theme': '套用「{style}」版型與目前主題',
  'Document formats': '文件格式',
  'Uses the {style} print layout': '套用「{style}」列印版型',
  'Uses the current palette and remains editable': '套用配色，可繼續編輯排版',
  'Unavailable on GitHub Pages; use the full server edition': 'GitHub Pages 版不提供，請使用完整伺服器版',
  '{format} download started': '{format} 已開始下載',
  'Export failed. Please try again.': '匯出失敗，請稍後再試',
  'Current revision created': '已建立目前版本',
  'Could not create revision': '建立版本失敗',
  'Revision history': '版本記錄',
  'Editor and preview': '編輯與預覽',
  'Editor': '編輯',
  'Preview': '預覽',
  'Markdown source': 'Markdown 原始碼',
  'Search': '搜尋',
  'Typewriter mode': '打字機模式',
  'Autosave': '自動儲存',
  'Resize editor and preview': '調整編輯器與預覽寬度',
  'Live preview': '即時預覽',
  '{theme} theme': '{theme}主題',
  'Drop to open Markdown': '放開以開啟 Markdown',
  'Supports .md and .markdown, up to 5 MB': '支援 .md 與 .markdown，最大 5 MB',
  'Characters {count}': '字數 {count}',
  'Lines {count}': '行數 {count}',
  'Outline': '大綱',
  'Focus': '專注',
  'Saving': '儲存中',
  'Draft not saved': '草稿未儲存',
  'Draft saved': '草稿已儲存',
  'GitHub Pages · local statistics': 'GitHub Pages・本機統計',
  'Local statistics': '本機統計',
  'Line {line} / {total}': '第 {line} 行 / {total}',
  'Esc to exit focus': 'Esc 離開專注',
  'Search commands or type “insert”…': '搜尋命令或輸入「插入」…',
  'Search commands': '搜尋命令',
  'Close command palette': '關閉命令選單',
  'No matching commands': '找不到符合的命令',
  'Select': '選擇',
  'Run': '執行',
  'Close': '關閉',
  'Document outline': '文件大綱',
  'Expand document outline': '展開文件大綱',
  'Collapse document outline': '收合文件大綱',
  'Line {line}: {heading}': '第 {line} 行：{heading}',
  'Add headings to see them here.': '加入標題後會顯示在這裡。',
  'Copied': '已複製',
  'Copy': '複製',
  'Start writing Markdown': '開始撰寫 Markdown',
  'Content entered on the left appears here instantly.': '左側輸入的內容會即時顯示在這裡。',
  'Keep CodeMirror’s standard shortcuts available in the editor.': '在編輯器中保留 CodeMirror 的標準操作。',
  'Close keyboard shortcuts': '關閉快捷鍵說明',
  'Open command palette': '開啟命令選單',
  'Toggle focus mode': '切換專注模式',
  'Toggle typewriter mode': '切換打字機模式',
  'Fold current section': '收合目前區塊',
  'Unfold current section': '展開目前區塊',
  'Close panel / exit focus mode': '關閉面板／離開專注模式',
  'Total characters (with spaces)': '總字數（含空白）',
  'Total characters (without spaces)': '總字數（不含空白）',
  'Chinese characters': '中文字數',
  'Full-width punctuation': '全形標點',
  'English words': '英文單字',
  'Digits': '數字',
  'Lines': '行數',
  'Calculated locally in your browser': '由瀏覽器本機即時計算',
  'Calculated live from this document': '依目前文件即時計算',
  'Waiting for the backend service': '正在等待後端服務',
  'Close word count': '關閉字數統計',
  'Clear document': '清除文件',
  'Auto revision': '自動版本',
  'Manual revision': '手動版本',
  'Pre-restore backup': '還原前備份',
  'Could not read revisions': '無法讀取版本',
  'Restored; the previous content was backed up first': '已還原；原內容已先建立備份版本',
  'Could not restore revision': '還原版本失敗',
  'Delete this revision? This action cannot be undone.': '確定刪除這個版本？此操作無法復原。',
  'Revision deleted': '版本已刪除',
  'Could not delete revision': '刪除版本失敗',
  'Keep up to 120 local revisions': '最多保留 120 個本機版本',
  'Close revision history': '關閉版本歷史',
  '{count} revisions': '{count} 個版本',
  'Saved revisions': '已儲存版本',
  '{reason} · {count} characters': '{reason} · {count} 字元',
  'No revisions yet. One is created automatically every five minutes after changes.': '尚無版本。內容變更後每五分鐘會自動建立。',
  'Revision preview': '版本預覽',
  '(Empty document)': '（空白文件）',
  'Delete': '刪除',
  'Restore this revision': '還原此版本',
  'Select a revision to preview it': '選擇版本即可預覽',
  'Markdown source editor': 'Markdown 原始碼編輯器',
  'Completed': '已完成',
  'Not completed': '未完成',
  'Drawing diagram…': '正在繪製圖表…',
  'Copy code': '複製程式碼',
  'Back to footnote reference': '回到註腳引用',
  'This browser does not support IndexedDB': '此瀏覽器不支援 IndexedDB',
  'Could not open local storage': '無法開啟 IndexedDB',
  'Close other Markword tabs before upgrading local storage': '請關閉其他 Markword 分頁後重試資料庫升級',
  'Revision not found': '找不到指定版本',
  'Automatic revision failed': '自動建立版本失敗',
  'Save failed': '儲存失敗',
  'The server could not process the request': '伺服器暫時無法處理要求',
  'Light': '明亮',
  'Clear and neutral for everyday reading': '清晰中性的日常閱讀',
  'Paper': '紙張',
  'Warm and soft for long-form writing': '溫暖柔和的長文寫作',
  'Sage': '鼠尾草',
  'A calm natural green': '低刺激的自然綠色',
  'Dark': '深色',
  'Balanced contrast for night reading': '平衡對比的夜間閱讀',
  'Ocean': '深海',
  'A quiet blue-green workspace': '沉靜的藍綠工作環境',
  'Cool and restrained polar colors': '冷調、克制的極地配色',
  'A vivid purple-pink developer palette': '鮮明紫紅的程式風格',
  'Midnight': '午夜',
  'Deep black and indigo for focus': '深黑與靛紫的專注模式',
  'Classic': '經典',
  'Balanced for general documents': '均衡，適合一般文件',
  'Editorial': '編輯排版',
  'Generous spacing with serif body text': '寬鬆留白與襯線正文',
  'Report': '報告',
  'Compact tables and clear sections': '緊湊表格與清楚章節',
  'Compact': '精簡',
  'High information density and fewer pages': '高資訊密度、節省頁數',
}

let activeLocale: Locale = 'en'

function detectLocale(): Locale {
  const saved = localStorage.getItem(LOCALE_KEY)
  if (saved === 'en' || saved === 'zh-TW') return saved
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-TW' : 'en'
}

function interpolate(template: string, variables: Variables = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(variables[name] ?? `{${name}}`))
}

// Shared with non-React modules that render localized runtime messages.
// eslint-disable-next-line react-refresh/only-export-components
export function translate(key: string, variables?: Variables, locale = activeLocale): string {
  return interpolate(locale === 'zh-TW' ? (ZH_TW[key] ?? key) : key, variables)
}

interface I18nValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, variables?: Variables) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(detectLocale)
  activeLocale = locale
  const t = useCallback((key: string, variables?: Variables) => translate(key, variables, locale), [locale])

  useEffect(() => {
    activeLocale = locale
    localStorage.setItem(LOCALE_KEY, locale)
    document.documentElement.lang = locale === 'zh-TW' ? 'zh-Hant' : 'en'
    document.title = t('Markword')
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute('content', t('A Markdown editor with live preview, Mermaid, word count, and document export.'))
  }, [locale, t])

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside I18nProvider')
  return value
}
