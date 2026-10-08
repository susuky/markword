import { DOCUMENT_MODES } from './documentMode'
import type { DocumentMode } from './types'

interface WritableFileHandle extends FileSystemFileHandle {
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>
}

interface FilePickerOptions {
  types: { description: string; accept: Record<string, string[]> }[]
  excludeAcceptAllOption?: boolean
  suggestedName?: string
  multiple?: boolean
}

const fileWindow = window as Window & {
  showOpenFilePicker?: (options: FilePickerOptions) => Promise<WritableFileHandle[]>
  showSaveFilePicker?: (options: FilePickerOptions) => Promise<WritableFileHandle>
}

export const canOpenLocalFile = typeof fileWindow.showOpenFilePicker === 'function'
export const canSaveLocalFile = typeof fileWindow.showSaveFilePicker === 'function'

export interface LinkedFile {
  handle: WritableFileHandle
  content: string
  byteLength: number
  mode: DocumentMode
}

export class FileChangedError extends Error {}

function pickerCancelled(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export async function pickLocalFile(description: string) {
  if (!fileWindow.showOpenFilePicker) return null
  try {
    const [handle] = await fileWindow.showOpenFilePicker({
      multiple: false,
      types: [{ description, accept: {
        'text/plain': ['.md', '.markdown', '.txt', '.mmd', '.mermaid'],
        'text/html': ['.html', '.htm'],
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
        'application/zip': ['.zip'],
      } }],
    })
    return handle ? { handle, file: await handle.getFile() } : null
  } catch (error) {
    if (pickerCancelled(error)) return null
    throw error
  }
}

export async function writeLocalFile(content: string, mode: DocumentMode, suggestedName: string, linked: LinkedFile | null, saveAs = false): Promise<LinkedFile | null> {
  if (!fileWindow.showSaveFilePicker) return null
  const original = !saveAs && linked?.mode === mode ? linked : null
  let handle = original?.handle
  if (!handle) {
    try {
      handle = await fileWindow.showSaveFilePicker({
        suggestedName,
        excludeAcceptAllOption: true,
        types: [{ description: DOCUMENT_MODES[mode].label, accept: {
          [DOCUMENT_MODES[mode].mime]: [`.${DOCUMENT_MODES[mode].extension}`],
        } }],
      })
    } catch (error) {
      if (pickerCancelled(error)) return null
      throw error
    }
  }
  // Request access while the save gesture is still active, before reading the file.
  if (handle.requestPermission && await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
    throw new DOMException('Write permission denied', 'NotAllowedError')
  }
  if (original) {
    const file = await handle.getFile()
    if (file.size !== original.byteLength || await file.text() !== original.content) throw new FileChangedError()
  }
  const bytes = new Blob([content])
  const writable = await handle.createWritable()
  try {
    await writable.write(bytes)
    await writable.close()
  } catch (error) {
    await writable.abort().catch(() => {})
    throw error
  }
  return { handle, content, byteLength: bytes.size, mode }
}
