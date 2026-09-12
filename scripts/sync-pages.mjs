// Publish whole pages, and their screenshots, from the CertPilot repository.
//
// The code repository carries about four thousand lines of documentation that
// were readable only by somebody who had already cloned it — precisely the
// audience that needs them least. This publishes them without moving them:
// prose about the system that lives beside the system gets updated by the
// person changing it, and prose that lives in a different repository does not.
//
// Same vendoring trade as routes.json and the guides: the docs build must not
// need a checkout of the code, so the result is committed here and this script
// closes the gap. `--check` is what CI runs.
//
//   node scripts/sync-pages.mjs                 # fetch from the default branch
//   node scripts/sync-pages.mjs --check         # exit 1 if it would change
//   CERTPILOT_DOCS_DIR=../certpilot/docs node scripts/sync-pages.mjs

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const RAW = 'https://raw.githubusercontent.com/certpilot/certpilot/main/docs'
const CODE_TREE = 'https://github.com/certpilot/certpilot/blob/main'

const localDir = process.env.CERTPILOT_DOCS_DIR
const check = process.argv.includes('--check')

/*
 * What gets published, and where it lands.
 *
 * Every page carries a sentinel: a heading that must be present in what comes
 * back. A 404 served as a 200, or a file renamed upstream, otherwise arrives
 * here as a page that builds cleanly and says nothing.
 *
 * `api-reference.md` is deliberately absent — sync-guides.mjs already splits it
 * into per-resource fragments that sit beside the generated route tables, and
 * importing it whole as well would give a reader two accounts of the same
 * endpoint with no way to tell which is current.
 */
const PAGES = [
  { source: 'getting-started.md', sentinel: '## 1. Generate development keys' },
  { source: 'architecture.md', sentinel: '## Decision 1 — a gateway is a process, not a package' },
  { source: 'discovery.md', sentinel: '## Certificate Transparency' },
  { source: 'monitoring.md', sentinel: '## Expiry thresholds' },
  { source: 'deployment.md', sentinel: '## Rollout order' },
  { source: 'agent.md', sentinel: '## Enrolment' },
  { source: 'posture.md', sentinel: '# Cryptographic posture' },
  { source: 'gateways/vault.md', sentinel: '# The Vault gateway' },
  { source: 'writing-a-gateway.md', sentinel: '# Writing a gateway' },
  { source: 'configuration.md', sentinel: '# Configuration reference' },
  { source: 'operations.md', sentinel: '# Operations' },
  { source: 'security.md', sentinel: '# Security model' },
  { source: 'database.md', sentinel: '# Running CertPilot against a database' },
  { source: 'troubleshooting.md', sentinel: '# Troubleshooting' },
  { source: 'status.md', sentinel: '# Implementation status' },
]

/** `security.md` -> `/security`, `gateways/vault.md` -> `/gateways/vault`. */
const routeFor = (source) => '/' + source.replace(/\.md$/, '')

/** Every source path this run publishes, for deciding what stays internal. */
const published = new Set(PAGES.map((p) => p.source))

/*
 * Links out of the set, to places this site does not host.
 *
 * `api-reference.md` is the interesting one: it is not published as a page, but
 * everything in it is here, split across the generated endpoint reference. A
 * reader following it wants that section, not a raw markdown file on GitHub.
 */
const EXTERNAL_PAGE = {
  'api-reference.md': '/api/',
  'README.md': '/',
}

/**
 * Rewrite a link so it resolves from this site.
 *
 * Three outcomes. A link to another published page becomes a site route, so the
 * set reads as one document rather than a ring of round trips to GitHub. A link
 * to a file in the repository becomes a GitHub URL. Anything left over is a
 * hard error: this site fails the build on a dead link rather than shipping
 * one, and a silent rewrite would leave prose promising an explanation it no
 * longer points to.
 */
