// Refresh the per-resource guide fragments from the CertPilot repository.
//
// `docs/api-reference.md` in the code repository is where the deep prose lives:
// what to send, what comes back, and why an endpoint behaves the way it does.
// It is two thousand lines of genuinely good explanation that, until now, was
// readable only by somebody who had cloned the code — which is precisely the
// audience that needs it least.
//
// This splits it on its H2 headings into one fragment per resource, so the
// generator can set each fragment beside the route table for the same resource.
// A reader then has the table and the examples on one page instead of holding
// two sites open.
//
// Same vendoring trade as routes.json: the docs build must not need a checkout
// of the code, so the fragments are committed here and this script closes the
// gap. `--check` is what CI runs.
//
//   node scripts/sync-guides.mjs                 # fetch from the default branch
//   node scripts/sync-guides.mjs --check         # exit 1 if it would change
//   CERTPILOT_GUIDE_PATH=../pki_project/docs/api-reference.md node scripts/sync-guides.mjs

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'guides')

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
  process.env.CERTPILOT_GUIDE_URL ??
  `https://raw.githubusercontent.com/certpilot/certpilot/${REF}/docs/api-reference.md`

const localPath = process.env.CERTPILOT_GUIDE_PATH
const check = process.argv.includes('--check')

/*
 * H2 heading in api-reference.md -> section name in routes.json.
 *
 * The two vocabularies were written years apart and do not match: the prose
 * says "PKI and CA authorities" where the router says "PKI / CA Management".
 * Mapping them by hand is the honest option; matching on a fuzzy slug would
 * silently attach the wrong prose to a resource the first time someone renames
 * a heading, and a reader has no way to notice that.
 */
const SECTION_FOR_HEADING = {
  'Dashboard': 'Dashboard',
  'Live event stream': 'Live event stream',
  'Certificates': 'Certificates',
  'PKI and CA authorities': 'PKI / CA Management',
  'CA accounts and gateways': 'CA Accounts & Gateways',
  'Discovery': 'Discovery',
  'Certificate Transparency': 'Certificate Transparency',
  'Cloud inventory': 'Cloud inventory',
  'Renewal queue': 'Renewal queue',
  'Deployment': 'Deployment',
  'Agents': 'Agents',
  'Notification channels': 'Notification channels',
  'Policies': 'Policies',
  'Display tokens': 'Display Tokens',

  /*
   * Two headings whose routes live under a resource that already has prose, so
   * they append rather than getting a page nobody links to. Ownership and
   * acknowledgement are operations on an authority; the posture endpoints are
   * filed under Deployment by the router, and following the router is the
   * whole point of generating from it.
   */
  'Ownership and acknowledgement': 'PKI / CA Management',
  'Cryptographic posture': 'Deployment',
}

/*
 * Headings deliberately not carried across.
 *
 * These already have hand-written pages on this site that say the same thing
 * better, in the place a reader looks for them. Importing them would produce
 * two accounts of how authentication works, and the one a reader found first
 * would be a coin toss.
 */
const SKIP = new Set([
  'Authentication',
  'Authorization',
  'Errors',
  'Secrets in responses',
  'Response headers',
])

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const CODE_TREE = 'https://github.com/certpilot/certpilot/blob/main'

/*
 * Cross-references out of the imported prose.
 *
 * In the source everything was one page, so a link to another section was a
 * plain anchor. Split across pages here, an anchor into a section this script
 * skips points at nothing — and because the site fails the build on a dead
 * link, that surfaces immediately rather than shipping.
 *
 * Anything not listed here is a hard error rather than a guess: silently
 * dropping the link would leave prose promising an explanation it no longer
 * points to.
 */
const ANCHOR_TO_PAGE = {
  'authenticating-an-unattended-screen': '/api/display-tokens',
}

