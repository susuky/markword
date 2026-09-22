const primaryModifier = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Ctrl'

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  commands: `${primaryModifier}+K`,
  open: `${primaryModifier}+O`,
  'save-md': `${primaryModifier}+S`,
  search: `${primaryModifier}+F`,
  focus: `${primaryModifier}+Shift+F`,
  typewriter: `${primaryModifier}+Alt+T`,
  shortcuts: '?',
}

export type ShortcutMap = Record<string, string>

const punctuationKeys: Record<string, string> = {
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Equal: '=', Minus: '-',
}
const reservedCombinations = new Set([
  'A', 'C', 'X', 'V', 'Z', 'Y', 'D', 'H', 'J', 'U',
  'T', 'N', 'W', 'L', 'R', 'P', 'Q',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '=', '-', 'Shift+=',
  'Shift+Z', 'Shift+V', 'Shift+L', 'Shift+T', 'Shift+N', 'Shift+W', 'Shift+J', 'Shift+C', 'Shift+I', 'Shift+R', 'Shift+[', 'Shift+]',
])

export function shortcutFromEvent(event: KeyboardEvent): string {
  if (event.isComposing || event.keyCode === 229 || event.getModifierState('AltGraph')) return ''
  if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey) return '?'
  if (event.ctrlKey === event.metaKey) return ''
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3)
    : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5)
      : punctuationKeys[event.code] || event.key.toUpperCase()
  if (!/^[A-Z0-9.,/;'[\]\\=-]$/.test(key)) return ''
  return [event.metaKey ? 'Meta' : 'Ctrl', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+')
}

export function isReservedShortcut(shortcut: string): boolean {
  const combination = shortcut.replace(/^(Ctrl|Meta)\+/, '')
  return reservedCombinations.has(combination)
}

export function normalizeShortcuts(value: unknown): ShortcutMap {
  const result = { ...DEFAULT_SHORTCUTS }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const [id, shortcut] of Object.entries(value)) {
    if (typeof shortcut !== 'string' || id === '__proto__') continue
    if (shortcut === '' || shortcut === '?' || (/^(Ctrl|Meta)\+(Alt\+)?(Shift\+)?[A-Z0-9.,/;'[\]\\=-]$/.test(shortcut) && !isReservedShortcut(shortcut))) {
      result[id] = shortcut
    }
  }
  const used = new Set<string>()
  for (const id of Object.keys(result)) {
    if (result[id] && used.has(result[id])) result[id] = ''
    if (result[id]) used.add(result[id])
  }
  return result
}

export function formatShortcut(shortcut = ''): string {
  return shortcut.replace('Meta', 'Cmd').split('+').join(' + ')
}
