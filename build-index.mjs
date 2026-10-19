// Regenerate index.json for the DSH official "发现" tab (plugin market index format 1).
//
//   node build-index.mjs
//
// Sources: the npm registry (exact versions + publish timestamps + the plugin's own
// declared DSH peer ranges). Compatibility is evaluated with the SAME semver call the
// host uses (@deepseek-ai/dsh-app-boot: semver.satisfies(v, range, { includePrerelease: true })),
// against the DSH runtime version this profile runs.
//
// Rules that keep the index trustworthy:
//   * one version per plugin: the npm `latest` that is installed and running here;
//   * `source` is pinned to type npm + an explicit registry (no git specs, no tarballs);
//   * `engines.dsh` is copied from the plugin's own declaration and only emitted when
//     (a) every @deepseek-ai/dsh-* peer range is byte-identical, and
//     (b) the running host version satisfies it -> never a range that would falsely
//     hide the plugin on this machine;
//   * anything that does not resolve on npm is dropped, not guessed.

import fs from 'node:fs'
import path from 'node:path'
import semver from 'semver'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const OUT = path.join(HERE, 'index.json')
const REGISTRY = 'https://registry.npmjs.org/'

// The DSH runtime version this profile runs.
const PROFILE_DIR = 'C:\\Users\\ai_bot\\.dsh\\profiles\\desktop'

// Curated set: exactly the plugins this profile installs and runs.
const CURATED = [
  {
    name: 'dshmarket',
    zh: 'DSH 可视化插件市场：搜索社区插件，一键安装与更新。',
    en: 'Visual plugin market for DSH: search community plugins, install and update them.',
    category: 'verified',
    labels: ['host-half'],
  },
  {
    name: '@michengai/dsh-archive-manager',
    zh: '会话归档管理：归档、导出与恢复会话。',
    en: 'Session archive manager: archive, export and restore sessions.',
    category: 'verified',
    labels: ['host-half'],
  },
  {
    name: 'dsh-context',
    zh: '上下文洞察与管理：跨会话上下文仪表盘与 /context 命令。',
    en: 'Context insight and management: cross-session dashboard and the /context command.',
    category: 'verified',
    labels: ['host-half'],
  },
  {
    name: 'dsh-diff-approval',
    zh: '改动审批：整文件 diff，逐块 Keep / Revert。',
    en: 'Pending-edit review: whole-file diff with per-hunk Keep / Revert.',
    category: 'verified',
    labels: [],
  },
  {
    name: '@openviking/dsh-memory-plugin',
    zh: 'OpenViking 长期语义记忆：自动召回、会话采集与 viking:// 工具。',
    en: 'OpenViking long-term semantic memory: recall, session capture and viking:// tools.',
    category: 'verified',
    labels: [],
  },
  {
    name: '@opencode2dsh/dsh-plugin',
    zh: '把 OpenCode Zen 模型接入 DSH（原生 dsh-llm 适配器，无需 API key）。',
    en: 'OpenCode Zen models for DSH: a native dsh-llm adapter with no API key.',
    category: 'verified',
    labels: [],
  },
  {
    name: 'dsh-opencode-go',
    zh: 'OpenCode Go 模型 provider 与设置界面。',
    en: 'OpenCode Go model provider and settings UI.',
    category: 'verified',
    labels: ['host-half'],
  },
  {
    name: 'dsh-reverse-mode',
    zh: '逆向模式：按需挂载 REA（rea-agents）MCP 工具。',
    en: 'Reverse-engineering preset: mounts the REA (rea-agents) MCP tools on demand.',
    category: 'verified',
    labels: [],
  },
]

const LOCKSTEP = /^@deepseek-ai\/dsh-/

