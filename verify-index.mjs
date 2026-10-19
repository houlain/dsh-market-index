// Validate index.json with the HOST'S OWN validator (@deepseek-ai/dsh-plugin-market-index,
// vendored from the running DSH installation) and check each entry against the host version
// with the same semver call the host uses.
//
//   node verify-index.mjs [indexUrl]
//
// Exit code 0 = the host would accept the document; 1 = it would reject it (reason printed).

import fs from 'node:fs'
import path from 'node:path'
import semver from 'semver'
import { parseMarketIndex, marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const indexPath = process.argv[3] || path.join(HERE, 'index.json')
const url = new URL(process.argv[2] || 'http://127.0.0.1:8787/index.json')
const HOST = '0.2.1-rc.2'

const raw = fs.readFileSync(indexPath, 'utf8')
let index
try {
  index = parseMarketIndex(JSON.parse(raw), url)
} catch (error) {
  console.error('INVALID:', error && error.constructor && error.constructor.name)
  console.error('  path  :', error && error.path)
  console.error('  reason:', error && error.reason)
  process.exit(1)
}

console.log(`VALID  ${indexPath}`)
console.log(`  read as        : ${url.href}`)
console.log(`  format         : ${index.format}`)
console.log(`  plugins        : ${index.plugins.length}`)
let problems = 0
for (const plugin of index.plugins) {
  for (const version of plugin.versions) {
    const target = marketInstallTarget(plugin.name, version)
    let verdict = 'compatible'
    if (version.engines && version.engines.dsh !== undefined) {
      const ok = semver.satisfies(HOST, version.engines.dsh, { includePrerelease: true })
      if (!ok) {
        verdict = `NOT compatible with host ${HOST} (engines.dsh=${version.engines.dsh})`
        problems++
      }
    } else {
      verdict = `no engines.dsh claim; host gate decides at install time`
    }
    console.log(
      `  - ${plugin.name.padEnd(34)} ${version.version.padEnd(9)} spec=${String(target.spec).padEnd(40)} ${verdict}`,
    )
  }
}
console.log(problems === 0 ? 'all entries acceptable on this host' : `${problems} entry/entries would be unavailable`)
process.exit(problems === 0 ? 0 : 1)
