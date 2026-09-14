// Refresh routes.json from the CertPilot repository.
//
// The docs repo vendors routes.json rather than generating it, because the
// docs build must not depend on a Go toolchain or a checkout of the code. The
// cost of vendoring is drift, so this script exists to close the gap and CI
// runs it on a schedule.
//
//   node scripts/sync-routes.mjs            # fetch from the default branch
//   node scripts/sync-routes.mjs --check    # exit 1 if it would change

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'routes.json')

/*
 * Which commit to read, and why it is not always "main".
 *
 * raw.githubusercontent.com is served through a CDN with its own cache, so a
 * request for the main branch immediately after a merge can return the content
 * from before it. That is not theoretical: the first dispatch-triggered sync
 * after this pipeline was built fetched nine rewritten pages correctly and the
 * tenth from a stale edge, published the mixture, and reported success. The
 * result was a site that was internally inconsistent with no failure anywhere.
 *
 * The dispatch carries the commit that triggered it, so CERTPILOT_REF pins
 * every request to that SHA. A SHA-addressed URL cannot go stale, because the
 * content behind it never changes. Falling back to main keeps the scheduled
 * run and a local run working, where there is no dispatch and the cache has
 * had time to settle anyway.
 */
const REF = process.env.CERTPILOT_REF || 'main'

const SOURCE =
  process.env.CERTPILOT_ROUTES_URL ??
  `https://raw.githubusercontent.com/certpilot/certpilot/${REF}/docs/routes.json`

const check = process.argv.includes('--check')

const response = await fetch(SOURCE)
if (!response.ok) {
  console.error(`sync-routes: ${SOURCE} returned ${response.status}`)
  process.exit(1)
}

const fetched = await response.text()

// Parsed before it is written: a truncated or HTML response (a 404 page served
// with a 200, which raw.githubusercontent has done) would otherwise replace a
// working route table with rubbish and only fail later, during the build.
let parsed
try {
  parsed = JSON.parse(fetched)
} catch (err) {
  console.error(`sync-routes: response was not JSON — ${err.message}`)
  process.exit(1)
}
if (!Array.isArray(parsed.routes) || parsed.routes.length === 0) {
  console.error('sync-routes: response contained no routes')
  process.exit(1)
}

const current = (() => {
  try {
    return readFileSync(target, 'utf8')
  } catch {
    return null
  }
})()

if (current === fetched) {
  console.log(`sync-routes: up to date (${parsed.route_count} routes)`)
  process.exit(0)
}

if (check) {
  const before = current ? JSON.parse(current).route_count : 0
  console.error(
    `sync-routes: routes.json is stale — ${before} local vs ${parsed.route_count} upstream. ` +
      'Run `npm run sync`.',
  )
  process.exit(1)
}

writeFileSync(target, fetched)
console.log(`sync-routes: updated to ${parsed.route_count} routes`)
