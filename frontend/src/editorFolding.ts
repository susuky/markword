import { foldedRanges } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { loadPreference, savePreference } from './storage'

interface SavedFolding {
  fingerprint: string
  ranges: { from: number; to: number }[]
}

function preference(documentId: string) { return `editor-folding.v1.${documentId}` }

// Remember positions without storing another copy of the document. A changed
// document must never inherit ranges that could hide unrelated content.
function fingerprint(state: EditorState) {
  let hash = 0
  for (const chunk of state.doc.iter()) {
    for (let index = 0; index < chunk.length; index++) hash = Math.imul(hash, 31) + chunk.charCodeAt(index) | 0
  }
  return `${state.doc.length}:${hash >>> 0}`
}

export function loadEditorFolding(documentId: string, state: EditorState) {
  try {
    const saved = loadPreference<SavedFolding | null>(preference(documentId), null)
    if (!saved || saved.fingerprint !== fingerprint(state) || !Array.isArray(saved.ranges)) return []
    return saved.ranges.filter((range) => range && Number.isInteger(range.from) && Number.isInteger(range.to)
      && range.from >= 0 && range.from < range.to && range.to <= state.doc.length)
      .sort((a, b) => a.from - b.from)
  } catch {
    return []
  }
}

export function saveEditorFolding(documentId: string, state: EditorState) {
  const ranges: SavedFolding['ranges'] = []
  foldedRanges(state).between(0, state.doc.length, (from, to) => { ranges.push({ from, to }) })
  try {
    savePreference(preference(documentId), { fingerprint: fingerprint(state), ranges })
  } catch {
    // A blocked/full preference store must not interrupt document editing.
  }
}
