import type { TextStats } from './types'

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\u{20000}-\u{2a6df}]/gu
const CJK_PUNCT_PATTERN = /[\u3000-\u303f\uff00-\uffef]/gu
const ENGLISH_WORD_PATTERN = /\b[a-zA-Z]+(?:-[a-zA-Z]+)?\b/g
const DIGIT_PATTERN = /\p{Nd}/gu
function countMatches(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0
}

function isLineBreak(code: number) {
  return code === 0x0a || code === 0x0b || code === 0x0c || code === 0x0d
    || (code >= 0x1c && code <= 0x1e) || code === 0x85 || code === 0x2028 || code === 0x2029
}

function countLines(text: string) {
  let lines = 1
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (!isLineBreak(code)) continue
    lines += 1
    if (code === 0x0d && text.charCodeAt(index + 1) === 0x0a) index += 1
  }
  return isLineBreak(text.charCodeAt(text.length - 1)) ? lines - 1 : lines
}

export function analyzeTextLocally(text: string): TextStats {
  if (!text) {
    return {
      total_chars: 0,
      chars_no_spaces: 0,
      cjk_count: 0,
      cjk_punct_count: 0,
      english_words: 0,
      digit_count: 0,
      line_count: 0,
    }
  }

  return {
    total_chars: Array.from(text).length,
    chars_no_spaces: Array.from(text.replace(/\s/gu, '')).length,
    cjk_count: countMatches(text, CJK_PATTERN),
    cjk_punct_count: countMatches(text, CJK_PUNCT_PATTERN),
    english_words: countMatches(text, ENGLISH_WORD_PATTERN),
    digit_count: countMatches(text, DIGIT_PATTERN),
    line_count: countLines(text),
  }
}
