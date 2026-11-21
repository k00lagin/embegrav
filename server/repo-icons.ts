import { open, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import {
  icnsPng,
  MAX_REPO_ICON_BYTES,
  REPO_ICON_EXTENSIONS,
  type RepoIconImage,
} from '../shared/repo-icons.ts'
import { git } from './git.ts'

const knownIcons = `favicon.svg favicon.ico favicon.png
public/favicon.svg public/favicon.ico public/favicon.png app/favicon.ico app/favicon.png
app/icon.svg app/icon.png app/icon.ico src/favicon.ico src/favicon.svg src/app/favicon.ico
src/app/icon.svg src/app/icon.png assets/icon.svg assets/icon.png assets/logo.svg assets/logo.png
.idea/icon.svg Resources/AppIcon.icns AppIcon.icns`.split(/\s+/)
const sources = [
  'index.html',
  'public/index.html',
  'app/routes/__root.tsx',
  'src/routes/__root.tsx',
  'app/root.tsx',
  'src/root.tsx',
  'src/index.html',
]
const sourceLimit = 128 << 10

const imageTypes: Readonly<Record<string, string>> = {
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
}

const extension = (file: string) => extname(file).slice(1).toLowerCase()

function isInside(root: string, file: string): boolean {
  const path = relative(root, file)
  return !!path && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

async function projectFile(root: string, file: string): Promise<string | null> {
  if (
    isAbsolute(file) ||
    file.includes('\0') ||
    (process.platform === 'win32' && file.includes(':'))
  ) {
    return null
  }
  const target = resolve(root, file)
  if (!isInside(root, target)) return null
  const canonical = await realpath(target).catch(() => null)
  return canonical && isInside(root, canonical) ? canonical : null
}

async function readProjectFile(root: string, file: string, maxBytes: number, prefix = false) {
  const target = await projectFile(root, file)
  if (!target) return null
  try {
    // Check before opening to avoid blocking on a named pipe.
    const info = await stat(target)
    if (!info.isFile() || (!prefix && info.size > maxBytes)) return null
    const handle = await open(target, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(maxBytes + Number(!prefix), info.size + Number(!prefix)))
      const { bytesRead } = await handle.read({ buffer })
      return bytesRead <= maxBytes ? buffer.subarray(0, bytesRead) : null
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

function looksLikeImage(data: Buffer, ext: string): boolean {
  switch (ext) {
    case 'svg': {
      const header = data.toString('utf8', 0, 8192)
      return /^\s*<svg[\s/>]/i.test(
        header.replace(/<\?xml[^>]*>|<!--[\s\S]*?-->|<!DOCTYPE svg[^>]*>/gi, ''),
      )
    }
    case 'ico':
      return data.length >= 22 && data.readUInt32LE() === 0x00010000 && data.readUInt16LE(4) > 0
    case 'png':
      return data.length >= 33 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    case 'jpg':
    case 'jpeg':
      return data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
    case 'gif':
      return /^GIF8[79]a$/.test(data.toString('ascii', 0, 6))
    case 'webp':
      return data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
    case 'bmp':
      return data.length >= 14 && data.toString('ascii', 0, 2) === 'BM'
    default:
      return false
  }
}

async function loadIcon(root: string, file: string): Promise<RepoIconImage | null> {
  let ext = extension(file)
  if (!REPO_ICON_EXTENSIONS.includes(ext)) return null
  const bytes = await readProjectFile(root, file, MAX_REPO_ICON_BYTES)
  if (!bytes) return null
  let data: Buffer = bytes
  if (ext === 'icns') {
    const png = icnsPng(data)
    if (!png) return null
    data = Buffer.from(png.buffer, png.byteOffset, png.byteLength)
    ext = 'png'
  }
  if (!looksLikeImage(data, ext)) return null
  // A data URL also keeps a standalone SVG in an opaque origin if opened from the image.
  return { file, src: `data:${imageTypes[ext]};base64,${data.toString('base64')}` }
}

async function* automaticFiles(root: string): AsyncGenerator<string> {
  const project = await readProjectFile(root, 't3.json', sourceLimit)
  try {
    const icon = project && JSON.parse(project.toString('utf8'))?.iconPath
    if (typeof icon === 'string' && icon) yield icon
  } catch {
    // Ignore invalid project metadata.
  }
  yield* knownIcons
  for (const source of sources) {
    const bytes = await readProjectFile(root, source, sourceLimit, true)
    if (!bytes) continue
    const text = bytes.toString('utf8')
    const links: string[] = text.match(/<link\b[^<>]*>/gi) ?? []
    if (source.endsWith('.tsx')) links.push(...text.split('}'))
    for (const link of links) {
      if (!/\brel\s*[=:]\s*["'](?:shortcut\s+)?icon["']/i.test(link)) continue
      const href = /\bhref\s*[=:]\s*["']([^"']+)["']/i.exec(link)?.[1]
      if (!href || /^(?:[a-z][\w+.-]*:|[/\\]{2})/i.test(href)) continue
      let file: string
      try {
        file = decodeURIComponent(href.split(/[?#]/, 1)[0]).replace(/^\//, '')
      } catch {
        continue
      }
      if (!file) continue
      yield `public/${file}`
      yield file
    }
  }
}

export async function resolveRepoIcon(repo: string, file?: string, skip: string[] = []) {
  const root = await realpath(repo)
  if (file !== undefined) return loadIcon(root, file)
  const seen = new Set(skip)
  for await (const candidate of automaticFiles(root)) {
    if (seen.has(candidate)) continue
    seen.add(candidate)
    const icon = await loadIcon(root, candidate)
    if (icon) return icon
  }
  return null
}

export async function listRepoIconFiles(repo: string): Promise<string[]> {
  const [root, files] = await Promise.all([
    realpath(repo),
    git(repo, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
  ])
  const images = [...new Set(files.split('\0'))].filter((file) =>
    REPO_ICON_EXTENSIONS.includes(extension(file)),
  )
  const result: string[] = []
  for (let start = 0; start < images.length; start += 32) {
    const batch = await Promise.all(
      images.slice(start, start + 32).map(async (file) => {
        const path = await projectFile(root, file)
        return path && (await stat(path).catch(() => null))?.isFile() ? file : null
      }),
    )
    for (const file of batch) if (file !== null) result.push(file)
  }
  return result.sort((a, b) => a.localeCompare(b))
}
