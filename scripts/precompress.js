import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'

const brotli = promisify(brotliCompress)
const gz = promisify(gzip)
const root = fileURLToPath(new URL('../dist/', import.meta.url))
const files = (await readdir(root, { recursive: true })).filter((file) =>
  /\.(?:html|js|css|json|svg|wasm)$/.test(file),
)

// Bound compression work and memory even when the highlighter emits many languages.
for (let i = 0; i < files.length; i += 4) {
  await Promise.all(
    files.slice(i, i + 4).map(async (file) => {
      const path = join(root, file)
      const source = await readFile(path)
      const [br, compressed] = await Promise.all([
        brotli(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }),
        gz(source, { level: 9 }),
      ])
      await Promise.all([
        br.length < source.length ? writeFile(`${path}.br`, br) : undefined,
        compressed.length < source.length ? writeFile(`${path}.gz`, compressed) : undefined,
      ])
    }),
  )
}
console.log(`Precompressed ${files.length} client assets (Brotli and gzip).`)