function rewriteLink(target, fromSource) {
  if (/^(https?:|mailto:|#)/.test(target)) return null

  const [path, hash = ''] = target.split('#')
  const anchor = hash ? `#${hash}` : ''

  // Images travel with the page and are served from this site.
  if (/^images\//.test(path)) return `/${path}`

  // Resolve relative to the directory the source page lives in, so that
  // `../agent.md` inside `gateways/vault.md` means `agent.md`.
  const fromDir = dirname(fromSource)
  const resolved = path.startsWith('../') && fromDir !== '.'
    ? path.slice(3)
    : fromDir === '.' ? path.replace(/^\.\//, '') : join(fromDir, path)

  if (published.has(resolved)) return routeFor(resolved) + anchor
  if (EXTERNAL_PAGE[resolved]) return EXTERNAL_PAGE[resolved] + anchor

  // Everything else is a path in the code repository. `../` from docs/ lands
  // at the repository root; anything else is relative to docs/ itself.
  const clean = path.startsWith('../')
    ? path.slice(3)
    : `docs/${fromDir === '.' ? '' : fromDir + '/'}${path.replace(/^\.\//, '')}`
  return `${CODE_TREE}/${clean}${anchor}`
}

function rewriteLinks(markdown, fromSource) {
  return markdown.replace(
    /\]\(([^)\s]+)(\s+"[^"]*")?\)/g,
    (whole, target, title = '') => {
      const next = rewriteLink(target, fromSource)
      return next === null ? whole : `](${next}${title})`
    },
  )
}

/** Anything that will not resolve from this site once published. */
function unresolvedLinks(markdown) {
  return [...markdown.matchAll(/\]\(([^)\s]+)/g)]
    .map(([, target]) => target)
    .filter((t) => !/^(https?:|mailto:|#|\/)/.test(t))
}

async function loadText(source) {
  if (localDir) {
    const path = join(localDir, source)
    if (!existsSync(path)) {
      console.error(`sync-pages: ${path} does not exist`)
      process.exit(1)
    }
    return readFileSync(path, 'utf8')
  }
  const response = await fetch(`${RAW}/${source}`)
  if (!response.ok) {
    console.error(`sync-pages: ${RAW}/${source} returned ${response.status}`)
    process.exit(1)
  }
  return response.text()
}

async function loadBinary(source) {
  if (localDir) {
    const path = join(localDir, source)
    if (!existsSync(path)) {
      console.error(`sync-pages: ${path} does not exist`)
      process.exit(1)
    }
    return readFileSync(path)
  }
  const response = await fetch(`${RAW}/${source}`)
  if (!response.ok) {
    console.error(`sync-pages: ${RAW}/${source} returned ${response.status}`)
    process.exit(1)
  }
  return Buffer.from(await response.arrayBuffer())
}

const nextPages = new Map()
const wantedImages = new Set()

for (const page of PAGES) {
  const markdown = await loadText(page.source)

  if (!markdown.includes(page.sentinel)) {
    console.error(
      `sync-pages: ${page.source} does not contain ${JSON.stringify(page.sentinel)} — ` +
        `either it was renamed upstream or this is not the file we asked for`,
    )
    process.exit(1)
  }

  for (const [, target] of markdown.matchAll(/\]\((images\/[^)\s]+)\)/g)) {
    wantedImages.add(target)
  }

  const body = rewriteLinks(markdown, page.source)

  const unresolved = unresolvedLinks(body)
  if (unresolved.length) {
    console.error(
      `sync-pages: ${page.source} has links that will not resolve once ` +
        `published here:\n  ${unresolved.join('\n  ')}`,
    )
    process.exit(1)
  }

  nextPages.set(
    `docs${routeFor(page.source)}.md`,
    // editLink is switched off per page rather than globally: the button would
    // otherwise offer to edit this vendored copy, and that edit would be
    // overwritten by the next sync without anybody being told.
    '---\neditLink: false\n---\n\n' +
      `<!-- Synced from docs/${page.source} in the CertPilot repository by\n` +
      `     scripts/sync-pages.mjs. Edit it there, not here. -->\n\n` +
      body.trimEnd() +
      '\n',
  )
}

// Screenshots go in public/ rather than beside the markdown: VitePress copies
// that directory verbatim and applies `base` to absolute paths in markdown, so
// `/images/dashboard.png` resolves on the published subpath without every page
// having to know what the subpath is.
const nextImages = new Map()
for (const image of [...wantedImages].sort()) {
  nextImages.set(`docs/public/${image}`, await loadBinary(image))
}

const imageDir = join(root, 'docs/public/images')

function unchanged() {
  const pagesSame = [...nextPages].every(([target, body]) => {
    const path = join(root, target)
    return existsSync(path) && readFileSync(path, 'utf8') === body
  })
  const existing = existsSync(imageDir)
    ? readdirSync(imageDir).map((f) => `docs/public/images/${f}`).sort()
    : []
  const imagesSame =
    existing.length === nextImages.size &&
    [...nextImages].every(([target, bytes]) => {
      const path = join(root, target)
      return existsSync(path) && Buffer.compare(readFileSync(path), bytes) === 0
    })
  return pagesSame && imagesSame
}

const total = `${nextPages.size} page${nextPages.size === 1 ? '' : 's'}, ` +
  `${nextImages.size} image${nextImages.size === 1 ? '' : 's'}`

if (check) {
  if (unchanged()) {
    console.log(`sync-pages: up to date (${total})`)
    process.exit(0)
  }
  console.error('sync-pages: pages are stale — run `npm run sync:pages`')
  process.exit(1)
}

// Images are cleared first so one deleted upstream stops being served here.
// Pages are not: they are written by name, and a page dropped from PAGES is a
// deliberate act that should show up as a deletion in review.
rmSync(imageDir, { recursive: true, force: true })
for (const [target, body] of nextPages) {
  const path = join(root, target)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
}
for (const [target, bytes] of nextImages) {
  const path = join(root, target)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
}

console.log(`sync-pages: ${total} written`)
