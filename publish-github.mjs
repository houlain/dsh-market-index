// Publish this directory's index files to a public GitHub repository, so the DSH 「发现」 tab can
// read them over raw.githubusercontent.com with no local process.
//
//   node publish-github.mjs [repoName]
//
// Token: $GITHUB_TOKEN, else GITHUB_TOKEN= from %USERPROFILE%\.dsh\.env.
// A public repository is required: raw reads carry no credentials, so a private repo would 401.

import fs from 'node:fs'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = process.argv[2] || 'dsh-market-index'
const API = 'https://api.github.com'
const AGENT = 'dsh-market-index-publisher'

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  const envFile = path.join(process.env.USERPROFILE || '', '.dsh', '.env')
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = /^\s*GITHUB_TOKEN\s*=\s*(.+)\s*$/.exec(line)
      if (m) return m[1].trim().replace(/^["']|["']$/g, '')
    }
  }
  throw new Error('no GitHub token (GITHUB_TOKEN unset and not found in ~/.dsh/.env)')
}

const TOKEN = token()

async function api(route, init = {}) {
  const r = await fetch(API + route, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': AGENT,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.headers || {}),
    },
  })
  const text = await r.text()
  let json
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    json = text
  }
  return { status: r.status, ok: r.ok, json }
}

const me = await api('/user')
if (!me.ok) throw new Error(`cannot read token identity: ${me.status} ${JSON.stringify(me.json)}`)
const owner = me.json.login

let repo = await api(`/repos/${owner}/${REPO}`)
if (repo.status === 404) {
  console.log(`creating public repository ${owner}/${REPO}`)
  repo = await api('/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name: REPO,
      description: 'DSH plugin-market indexes (format 1): a curated list plus a community catalog verified against npm.',
      private: false,
      auto_init: true,
      has_issues: false,
      has_wiki: false,
      has_projects: false,
    }),
  })
  if (!repo.ok) throw new Error(`cannot create repository: ${repo.status} ${JSON.stringify(repo.json)}`)
  await new Promise((r) => setTimeout(r, 1500))
} else if (!repo.ok) {
  throw new Error(`cannot read repository: ${repo.status} ${JSON.stringify(repo.json)}`)
}

const branch = repo.json.default_branch || 'main'
console.log(`repository ${owner}/${REPO} (branch ${branch})`)

// source file -> path in the repository
const FILES = [
  ['catalog.json', 'catalog.json'],
  ['index.json', 'index.json'],
  ['REPO-README.md', 'README.md'],
  ['build-catalog.mjs', 'build-catalog.mjs'],
  ['build-index.mjs', 'build-index.mjs'],
  ['verify-index.mjs', 'verify-index.mjs'],
  ['publish-github.mjs', 'publish-github.mjs'],
]

for (const [source, target] of FILES) {
  const abs = path.join(HERE, source)
  if (!fs.existsSync(abs)) {
    console.log(`  skip ${source} (missing)`)
    continue
  }
  const content = fs.readFileSync(abs).toString('base64')
  const existing = await api(`/repos/${owner}/${REPO}/contents/${target}?ref=${branch}`)
  const sha = existing.ok && existing.json && existing.json.sha ? existing.json.sha : undefined
  const put = await api(`/repos/${owner}/${REPO}/contents/${target}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `publish ${target}`,
      content,
      branch,
      ...(sha === undefined ? {} : { sha }),
    }),
  })
  console.log(`  ${put.ok ? 'uploaded' : 'FAILED  '} ${target}${sha ? ' (updated)' : ''} ${put.ok ? '' : put.status + ' ' + JSON.stringify(put.json)}`)
}

const raw = `https://raw.githubusercontent.com/${owner}/${REPO}/${branch}`
console.log('\nindex source URLs:')
console.log(`  ${raw}/catalog.json`)
console.log(`  ${raw}/index.json`)
