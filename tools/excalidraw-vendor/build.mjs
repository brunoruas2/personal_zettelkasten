// Gera apps/web/public/vendor/excalidraw/ a partir do Excalidraw travado no package.json.
// Rodar na máquina de desenvolvimento (npm install && npm run build) e commitar o resultado.
import { build } from 'esbuild'
import { cp, mkdir, rm, readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', '..', 'apps', 'web', 'public', 'vendor', 'excalidraw')
const dist = join(here, 'node_modules', '@excalidraw', 'excalidraw', 'dist', 'prod')
const KEEP_LOCALES = /(^|[\/])(pt-BR|en)(-|\.)/

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

// Locales: só pt-BR e en entram; os demais viram módulo vazio.
const onlyTwoLocales = {
  name: 'only-two-locales',
  setup(b) {
    b.onResolve({ filter: /locales[\/].+\.js$/ }, (args) => {
      if (KEEP_LOCALES.test(args.path)) return null
      return { path: args.path, namespace: 'empty-locale' }
    })
    b.onLoad({ filter: /.*/, namespace: 'empty-locale' }, () => ({
      contents: 'export default {}',
      loader: 'js',
    }))
  },
}

await build({
  entryPoints: { excalidraw: join(here, 'entry.tsx') },
  outdir: out,
  bundle: true,
  splitting: true,
  format: 'esm',
  minify: true,
  target: 'es2020',
  jsx: 'automatic',
  platform: 'browser',
  conditions: ['production'],
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.IS_PREACT': '"false"' },
  loader: { '.woff2': 'file', '.json': 'json' },
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  plugins: [onlyTwoLocales],
  logLevel: 'info',
})

// Fontes (sem Xiaolai, 13 MB de fallback CJK). O worker de subset já sai como chunk do esbuild.
await cp(join(dist, 'fonts'), join(out, 'fonts'), {
  recursive: true,
  filter: (src) => !src.split('\\').join('/').includes('/Xiaolai'),
})

// Manifesto de arquivos para o Service Worker precachear tudo.
async function walk(dir) {
  const items = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) items.push(...(await walk(p)))
    else items.push(p)
  }
  return items
}
const files = (await walk(out))
  .map((p) => relative(out, p).split('\\').join('/'))
  .filter((p) => p !== 'manifest.json')
  .sort()
let total = 0
for (const f of files) total += (await stat(join(out, f))).size
await writeFile(join(out, 'manifest.json'), JSON.stringify({ files }, null, 1))
console.log(`excalidraw vendor: ${files.length} arquivos, ${(total / 1e6).toFixed(1)} MB`)
