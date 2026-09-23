// Fail if the generated pages do not match routes.json.
//
// Generated pages are gitignored, so this is really a guard against the
// generator silently dropping routes — a section renamed in the router but not
// in ORDER, for instance, which would otherwise vanish from the sidebar.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const doc = JSON.parse(readFileSync(join(root, 'routes.json'), 'utf8'))

let pages
try {
  pages = readdirSync(join(root, 'docs/api/reference'))
} catch {
  console.error('check-drift: no generated pages — run `npm run gen` first')
  process.exit(1)
}

const rendered = pages
  .filter((f) => f.endsWith('.md'))
  .flatMap((f) =>
    [...readFileSync(join(root, 'docs/api/reference', f), 'utf8')
      .matchAll(/^### `(\w+) (\S+)`$/gm)].map((m) => `${m[1]} ${m[2]}`),
  )

const expected = doc.routes.map((r) => `${r.method} ${r.path}`)
const missing = expected.filter((r) => !rendered.includes(r))
const extra = rendered.filter((r) => !expected.includes(r))

if (missing.length || extra.length) {
  if (missing.length) console.error('check-drift: not documented:\n  ' + missing.join('\n  '))
  if (extra.length) console.error('check-drift: documented but not a route:\n  ' + extra.join('\n  '))
  process.exit(1)
}

// Anchors used to be checked here, over api/reference/ only, and the check
// printed "skipping" and exited 0 whenever the build output was missing. Both
// halves were wrong in a way that shipped: every dead anchor found since was
// cross-page, which that loop never read, and a check that passes when it
// could not run looks identical to one that ran and found nothing.
//
// scripts/check-built-links.mjs does it for every page and fails when there is
// nothing to read. Kept out of this file so each script answers one question:
// this one is "is every route documented", that one is "does every link land".

console.log(`check-drift: all ${expected.length} routes documented`)
