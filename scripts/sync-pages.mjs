// Publish whole pages, and their screenshots, from the CertPilot repositories.
//
// The code carries about four thousand lines of documentation that were
// readable only by somebody who had already cloned it — precisely the audience
// that needs them least. This publishes them without moving them: prose about
// the system that lives beside the system gets updated by the person changing
// it, and prose that lives in a different repository does not.
//
// Which is why there is more than one upstream. The host agent moved to
// certpilot-agent, and its pages went with it — the same principle applied to
// a repository split rather than abandoned because of one. So this reads from
// several repositories into one site: a page's *source path* is its identity
// here, and which repository it comes from is a property of the page.
//
// Same vendoring trade as routes.json and the guides: the docs build must not
// need a checkout of the code, so the result is committed here and this script
// closes the gap. `--check` is what CI runs.
//
//   node scripts/sync-pages.mjs                 # fetch from each default branch
//   node scripts/sync-pages.mjs --check         # exit 1 if it would change
//   CERTPILOT_DOCS_DIR=../certpilot/docs \
//     CERTPILOT_AGENT_DOCS_DIR=../certpilot-agent/docs node scripts/sync-pages.mjs

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

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
 * The dispatch carries the commit that triggered it, so the ref pins every
 * request to that SHA. A SHA-addressed URL cannot go stale, because the content
 * behind it never changes. Falling back to main keeps the scheduled run and a
 * local run working, where there is no dispatch and the cache has had time to
 * settle anyway.
 *
 * Only the repository that dispatched is pinned. The other one had no merge
 * just now, so there is no cache race to avoid there and main is what its
 * readers should get.
 */
const CORE = 'certpilot/certpilot'
const AGENT = 'certpilot/certpilot-agent'

const UPSTREAMS = {
  [CORE]: {
    ref: process.env.CERTPILOT_REF || 'main',
    localDir: process.env.CERTPILOT_DOCS_DIR,
  },
  [AGENT]: {
    ref: process.env.CERTPILOT_AGENT_REF || 'main',
    localDir: process.env.CERTPILOT_AGENT_DOCS_DIR,
  },
}

/** Where a page's markdown is fetched from. */
const rawBase = (repo) =>
  `https://raw.githubusercontent.com/${repo}/${UPSTREAMS[repo].ref}/docs`

// The code links stay on main: they are for a reader following a reference to
// the source, who wants the current file rather than the one at a past commit.
// Per repository, because a link out of an agent page means a file in the
// agent's repository — pointing it at the core would be a 404 that looks like
// a working link.
const codeTree = (repo) => `https://github.com/${repo}/blob/main`

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
 *
 * `repo` says which repository the page is read from, and defaults to the core.
 * The source path is unaffected by it: `platforms/iis.md` is that page's
 * identity on this site whichever repository holds it, which is what lets a
 * page move between repositories without its URL changing or every link to it
 * needing an edit.
 */
