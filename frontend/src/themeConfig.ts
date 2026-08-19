import type { ExportStyleName, ThemeName } from './types'

export interface ThemeMeta {
  label: string
  description: string
  background: string
  text: string
  muted: string
  border: string
  code: string
  accent: string
  dark: boolean
  mermaid: 'default' | 'dark' | 'forest' | 'neutral'
}

export const THEMES: ThemeName[] = ['Light', 'Paper', 'Sage', 'Dark', 'Ocean', 'Nord', 'Dracula', 'Midnight']

export const THEME_META: Record<ThemeName, ThemeMeta> = {
  Light: {
    label: 'Light', description: 'Clear and neutral for everyday reading', background: '#ffffff', text: '#202b3c', muted: '#64748b',
    border: '#dfe5ee', code: '#f5f7fb', accent: '#554ee8', dark: false, mermaid: 'default',
  },
  Paper: {
    label: 'Paper', description: 'Warm and soft for long-form writing', background: '#fbf7ef', text: '#3d352e', muted: '#786b60',
    border: '#ddd2c2', code: '#f2eadf', accent: '#a24d2f', dark: false, mermaid: 'neutral',
  },
  Sage: {
    label: 'Sage', description: 'A calm natural green', background: '#f4f7f2', text: '#26362d', muted: '#637269',
    border: '#d3ded4', code: '#e8efe8', accent: '#35735a', dark: false, mermaid: 'forest',
  },
  Dark: {
    label: 'Dark', description: 'Balanced contrast for night reading', background: '#111827', text: '#e5eaf2', muted: '#9aa7ba',
    border: '#344155', code: '#1c2637', accent: '#45b8e8', dark: true, mermaid: 'dark',
  },
  Ocean: {
    label: 'Ocean', description: 'A quiet blue-green workspace', background: '#082f36', text: '#d9f1ef', muted: '#91b8b7',
    border: '#23535a', code: '#103e46', accent: '#55d6c2', dark: true, mermaid: 'dark',
  },
  Nord: {
    label: 'Nord', description: 'Cool and restrained polar colors', background: '#2e3440', text: '#e5e9f0', muted: '#b7c0cf',
    border: '#4c566a', code: '#3b4252', accent: '#88c0d0', dark: true, mermaid: 'dark',
  },
  Dracula: {
    label: 'Dracula', description: 'A vivid purple-pink developer palette', background: '#282a36', text: '#f8f8f2', muted: '#c4c5bf',
    border: '#4f5268', code: '#343746', accent: '#bd93f9', dark: true, mermaid: 'dark',
  },
  Midnight: {
    label: 'Midnight', description: 'Deep black and indigo for focus', background: '#111018', text: '#eeeaf7', muted: '#aaa2bb',
    border: '#373241', code: '#1d1a27', accent: '#9d8cff', dark: true, mermaid: 'dark',
  },
}

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && THEMES.includes(value as ThemeName)
}

export function mermaidThemeVariables(theme: ThemeName) {
  const meta = THEME_META[theme]
  return {
    darkMode: meta.dark,
    background: meta.background,
    primaryColor: meta.code,
    primaryTextColor: meta.text,
    primaryBorderColor: meta.accent,
    secondaryColor: meta.background,
    secondaryTextColor: meta.text,
    secondaryBorderColor: meta.border,
    tertiaryColor: meta.code,
    tertiaryTextColor: meta.text,
    tertiaryBorderColor: meta.border,
    lineColor: meta.muted,
    textColor: meta.text,
    mainBkg: meta.code,
    nodeBorder: meta.accent,
    clusterBkg: meta.background,
    clusterBorder: meta.border,
    edgeLabelBackground: meta.code,
    noteBkgColor: meta.code,
    noteTextColor: meta.text,
    noteBorderColor: meta.accent,
    actorBkg: meta.code,
    actorBorder: meta.accent,
    actorTextColor: meta.text,
    signalColor: meta.muted,
    signalTextColor: meta.text,
    fontFamily: '"Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif',
    fontSize: '14px',
  }
}

export const EXPORT_STYLES: Record<ExportStyleName, { label: string; description: string; css: string }> = {
  Classic: { label: 'Classic', description: 'Balanced for general documents', css: '.document{max-width:880px;font-size:16px;line-height:1.78}h1{font-size:2.25rem}h2{font-size:1.55rem}' },
  Editorial: { label: 'Editorial', description: 'Generous spacing with serif body text', css: '.document{max-width:760px;font-family:"Noto Serif TC","Noto Serif CJK TC","Songti TC",serif;font-size:17px;line-height:1.95}h1,h2,h3{font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif;letter-spacing:.02em}h1{font-size:2.5rem;margin-bottom:1.2em;border-bottom-width:3px}blockquote{margin:1.7em 1em;font-style:italic}' },
  Report: { label: 'Report', description: 'Compact tables and clear sections', css: '.document{max-width:940px;font-size:15px;line-height:1.68}h1{padding:.55em .65em;border:0;border-left:6px solid currentColor;font-size:2rem}h2{font-size:1.4rem}table{font-size:14px}th,td{padding:7px 9px}' },
  Compact: { label: 'Compact', description: 'High information density and fewer pages', css: '.document{max-width:980px;padding-top:28px;font-size:14px;line-height:1.52}h1{font-size:1.8rem}h2{margin-top:1.1em;font-size:1.25rem}h3{font-size:1.05rem}p,ul,ol{margin-block:.48em}pre{padding:12px;font-size:12px}th,td{padding:6px 8px}' },
}
