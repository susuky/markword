export type ThemeName = 'Light' | 'Paper' | 'Sage' | 'Dark' | 'Ocean' | 'Nord' | 'Dracula' | 'Midnight'
export type ExportStyleName = 'Classic' | 'Editorial' | 'Report' | 'Compact'

export interface TextStats {
  total_chars: number
  chars_no_spaces: number
  cjk_count: number
  cjk_punct_count: number
  english_words: number
  digit_count: number
  line_count: number
}

export const EMPTY_STATS: TextStats = {
  total_chars: 0,
  chars_no_spaces: 0,
  cjk_count: 0,
  cjk_punct_count: 0,
  english_words: 0,
  digit_count: 0,
  line_count: 0,
}