const PAGES = [
  { source: 'evaluation.md', sentinel: '## 1. Start it' },
  { source: 'getting-started.md', sentinel: '## 1. Generate development keys' },
  { source: 'architecture.md', sentinel: '## Decision 1 — a gateway is a process, not a package' },
  { source: 'discovery.md', sentinel: '## Certificate Transparency' },
  { source: 'monitoring.md', sentinel: '## Expiry thresholds' },
  { source: 'deployment.md', sentinel: '## Rollout order' },
  { source: 'agent.md', sentinel: '## Enrolment', repo: AGENT },
  { source: 'posture.md', sentinel: '# Cryptographic posture' },
  { source: 'gateways/vault.md', sentinel: '# The Vault gateway' },
  { source: 'gateways/acme.md', sentinel: '# The ACME gateway' },
  { source: 'gateways/selfsigned.md', sentinel: '# The self-signed gateway' },
  { source: 'writing-a-gateway.md', sentinel: '# Writing a gateway' },
  // Not a heading, unlike every other sentinel here. That page's H1 changed
  // when the agent's rows joined the gateway rows on it, and a sentinel that
  // only matches the new H1 would mean this repository and the core's had to
  // merge in the same instant. The table header is in both.
  { source: 'compatibility.md', sentinel: '| Gateway | Version | Contract |' },
  { source: 'repositories.md', sentinel: '# Repositories' },
  { source: 'configuration.md', sentinel: '# Configuration reference' },
  { source: 'operations.md', sentinel: '# Operations' },
  { source: 'security.md', sentinel: '# Security model' },
  { source: 'database.md', sentinel: '# Running CertPilot against a database' },
  { source: 'troubleshooting.md', sentinel: '# Troubleshooting' },
  { source: 'status.md', sentinel: '# Implementation status' },
  { source: 'templates.md', sentinel: '# Certificate templates' },

  // The platform pages. Their sentinels are the H1 rather than a section
  // heading, because the Linux ones all share "## What CertPilot does" and a
  // sentinel that matches nine files cannot detect the one thing a sentinel is
  // for: getting a different page than the one asked for.
  // The walkthroughs. Sentinels are the H1: they are the only headings on those
  // pages that are not shared with a sibling — every one of them has a
  // "Prerequisites" and a "Limitations".
  { source: 'walkthroughs/README.md', sentinel: '# Walkthroughs' },
  { source: 'walkthroughs/vault-nginx.md', sentinel: '# Vault to nginx' },
  { source: 'walkthroughs/acme-nginx.md', sentinel: '# ACME to nginx' },
  { source: 'walkthroughs/windows-iis.md', sentinel: '# Windows and IIS' },
  { source: 'walkthroughs/ca-expiry.md', sentinel: '# A CA is expiring' },
  { source: 'walkthroughs/failed-renewal.md', sentinel: '# A renewal or deployment failed' },

  { source: 'platforms/README.md', sentinel: '# Supported platforms', repo: AGENT },
  { source: 'platforms/nginx.md', sentinel: '# nginx', repo: AGENT },
  { source: 'platforms/apache.md', sentinel: '# Apache httpd', repo: AGENT },
  { source: 'platforms/haproxy.md', sentinel: '# HAProxy', repo: AGENT },
  { source: 'platforms/caddy.md', sentinel: '# Caddy', repo: AGENT },
  { source: 'platforms/tomcat.md', sentinel: '# Apache Tomcat', repo: AGENT },
  { source: 'platforms/postgresql.md', sentinel: '# PostgreSQL', repo: AGENT },
  { source: 'platforms/mariadb.md', sentinel: '# MariaDB and MySQL', repo: AGENT },
  { source: 'platforms/postfix.md', sentinel: '# Postfix', repo: AGENT },
  { source: 'platforms/dovecot.md', sentinel: '# Dovecot', repo: AGENT },
  { source: 'platforms/iis.md', sentinel: '# Microsoft IIS', repo: AGENT },
].map((page) => ({ repo: CORE, ...page }))

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
  [`${CORE}:api-reference.md`,
    'split across the generated endpoint reference by sync-guides.mjs; ' +
    'publishing it whole as well would give a reader two accounts of the same endpoint'],
  [`${CORE}:README.md`,
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

/**
 * Every source path this run publishes, and which repository it comes from.
 *
 * One owner per path. Two repositories claiming the same page is a
 * configuration error rather than something to resolve by ordering — whichever
 * won would depend on the order of this list, and the loser would be edited by
 * somebody who then could not find their change on the site.
 */
const published = new Map()
for (const page of PAGES) {
  const owner = published.get(page.source)
  if (owner) {
    console.error(
      `sync-pages: ${page.source} is published from both ${owner} and ` +
        `${page.repo}. A page has one source of truth.`,
    )
    process.exit(1)
  }
  published.set(page.source, page.repo)
}

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
function rewriteLink(target, fromSource, fromRepo) {
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
  return `${codeTree(fromRepo)}/${clean}${anchor}`
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

function rewriteLinks(markdown, fromSource, fromRepo) {
  return markdown.replace(
    /\]\(([^)\s]+)(\s+"[^"]*")?\)/g,
    (whole, target, title = '') => {
      const next = rewriteLink(target, fromSource, fromRepo)
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

/** Read a file from one upstream: a local checkout if given one, else raw.github. */
async function load(repo, source, binary = false) {
  const { localDir } = UPSTREAMS[repo]
  if (localDir) {
    const path = join(localDir, source)
    if (!existsSync(path)) {
      console.error(`sync-pages: ${path} does not exist (${repo})`)
      process.exit(1)
    }
    return binary ? readFileSync(path) : readFileSync(path, 'utf8')
  }
  const url = `${rawBase(repo)}/${source}`
  const response = await fetch(url)
  if (!response.ok) {
    console.error(`sync-pages: ${url} returned ${response.status}`)
    process.exit(1)
  }
  return binary ? Buffer.from(await response.arrayBuffer()) : response.text()
}

const loadText = (repo, source) => load(repo, source)

/*
 * Which commit each page came from.
 *
 * A published page used to say which repository and file it came from and
 * nothing about *when*. So a reader could not tell whether the page in front of
 * them reflected last week's code or last year's, and a maintainer chasing a
 * wrong claim could not tell which upstream revision had made it.
 *
 * The commit recorded is the last one that changed the page's source file — not
 * the ref this run synced at. The ref moves with every upstream commit, and a
 * page that recorded it would change, and fail `--check`, every time somebody
 * merged anything upstream. The last commit to touch the file moves only when
 * the file does, so an unchanged page stays byte-for-byte unchanged.
 *
 * The commit's date becomes the page's `lastUpdated`. Without it VitePress
 * shows when *this* repository's copy was last written — the sync, not the
 * change — which was a claim about freshness that the page could not back.
 */
async function provenance(repo, source) {
  const { localDir, ref } = UPSTREAMS[repo]
  if (localDir) {
    const git = (...args) => {
      try {
        return execFileSync('git', ['-C', localDir, ...args], { encoding: 'utf8' }).trim()
      } catch {
        return ''
      }
    }
    const last = git('log', '-1', '--format=%H%x09%cI', '--', source)
    if (!last) {
      console.error(
        `sync-pages: ${join(localDir, source)} has no commit in its checkout, so there is ` +
          `no revision to say it came from. Commit it before syncing.`,
      )
      process.exit(1)
    }
    const [commit, date] = last.split('\t')
    // A local sync is for previewing. It is never committed here — `--check`
    // compares against the remote, which never produces this — but when it is
    // on screen it should not claim to be a commit it is not.
    const dirty = git('status', '--porcelain', '--', source) !== ''
    return { commit, date, dirty }
  }

  const path = ['docs', ...source.split('/')].map(encodeURIComponent).join('/')
  const url = `https://api.github.com/repos/${repo}/commits?path=${path}&sha=${ref}&per_page=1`
  const headers = { accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const response = await fetch(url, { headers })
  if (!response.ok) {
    console.error(
      `sync-pages: asking ${repo} which commit last changed docs/${source} returned ` +
        `${response.status}` +
        (response.status === 403 || response.status === 429
          ? ' — most likely the unauthenticated rate limit. Set GITHUB_TOKEN.'
          : ''),
    )
    process.exit(1)
  }
  const [latest] = await response.json()
  if (!latest) {
    console.error(`sync-pages: no commit on ${repo}@${ref} has ever changed docs/${source}`)
    process.exit(1)
  }
  return { commit: latest.sha, date: latest.commit.committer.date, dirty: false }
}

const loadBinary = (repo, source) => load(repo, source, true)

/*
 * Every upstream page is accounted for, or this fails.
 *
 * The check `--check` used to run compared the *published* pages against what
 * is checked in here, which is a drift check with a hole in exactly the shape
 * of new content: a page nobody listed was a page nobody could notice. This
 * closes it from the other side — enumerate what upstream actually has, and
 * insist every file is either published or opted out with a reason.
 */
async function upstreamPages(repo) {
  const { localDir, ref } = UPSTREAMS[repo]
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
  const url = `https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`
  const headers = { accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const response = await fetch(url, { headers })
  if (!response.ok) {
    console.error(
      `sync-pages: listing ${repo} returned ${response.status} — cannot verify coverage`,
    )
    process.exit(1)
  }
  const { tree, truncated } = await response.json()
  if (truncated) {
    console.error(`sync-pages: the tree listing for ${repo} was truncated, so coverage cannot be trusted`)
    process.exit(1)
  }
  return tree
    .filter((n) => n.type === 'blob' && n.path.startsWith('docs/') && n.path.endsWith('.md'))
    .map((n) => n.path.slice('docs/'.length))
}

const upstream = new Map()
for (const repo of Object.keys(UPSTREAMS)) {
  upstream.set(repo, await upstreamPages(repo))
}

/*
 * Every upstream page is accounted for, per repository.
 *
 * A page is accounted for if this site publishes it *from that repository*, if
 * it is opted out there, or if some other repository publishes the same path.
 * That last clause is what makes a page able to move: for the window between a
 * page arriving in its new repository and the old copy being deleted, the old
 * copy is a leftover rather than an unpublished page, and a leftover is not the
 * failure this check exists to catch. It is still worth seeing, so it is
 * reported below rather than passed over in silence.
 */
const unaccounted = []
const leftovers = []
for (const [repo, sources] of upstream) {
  for (const source of sources) {
    const owner = published.get(source)
    if (owner === repo) continue
    if (UNPUBLISHED.has(`${repo}:${source}`)) continue
    if (owner) { leftovers.push(`  ${repo} docs/${source} — published from ${owner}`); continue }
    unaccounted.push(`  ${repo} docs/${source}`)
  }
}

if (unaccounted.length) {
  console.error(
    'sync-pages: upstream has pages this site neither publishes nor opts out of:\n' +
      unaccounted.sort().join('\n') +
      '\n\nAdd each one to PAGES, or to UNPUBLISHED with the reason it stays behind.',
  )
  process.exit(1)
}

if (leftovers.length) {
  console.warn(
    'sync-pages: these pages still exist in a repository that no longer owns them:\n' +
      leftovers.sort().join('\n') +
      '\n\nNobody reads them; delete them where they were left.',
  )
}

// And the other direction: a page listed here that its repository no longer has
// would otherwise fail later, in a fetch, with a 404 that reads like an outage.
const vanished = PAGES
  .filter((p) => !upstream.get(p.repo).includes(p.source))
  .map((p) => `  ${p.repo} docs/${p.source}`)
if (vanished.length) {
  console.error(
    'sync-pages: these are published here and no longer exist upstream:\n' +
      vanished.sort().join('\n'),
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
// Keyed by repository as well as path: an image travels with the page that
// referenced it, and two repositories can hold different files under the same
// name. Resolved below, where a collision is a hard error rather than whichever
// one was fetched last.
const wantedImages = new Map()

for (const page of PAGES) {
  const markdown = await loadText(page.repo, page.source)

  if (!markdown.includes(page.sentinel)) {
    console.error(
      `sync-pages: ${page.repo} docs/${page.source} does not contain ` +
        `${JSON.stringify(page.sentinel)} — either it was renamed upstream or ` +
        `this is not the file we asked for`,
    )
    process.exit(1)
  }

  for (const [, target] of markdown.matchAll(/\]\((images\/[^)\s]+)\)/g)) {
    const owner = wantedImages.get(target)
    if (owner && owner !== page.repo) {
      console.error(
        `sync-pages: ${target} is referenced from both ${owner} and ${page.repo}, ` +
          `and this site can only serve one file at that path.`,
      )
      process.exit(1)
    }
    wantedImages.set(target, page.repo)
  }

  const body = neutraliseMustaches(rewriteLinks(markdown, page.source, page.repo))

  const unresolved = unresolvedLinks(body)
  if (unresolved.length) {
    console.error(
      `sync-pages: ${page.repo} docs/${page.source} has links that will not ` +
        `resolve once published here:\n  ${unresolved.join('\n  ')}`,
    )
    process.exit(1)
  }

  const from = await provenance(page.repo, page.source)
  nextPages.set(
    fileFor(page.source),
    // editLink is switched off per page rather than globally: the button would
    // otherwise offer to edit this vendored copy, and that edit would be
    // overwritten by the next sync without anybody being told.
    //
    // `source` is the provenance, as data a theme component or a script can
    // read; `lastUpdated` is its date, which VitePress shows in the footer.
    '---\neditLink: false\n' +
      `lastUpdated: ${from.date}\n` +
      `source:\n  repo: ${page.repo}\n  path: docs/${page.source}\n  commit: ${from.commit}\n` +
      (from.dirty ? '  uncommitted: true\n' : '') +
      '---\n\n' +
      `<!-- Synced from docs/${page.source} in ${page.repo} at ${from.commit.slice(0, 12)}` +
      `${from.dirty ? ' plus uncommitted changes' : ''},\n` +
      `     last changed ${from.date}, by scripts/sync-pages.mjs. Edit it there, not here. -->\n\n` +
      body.trimEnd() +
      '\n',
  )
}

// Screenshots go in public/ rather than beside the markdown: VitePress copies
// that directory verbatim and applies `base` to absolute paths in markdown, so
// `/images/dashboard.png` resolves on the published subpath without every page
// having to know what the subpath is.
const nextImages = new Map()
for (const [image, repo] of [...wantedImages].sort()) {
  nextImages.set(`docs/public/${image}`, await loadBinary(repo, image))
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
