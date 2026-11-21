export const REPO_ICON_EXTENSIONS = [
  'svg',
  'ico',
  'icns',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
]
export const MAX_REPO_ICON_BYTES = 16 << 20

export interface RepoIconImage {
  file: string
  src: string
}

/** Modern ICNS files bundle several PNG versions of the same icon. */
export function icnsPng(bytes: Uint8Array): Uint8Array | undefined {
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'icns') return
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let smallest: Uint8Array | undefined
  for (let offset = 8; offset + 8 <= bytes.length;) {
    const length = view.getUint32(offset + 4)
    if (length < 8 || offset + length > bytes.length) break
    const part = bytes.subarray(offset + 8, offset + length)
    if (
      part.length >= 8 &&
      view.getUint32(offset + 8) === 0x89504e47 &&
      view.getUint32(offset + 12) === 0x0d0a1a0a &&
      (!smallest || part.length < smallest.length)
    ) {
      smallest = part
    }
    offset += length
  }
  return smallest
}
