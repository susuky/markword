import { translate } from './i18n'

interface ZipLimits {
  maxTotalBytes: number
  maxEntryBytes: number
  maxEntries: number
}

export async function unzipBounded(archive: Uint8Array, limits: ZipLimits): Promise<Record<string, Uint8Array>> {
  const { Inflate, unzipSync } = await import('fflate')
  const invalid = () => new Error(translate('Archive is damaged or uses an unsupported format'))
  const exceeded = new Error(translate('Archive contents exceed the import limits'))
  const directory = new Map<string, { size: number; originalSize: number; compression: number }>()
  let claimedTotal = 0
  try {
    // Read only the directory first, before allocating any expanded content.
    unzipSync(archive, { filter(entry) {
      if (directory.has(entry.name) || !Number.isSafeInteger(entry.originalSize) || entry.originalSize < 0) throw invalid()
      directory.set(entry.name, entry)
      claimedTotal += entry.originalSize
      if (directory.size > limits.maxEntries || entry.originalSize > limits.maxEntryBytes || claimedTotal > limits.maxTotalBytes) throw exceeded
      return false
    } })

    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    const u16 = (offset: number) => view.getUint16(offset, true)
    const u32 = (offset: number) => view.getUint32(offset, true)
    const u64 = (offset: number) => {
      const value = Number(view.getBigUint64(offset, true))
      if (!Number.isSafeInteger(value) || value > archive.length) throw invalid()
      return value
    }
    let end = archive.length - 22
    while (end >= Math.max(0, archive.length - 65557) && u32(end) !== 0x06054b50) end--
    if (end < 0 || u32(end) !== 0x06054b50) throw invalid()
    let position = u32(end + 16)
    if (end >= 20 && u32(end - 20) === 0x07064b50) {
      const zip64 = u64(end - 12)
      if (u32(zip64) !== 0x06064b50) throw invalid()
      position = u64(zip64 + 48)
    }
    const entries: Record<string, Uint8Array> = Object.create(null)
    let total = 0
    for (const [name, entry] of directory) {
      if (u32(position) !== 0x02014b50) throw invalid()
      const extraStart = position + 46 + u16(position + 28)
      const extraEnd = extraStart + u16(position + 30)
      let local = u32(position + 42)
      if (local === 0xffffffff) {
        for (let extra = extraStart; extra + 4 <= extraEnd; extra += 4 + u16(extra + 2)) {
          if (u16(extra) !== 1) continue
          const offset = extra + 4 + (u32(position + 24) === 0xffffffff ? 8 : 0) + (u32(position + 20) === 0xffffffff ? 8 : 0)
          if (offset + 8 > extra + 4 + u16(extra + 2) || extra + 4 + u16(extra + 2) > extraEnd) throw invalid()
          local = u64(offset)
          break
        }
      }
      position = extraEnd + u16(position + 32)
      if (u32(local) !== 0x04034b50 || (u16(local + 6) & 1) || u16(local + 8) !== entry.compression) throw invalid()
      const start = local + 30 + u16(local + 26) + u16(local + 28)
      if (start + entry.size > archive.length || ![0, 8].includes(entry.compression)) throw invalid()
      const result = new Uint8Array(entry.originalSize)
      let written = 0
      const accept = (bytes: Uint8Array) => {
        total += bytes.length
        if (written + bytes.length > limits.maxEntryBytes || total > limits.maxTotalBytes) throw exceeded
        if (written + bytes.length > result.length) throw invalid()
        result.set(bytes, written)
        written += bytes.length
      }
      const inflate = entry.compression === 8 ? new Inflate(accept) : null
      // Slice by the central directory, not payload signatures: streamed ZIPs
      // may contain nested ZIP attachments. Small pushes also bound allocation
      // inside Inflate before its output callback can check the actual budget.
      for (let offset = 0; offset < entry.size; offset += 1024) {
        const bytes = archive.subarray(start + offset, start + Math.min(offset + 1024, entry.size))
        if (inflate) inflate.push(bytes, offset + 1024 >= entry.size)
        else accept(bytes)
        if (offset % (256 * 1024) === 0) await new Promise((resolve) => setTimeout(resolve, 0))
      }
      if (written !== entry.originalSize) throw invalid()
      entries[name] = result
    }
    return entries
  } catch (error) {
    throw error === exceeded ? error : invalid()
  }
}