/**
 * Point repository-relative links at the code on GitHub.
 *
 * The prose was written to sit in `docs/` inside the code repository, so a link
 * to `../pkg/agentauth` resolved to a real directory. Published here it
 * resolves to nothing, and because this site fails the build on a dead link
 * rather than shipping one, importing the prose unedited broke the build
 * immediately — which is the good outcome. Rewriting them is the fix; turning
 * the check off would have shipped two links that quietly went nowhere.
 */
function absolutiseLinks(md) {
  return md.replace(/\]\((\.{1,2}\/[^)]+)\)/g, (whole, target) => {
    // `../` is relative to docs/, so it lands at the repository root.
    const clean = target.replace(/^\.\//, '').replace(/^\.\.\//, '')
    return `](${CODE_TREE}/${clean})`
  })
}

/**
 * Drop the ASCII route listing each resource opens with.
 *
 * In the source these were the only route table there was. Here the generated
 * one sits directly above, extracted from the router, and says the same thing
 * with the roles filled in and every path linked. Keeping both gives a reader
 * two tables to reconcile, and the ASCII one is the one that can be wrong.
 *
 * It was also the widest thing on the page: an unfenced block of aligned
 * columns that overflowed its container and cut the role annotations off.
 *
 * Only an unlabelled block whose every line begins with an HTTP method is
 * removed, so a JSON body or a shell example is never touched.
 */
function dropRouteListing(md) {
  return md.replace(/^```\n([\s\S]*?)^```\n/gm, (whole, inner) => {
    const lines = inner.split('\n').filter((l) => l.trim())
    if (!lines.length) return whole
    const allRoutes = lines.every((l) =>
      /^\s*(GET|POST|PUT|PATCH|DELETE)\s+\//.test(l),
    )
    return allRoutes ? '' : whole
  })
}

async function load() {
  if (localPath) {
    if (!existsSync(localPath)) {
      console.error(`sync-guides: ${localPath} does not exist`)
      process.exit(1)
    }
    return readFileSync(localPath, 'utf8')
  }
  const response = await fetch(SOURCE)
  if (!response.ok) {
    console.error(`sync-guides: ${SOURCE} returned ${response.status}`)
    process.exit(1)
  }
  return response.text()
}

/*
 * Which commit the guides came from — see provenance() in sync-pages.mjs for
 * why it is the last commit to change api-reference.md rather than the ref this
 * run read at. Recorded in each guide's header, where a maintainer tracing a
 * claim back to its source will look.
 */
