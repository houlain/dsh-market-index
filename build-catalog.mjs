// Build a CATALOG index (format 1) from the community registry, so the DSH 「发现」 page can
// browse and install external plugins - not just the ones already installed.
//
//   node build-catalog.mjs [limit]        (default 400, sorted by downloads desc)
//
// Source: https://awesome-dsh-plugin.com/plugins.json (the registry the community market uses).
// Every entry is verified against the npm registry before it is written:
//   * the package exists and the exact version is published (else the entry is dropped);
//   * publishTimestamp comes from npm's own `time[version]`, not from the community file;
//   * source is pinned to npm + the official registry (no git/tarball specs);
//   * engines.dsh is only written when the plugin's own @deepseek-ai/dsh-* peer ranges are
//     byte-identical AND the running host satisfies them.
// The result is validated with the host's own validator before it is reported as written.

import fs from 'node:fs'
import path from 'node:path'
import semver from 'semver'
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const OUT = path.join(HERE, 'catalog.json')
const REGISTRY = 'https://registry.npmjs.org/'
const COMMUNITY = 'https://awesome-dsh-plugin.com/plugins.json'
const HOST = '0.2.1-rc.2'
const LIMIT = Number(process.argv[2] || 400)
const CONCURRENCY = 10

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/
const LOCKSTEP = /^@deepseek-ai\/dsh-/

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(url, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' } })
      if (r.status === 429 || r.status >= 500) {
        await sleep(500 * attempt)
        continue
      }
      if (!r.ok) return { ok: false, status: r.status }
      return { ok: true, doc: await r.json() }
    } catch (error) {
      if (attempt === tries) return { ok: false, status: `network: ${error.message}` }
      await sleep(300 * attempt)
    }
  }
  return { ok: false, status: 'exhausted' }
}

function localized(description) {
  if (!description) return undefined
  if (typeof description === 'string') return description.length ? description : undefined
  const text = {}
  if (typeof description.en === 'string' && description.en) text.en = description.en
  if (typeof description.zh === 'string' && description.zh) text['zh-cn'] = description.zh
  else if (typeof description['zh-cn'] === 'string' && description['zh-cn']) text['zh-cn'] = description['zh-cn']
  if (!text.en) {
    const first = Object.values(text)[0]
    if (typeof first === 'string') text.en = first
  }
  return Object.keys(text).length ? text : undefined
}

function deriveEngines(manifest) {
  const own = manifest.engines && manifest.engines.dsh
  if (typeof own === 'string' && own.trim() !== '' && semver.validRange(own) && semver.satisfies(HOST, own, { includePrerelease: true })) return own
  const ranges = Object.entries(manifest.peerDependencies || {})
    .filter(([k]) => LOCKSTEP.test(k))
    .map(([, v]) => v)
  const distinct = [...new Set(ranges)]
  if (distinct.length !== 1) return undefined
  const range = distinct[0]
  if (typeof range !== 'string' || !semver.validRange(range)) return undefined
  return semver.satisfies(HOST, range, { includePrerelease: true }) ? range : undefined
}

const registry = await getJson(COMMUNITY)
if (!registry.ok) throw new Error(`community registry unavailable: ${registry.status}`)
const doc = registry.doc
const raw = Array.isArray(doc.plugins) ? doc.plugins : []

// Deduplicate by npm package name, keep the most downloaded candidate that carries a version.
const byName = new Map()
for (const p of raw) {
  const name = typeof p.npm === 'string' ? p.npm.trim() : ''
  if (!name || !PACKAGE_NAME.test(name)) continue
  if (typeof p.version !== 'string' || !semver.valid(p.version)) continue
  const downloads = Number(p.downloads) || 0
  const previous = byName.get(name)
  if (!previous || downloads > previous.downloads) byName.set(name, { ...p, npm: name, downloads })
}
const candidates = [...byName.values()].sort((a, b) => b.downloads - a.downloads).slice(0, LIMIT)

console.log(`community registry: ${raw.length} rows, ${byName.size} distinct npm packages; verifying top ${candidates.length}`)

const categoryIds = new Set()
const labelIds = new Set()
const plugins = []
const stats = { verified: 0, missing: 0, failed: 0, repoRanges: 0 }

let cursor = 0
async function worker() {
  while (cursor < candidates.length) {
    const item = candidates[cursor++]
    const enc = item.npm.startsWith('@') ? item.npm.replace('/', '%2F') : item.npm
    const res = await getJson(`${REGISTRY}${enc}`)
    if (!res.ok) {
      stats.failed++
      continue
    }
    const manifest = res.doc.versions && res.doc.versions[item.version]
    const published = res.doc.time && res.doc.time[item.version]
    if (!manifest || !published) {
      stats.missing++
      continue
    }
    const publishTimestamp = Math.floor(new Date(published).getTime() / 1000)
    const engines = deriveEngines(manifest)
    if (engines) stats.repoRanges++
    const description = localized(item.description) || (manifest.description ? { en: manifest.description } : undefined)
    const keywords = [item.category, ...(Array.isArray(item.capabilities) ? item.capabilities : [])].filter((x) => typeof x === 'string')
    const labels = (Array.isArray(item.capabilities) ? item.capabilities : []).filter((x) => typeof x === 'string')
    if (item.category) categoryIds.add(item.category)
    for (const l of labels) labelIds.add(l)
    const entry = {
      name: item.npm,
      ...(typeof item.name === 'string' && item.name ? { title: item.name } : {}),
      ...(description ? { description } : {}),
      ...(/^https:\/\//.test(item.url || '') ? { repository: { url: item.url } } : {}),
      metadata: {
        ...(item.category ? { category: item.category } : {}),
        keywords,
        ...(labels.length ? { labels } : {}),
      },
      versions: [
        {
          version: item.version,
          publishTimestamp,
          source: { type: 'npm', registry: REGISTRY },
          ...(engines === undefined ? {} : { engines: { dsh: engines } }),
        },
      ],
    }
    plugins.push(entry)
    stats.verified++
    if (stats.verified % 50 === 0) console.log(`  verified ${stats.verified}...`)
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))

// Declare the categories/labels the entries reference.
const registryCategories = doc.categories || {}
const categories = {}
for (const id of categoryIds) {
  const title = localized(registryCategories[id])
  categories[id] = { title: title && typeof title === 'object' ? title : { en: id } }
}
const labels = {}
for (const id of labelIds) labels[id] = { title: { en: id } }

const index = {
  format: 1,
  title: { en: 'dsh community catalog', 'zh-cn': 'DSH 社区插件目录' },
  description: {
    en: `External DSH plugins from the community registry, verified against npm (top ${plugins.length} by downloads). Host ${HOST}.`,
    'zh-cn': `来自社区目录的外部 DSH 插件，逐条经 npm 校验（按下载量取前 ${plugins.length} 条）。宿主 ${HOST}。`,
  },
  metadata: { categories, labels, sortKeys: {} },
  plugins,
}

parseMarketIndex(index, new URL('http://127.0.0.1:8787/catalog.json'))
fs.writeFileSync(OUT, JSON.stringify(index, null, 2) + '\n', 'utf8')

console.log(`wrote ${OUT}`)
console.log(`  plugins: ${plugins.length} | categories: ${Object.keys(categories).length} | labels: ${Object.keys(labels).length}`)
console.log(`  dropped: missing-on-npm ${stats.missing}, request failures ${stats.failed}`)
console.log(`  with engines.dsh: ${stats.repoRanges}`)
console.log(`  size: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KiB`)
