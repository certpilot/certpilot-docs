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
  { source: 'templates.md', sentinel: '# Certificate templates' },

  // The platform pages. Their sentinels are the H1 rather than a section
  // heading, because all nine share "## What CertPilot does" and a sentinel
  // that matches nine files cannot detect the one thing a sentinel is for:
  // getting a different page than the one asked for.
  { source: 'platforms/README.md', sentinel: '# Supported platforms' },
  { source: 'platforms/nginx.md', sentinel: '# nginx' },
  { source: 'platforms/apache.md', sentinel: '# Apache httpd' },
  { source: 'platforms/haproxy.md', sentinel: '# HAProxy' },
  { source: 'platforms/caddy.md', sentinel: '# Caddy' },
  { source: 'platforms/tomcat.md', sentinel: '# Apache Tomcat' },
  { source: 'platforms/postgresql.md', sentinel: '# PostgreSQL' },
  { source: 'platforms/mariadb.md', sentinel: '# MariaDB and MySQL' },
  { source: 'platforms/postfix.md', sentinel: '# Postfix' },
  { source: 'platforms/dovecot.md', sentinel: '# Dovecot' },
]

/*
 * Upstream pages this site deliberately does not publish.
 *
 * Every upstream .md must be in PAGES or in here, and the coverage check below
 * fails the build otherwise. That rule exists because the alternative was in
 * place for months and nobody noticed: PAGES is a hand-written list, a page
 * added upstream was simply never mentioned again, and `--check` could not see
 * it because it only ever verified that *listed* pages were current. Eleven
 * pages were missing when this was written, including templates.md and the
 * whole platforms/ section — all of it prose somebody wrote for readers who
 * never got it.
 *
 * A silent omission in a generated asset is the same defect this repository has
 * hit twice before. Opting a page out is now a line of code with a reason
 * beside it.
 */
const UNPUBLISHED = new Map([
  ['api-reference.md',
    'split across the generated endpoint reference by sync-guides.mjs; ' +
    'publishing it whole as well would give a reader two accounts of the same endpoint'],
  ['README.md',
    "the upstream index; this site has its own, and a directory listing of a " +
    'repository is not a landing page'],
])

/**
 * `security.md` -> `/security`, `gateways/vault.md` -> `/gateways/vault`, and
 * `platforms/README.md` -> `/platforms/`.
 *
 * The README case matters: published as `/platforms/README` it would be a page
 * whose URL says "README", and every link to `platforms/README.md` from a
 * sibling page would have to know that. As a directory index it is the address
 * people already guess.
 */
const routeFor = (source) =>
  '/' + source.replace(/(^|\/)README\.md$/, '$1').replace(/\.md$/, '')

/** Where a published page is written. `/platforms/` -> `docs/platforms/index.md`. */
const fileFor = (source) => {
  const route = routeFor(source)
  return `docs${route.endsWith('/') ? route + 'index' : route}.md`
}

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

/*
 * Stop Vue from eating a documented placeholder.
 *
 * VitePress compiles every page as a Vue template, so `{{ .Certificate }}` —
 * which is a real thing the agent's install spec supports and which agent.md
 * has to be able to print — is parsed as a JavaScript expression and fails the
 * build with "Unexpected token". Fenced code blocks are safe already, because
 * VitePress renders them with v-pre. Inline code and prose are not.
 *
 * So the mustaches that survive outside a fence are wrapped in v-pre, which is
 * Vue's own way of saying "this is text". HTML-escaping them instead would be
 * wrong in the place it matters most: inside backticks the entity would be
 * shown literally, and a reader would copy `&#123;&#123; .Certificate }}` into
 * their installs.json.
 */