async function provenance() {
  if (localPath) {
    try {
      const out = execFileSync('git', ['-C', dirname(localPath), 'log', '-1', '--format=%H%x09%cI', '--', localPath.split('/').pop()],
        { encoding: 'utf8' }).trim()
      if (out) {
        const [commit, date] = out.split('\t')
        return { commit, date }
      }
    } catch {}
    return null
  }
  // A caller-supplied URL could be anything; there is no commit to name for it.
  if (process.env.CERTPILOT_GUIDE_URL) return null
  const url = `https://api.github.com/repos/certpilot/certpilot/commits?path=docs/api-reference.md&sha=${REF}&per_page=1`
  const headers = { accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const response = await fetch(url, { headers })
  if (!response.ok) {
    console.error(`sync-guides: asking which commit last changed api-reference.md returned ${response.status}` +
      (response.status === 403 || response.status === 429 ? ' — set GITHUB_TOKEN' : ''))
    process.exit(1)
  }
  const [latest] = await response.json()
  return latest ? { commit: latest.sha, date: latest.commit.committer.date } : null
}

const markdown = await load()
const from = await provenance()

// A 404 page served with a 200 would otherwise replace every guide with an
// HTML error document, and only fail later during the build.
if (!markdown.includes('## Certificates')) {
  console.error('sync-guides: source does not look like api-reference.md')
  process.exit(1)
}

/** Split on H2, ignoring headings inside fenced code. */
function splitSections(md) {
  const out = []
  let current = null
  let fenced = false

  for (const line of md.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced
    const heading = !fenced && /^## (?!#)(.+)$/.exec(line)
    if (heading) {
      if (current) out.push(current)
      current = { heading: heading[1].trim(), lines: [] }
      continue
    }
    if (current) current.lines.push(line)
  }
  if (current) out.push(current)
  return out
}

const sections = splitSections(markdown)
const written = new Map()
const unmapped = []

for (const section of sections) {
  if (SKIP.has(section.heading)) continue

  const target = SECTION_FOR_HEADING[section.heading]
  if (!target) {
    unmapped.push(section.heading)
    continue
  }

  /*
   * Promote every heading by one level.
   *
   * In the source these sit under an H2 for the resource. On the generated page
   * the resource is the H1, so the same headings belong at H2 — level with
   * "Endpoint detail" rather than buried under it.
   *
   * This was demoted first, which put every one of them at H4. The site's
   * outline is configured for levels 2 and 3, so ninety lines of prose per page
   * had no entry in the table of contents at all: present, and unnavigable.
   */
  const body = absolutiseLinks(dropRouteListing(section.lines.join('\n')))
    .replace(/^(#{3,6}) /gm, (_, hashes) => `${'#'.repeat(hashes.length - 1)} `)
    .trim()

  const key = slug(target)
  const prior = written.get(key)
  written.set(
    key,
    prior
      ? {
          section: target,
          heading: `${prior.heading}", "${section.heading}`,
          body: `${prior.body}\n\n## ${section.heading}\n\n${body}`,
        }
      : { section: target, heading: section.heading, body },
  )
}

/**
 * Repoint anchors that no longer resolve inside their own fragment.
 *
 * `#foo` was valid when the whole reference was a single page. Here it must
 * either match a heading in this same fragment or be repointed at the page that
 * carries it now.
 */
function fixAnchors(name, body) {
  const own = new Set(
    [...body.matchAll(/^#{2,6} (.+)$/gm)].map(([, h]) => slug(h.trim())),
  )
  return body.replace(/\]\(#([a-z0-9-]+)\)/g, (whole, anchor) => {
    if (own.has(anchor)) return whole
    const page = ANCHOR_TO_PAGE[anchor]
    if (!page) {
      console.error(
        `sync-guides: ${name} links to #${anchor}, which is not a heading in ` +
          `that section and has no entry in ANCHOR_TO_PAGE`,
      )
      process.exit(1)
    }
    return `](${page})`
  })
}

for (const [name, entry] of written) {
  entry.body = fixAnchors(name, entry.body)
}

if (unmapped.length) {
  console.log(`sync-guides: no route section for — ${unmapped.join(', ')}`)
}

// Rendered to compare against what is on disk before anything is written, so
// --check can be honest and a no-op run leaves no diff.
const next = new Map()
for (const [name, { section, heading, body }] of written) {
  next.set(
    `${name}.md`,
    `<!-- Synced from docs/api-reference.md in certpilot/certpilot` +
      (from ? ` at ${from.commit.slice(0, 12)}, last changed ${from.date}` : '') + `.\n` +
      `     Source heading: "${heading}". Edit it there, not here. -->\n\n${body}\n`,
  )
}

const existing = new Map()
if (existsSync(outDir)) {
  for (const file of readdirSync(outDir)) {
    if (file.endsWith('.md')) existing.set(file, readFileSync(join(outDir, file), 'utf8'))
  }
}

const same =
  existing.size === next.size &&
  [...next].every(([file, body]) => existing.get(file) === body)

if (check) {
  if (same) {
    console.log(`sync-guides: up to date (${next.size} guides)`)
    process.exit(0)
  }
  console.error('sync-guides: guides are stale — run `npm run sync:guides`')
  process.exit(1)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
for (const [file, body] of next) writeFileSync(join(outDir, file), body)

console.log(
  `sync-guides: ${next.size} guides written` + (same ? ' (no change)' : ''),
)