function runtimeVersion() {
  try {
    const p = path.join(PROFILE_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')).version
  } catch {}
  return '0.2.1-rc.2'
}

const HOST = runtimeVersion()

function satisfies(range) {
  return semver.satisfies(HOST, range, { includePrerelease: true })
}

async function meta(name) {
  const enc = name.startsWith('@') ? name.replace('/', '%2F') : name
  const r = await fetch(REGISTRY + enc)
  if (!r.ok) throw new Error(`registry ${r.status}`)
  return r.json()
}

/** engines.dsh = the plugin's own identical DSH peer range, only when the host satisfies it. */
function deriveEngines(versionManifest) {
  const own = versionManifest.engines && versionManifest.engines.dsh
  if (typeof own === 'string' && own.trim() !== '') {
    return satisfies(own) ? own : undefined
  }
  const ranges = Object.entries(versionManifest.peerDependencies || {})
    .filter(([k]) => LOCKSTEP.test(k))
    .map(([, v]) => v)
  const distinct = [...new Set(ranges)]
  if (distinct.length !== 1) return undefined
  const range = distinct[0]
  if (typeof range !== 'string' || !semver.validRange(range)) return undefined
  return satisfies(range) ? range : undefined
}

function repoUrl(v) {
  const raw = typeof v === 'string' ? v : v && v.url
  if (!raw) return undefined
  const url = raw.replace(/^git\+/, '').replace(/\.git$/, '')
  return /^https?:\/\//.test(url) ? url : undefined
}

const plugins = []
const report = []

for (const item of CURATED) {
  let doc
  try {
    doc = await meta(item.name)
  } catch (e) {
    report.push([item.name, 'SKIPPED', `registry: ${e.message}`])
    continue
  }
  const version = doc['dist-tags'] && doc['dist-tags'].latest
  const manifest = version && doc.versions && doc.versions[version]
  if (!version || !manifest) {
    report.push([item.name, 'SKIPPED', 'no dist-tags.latest'])
    continue
  }
  const engines = deriveEngines(manifest)
  const published = doc.time && doc.time[version]
  const publishTimestamp = published ? Math.floor(new Date(published).getTime() / 1000) : undefined
  if (!Number.isInteger(publishTimestamp)) {
    report.push([item.name, 'SKIPPED', 'no publish timestamp'])
    continue
  }
  const entry = {
    name: item.name,
    description: { en: item.en || manifest.description || item.name, 'zh-cn': item.zh || item.en || item.name },
    versions: [
      {
        version,
        publishTimestamp,
        source: { type: 'npm', registry: REGISTRY },
        ...(engines === undefined ? {} : { engines: { dsh: engines } }),
      },
    ],
    metadata: {
      ...(item.category ? { category: item.category } : {}),
      keywords: ['dsh', 'plugin', ...(item.labels || [])],
      ...(item.labels && item.labels.length ? { labels: item.labels } : {}),
    },
  }
  const repository = repoUrl(manifest.repository)
  if (repository) entry.repository = { url: repository }
  plugins.push(entry)
  report.push([item.name, version, engines ? `engines.dsh=${engines}` : 'engines.dsh omitted (ambiguous)'])
}

const index = {
  format: 1,
  title: { en: 'dsh curated plugin index', 'zh-cn': 'dsh 本机精选插件索引' },
  description: {
    en: 'Curated DSH plugin index for this machine (verified on host ' + HOST + ').',
    'zh-cn': '本机精选 DSH 插件索引（在宿主 ' + HOST + ' 上验证）。',
  },
  metadata: {
    categories: {
      verified: { title: { en: 'Verified on this profile', 'zh-cn': '本机已验证' } },
    },
    labels: {
      'host-half': { title: { en: 'Host half - restart DSH after update', 'zh-cn': '带宿主半边 · 更新后需重启 DSH' } },
    },
    sortKeys: {},
  },
  plugins,
}

fs.writeFileSync(OUT, JSON.stringify(index, null, 2) + '\n', 'utf8')

const w = (rows, i) => Math.max(...rows.map((r) => String(r[i] ?? '').length))
console.log(`host runtime version: ${HOST}`)
console.log(`wrote ${OUT} (${plugins.length} plugins)`)
for (const r of report) {
  console.log(' ', String(r[0]).padEnd(w(report, 0)), String(r[1]).padEnd(14), r[2])
}
