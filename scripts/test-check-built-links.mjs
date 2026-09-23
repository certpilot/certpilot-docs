// Prove check-built-links.mjs fails on each kind of dead link, and passes once
// the link is corrected.
//
// A link check that has never been seen to fail has not been shown to work.
// Each case below is a small built site written to a temporary directory, so
// this runs in a second without a VitePress build and cannot be satisfied by
// whatever the real site happens to contain today.
//
// The broken/corrected pairs are the real failures, not invented ones: a
// heading slug that starts with a digit (VitePress prefixes `_`), and an
// em-dash heading (VitePress keeps the dash; GitHub drops it). Both shipped.
//
//   node scripts/test-check-built-links.mjs

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const checker = join(root, 'scripts/check-built-links.mjs')
const B = '/certpilot-docs'

const page = (body, ids = []) =>
  `<!doctype html><html><body>${ids.map((id) => `<h2 id="${id}">x</h2>`).join('')}${body}</body></html>`

/** Write a fixture site and return its directory. */
function site(files) {
  const dir = mkdtempSync(join(tmpdir(), 'built-links-'))
  for (const [path, html] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), html)
  }
  return dir
}

// A site with nothing wrong in it. Every case below breaks exactly one thing.
const good = () => ({
  'index.html': page(`<a href="${B}/guide#_5-issue-from-a-real-ca">x</a><img src="${B}/images/a.png">`, ['top']),
  'guide.html': page(`<a href="#top">x</a><a href="${B}/ops#delete-—-not-a-substitute-for-revoking">x</a><a href="${B}/">home</a>`,
    ['_5-issue-from-a-real-ca', 'top']),
  'ops.html': page('', ['delete-—-not-a-substitute-for-revoking']),
  'images/a.png': 'png',
})

const cases = [
  ['a clean site passes', good(), 0, null],
  ['a digit-leading anchor spelled the GitHub way fails',
    { ...good(), 'index.html': page(`<a href="${B}/guide#5-issue-from-a-real-ca">x</a>`) }, 1, 'no element with id "5-issue-from-a-real-ca"'],
  ['an em-dash anchor spelled the GitHub way fails',
    { ...good(), 'guide.html': page(`<a href="${B}/ops#delete--not-a-substitute-for-revoking">x</a>`, ['_5-issue-from-a-real-ca']) }, 1, 'no element with id "delete--not-a-substitute-for-revoking"'],
  ['a link to a page that was never built fails',
    { ...good(), 'index.html': page(`<a href="${B}/nowhere">x</a>`) }, 1, 'nothing is built at that path'],
  ['a dead same-page anchor fails',
    { ...good(), 'ops.html': page(`<a href="#gone">x</a>`, ['delete-—-not-a-substitute-for-revoking']) }, 1, 'no element on this page has that id'],
  ['a root-relative link outside the base fails',
    { ...good(), 'index.html': page(`<a href="/guide">x</a>`) }, 1, 'outside the site base'],
  ['a missing image fails',
    { ...good(), 'index.html': page(`<img src="${B}/images/missing.png">`) }, 1, 'nothing is built at that path'],
  ['an empty build is a failure, not a pass', { 'notes.txt': 'no html here' }, 2, 'contains no HTML'],
]

let failed = 0
const dirs = []
function run(name, dist, wantCode, wantText) {
  const r = spawnSync(process.execPath, [checker, '--dist', dist], { encoding: 'utf8' })
  const out = r.stdout + r.stderr
  const ok = r.status === wantCode && (!wantText || out.includes(wantText))
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} (exit ${r.status})`)
  if (!ok) {
    failed++
    console.log(`     wanted exit ${wantCode}${wantText ? ` and "${wantText}"` : ''}; got:\n${out.replace(/^/gm, '     ')}`)
  }
}

for (const [name, files, code, text] of cases) {
  const dir = site(files)
  dirs.push(dir)
  run(name, dir, code, text)
}
run('a build directory that does not exist is a failure, not a pass',
  join(tmpdir(), 'built-links-does-not-exist'), 2, 'This check does not skip')

for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
console.log(failed ? `\n${failed} case(s) failed` : '\nevery case behaved')
process.exit(failed ? 1 : 0)