function neutraliseMustaches(markdown) {
  // Odd-numbered segments are inside a fence; leave those exactly as they are.
  return markdown
    .split(/(```[\s\S]*?```)/g)
    .map((segment, i) => {
      if (i % 2 === 1) return segment
      return segment
        .replace(/`([^`\n]*\{\{[^`\n]*)`/g, '<code v-pre>$1</code>')
        .replace(/(^|[^>])(\{\{[^}\n]*\}\})/g, '$1<span v-pre>$2</span>')
    })
    .join('')
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

/*
 * Every upstream page is accounted for, or this fails.
 *
 * The check `--check` used to run compared the *published* pages against what
 * is checked in here, which is a drift check with a hole in exactly the shape
 * of new content: a page nobody listed was a page nobody could notice. This
 * closes it from the other side — enumerate what upstream actually has, and
 * insist every file is either published or opted out with a reason.
 */
async function upstreamPages() {
  if (localDir) {
    const walk = (dir, prefix = '') => {
      const out = []
      for (const entry of readdirSync(join(localDir, dir), { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel))
        else if (entry.name.endsWith('.md')) out.push(rel)
      }
      return out
    }
    return walk('.')
  }

  // The tree API rather than the contents API: one request for the whole
  // repository instead of one per directory, and it does not miss a page in a
  // subdirectory nobody thought to look in.
  const url = 'https://api.github.com/repos/certpilot/certpilot/git/trees/main?recursive=1'
  const headers = { accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const response = await fetch(url, { headers })
  if (!response.ok) {
    console.error(`sync-pages: listing upstream returned ${response.status} — cannot verify coverage`)
    process.exit(1)
  }
  const { tree, truncated } = await response.json()
  if (truncated) {
    console.error('sync-pages: the upstream tree listing was truncated, so coverage cannot be trusted')
    process.exit(1)
  }
  return tree
    .filter((n) => n.type === 'blob' && n.path.startsWith('docs/') && n.path.endsWith('.md'))
    .map((n) => n.path.slice('docs/'.length))
}

const upstream = await upstreamPages()
const unaccounted = upstream
  .filter((source) => !published.has(source) && !UNPUBLISHED.has(source))
  .sort()

if (unaccounted.length) {
  console.error(
    'sync-pages: upstream has pages this site neither publishes nor opts out of:\n' +
      unaccounted.map((s) => `  docs/${s}`).join('\n') +
      '\n\nAdd each one to PAGES, or to UNPUBLISHED with the reason it stays behind.',
  )
  process.exit(1)
}

// And the other direction: a page listed here that upstream no longer has
// would otherwise fail later, in a fetch, with a 404 that reads like an outage.
const vanished = PAGES.map((p) => p.source).filter((s) => !upstream.includes(s))
if (vanished.length) {
  console.error(
    'sync-pages: these are published here and no longer exist upstream:\n' +
      vanished.map((s) => `  docs/${s}`).join('\n'),
  )
  process.exit(1)
}

/*
 * And the third way a page can fail to reach anybody: published, current, and
 * in no sidebar. Search and inbound links would still find it; nobody browsing
 * would. The sidebar is hand-ordered on purpose — a generated one would be
 * alphabetical, and "Apache Tomcat" does not belong between "Apache httpd" and
 * "Caddy" just because of how it is spelled — so the list is written by a
 * person and checked by this.
 */
const navLinks = new Set(
  JSON.parse(readFileSync(join(root, 'docs/.vitepress/guide-sidebar.json'), 'utf8'))
    .flatMap((group) => group.items.map((item) => item.link)),
)
const unreachable = PAGES
  .map((p) => routeFor(p.source))
  .filter((route) => !navLinks.has(route))

if (unreachable.length) {
  console.error(
    'sync-pages: these pages are published and in no sidebar, so nobody browsing will find them:\n' +
      unreachable.map((r) => `  ${r}`).join('\n') +
      '\n\nAdd each to docs/.vitepress/guide-sidebar.json.',
  )
  process.exit(1)
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

  const body = neutraliseMustaches(rewriteLinks(markdown, page.source))

  const unresolved = unresolvedLinks(body)
  if (unresolved.length) {
    console.error(
      `sync-pages: ${page.source} has links that will not resolve once ` +
        `published here:\n  ${unresolved.join('\n  ')}`,
    )
    process.exit(1)
  }

  nextPages.set(
    fileFor(page.source),
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
