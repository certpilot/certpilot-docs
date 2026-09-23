// Every link on the built site lands somewhere — the page, the anchor, the file.
//
// VitePress fails the build on a link to a page that does not exist and says
// nothing about a link to a heading that does not exist. That gap shipped three
// dead links from the code repository's own guides: `#5-issue-from-a-real-ca`
// and two like it, correct on GitHub and dead here, because this renderer
// prefixes `_` to a heading slug that starts with a digit. The build was green,
// the pages published, and a reader clicking one landed at the top of the right
// page with no way to tell the paragraph they wanted was further down.
//
// So this reads what a reader actually gets — the HTML in dist/ — rather than
// the markdown. The markdown-side check in the code repository can only guess
// how a heading will be slugged; this one does not have to.
//
// It replaces an older anchor check in check-drift.mjs that did two things this
// must not:
//
//   - It covered api/reference/ and nothing else, so a cross-page anchor from a
//     guide was never looked at. All three dead links were cross-page.
//   - It printed "no build output — skipping" and exited 0 when dist/ was
//     absent. A check that passes when it could not run is indistinguishable,
//     in a CI log, from one that ran and found nothing. It also caught *every*
//     error that way, so a renamed output directory would have turned it off
//     for good without anybody noticing.
//
// Here, a missing or empty build is a failure with a message saying what to do.
//
//   npm run build && node scripts/check-built-links.mjs
//   node scripts/check-built-links.mjs --dist path/to/dist   # e.g. the self-test
//
// Exit status: 0 clean, 1 dead links found, 2 nothing to check.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Read from the config rather than repeated here: a base changed in one place
// and not the other would make every internal link look external, and the check
// would pass by checking nothing.
const configSource = readFileSync(join(root, 'docs/.vitepress/config.ts'), 'utf8')
const base = configSource.match(/base:\s*'([^']+)'/)?.[1]
if (!base) {
  console.error('check-built-links: could not read `base` from docs/.vitepress/config.ts')
  process.exit(2)
}

const distArg = process.argv.indexOf('--dist')
const dist = resolve(distArg > -1 ? process.argv[distArg + 1] : join(root, 'docs/.vitepress/dist'))

/** Every .html file under a directory. */
function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return htmlFiles(full)
    return entry.name.endsWith('.html') ? [full] : []
  })
}

if (!existsSync(dist) || !statSync(dist).isDirectory()) {
  console.error(`check-built-links: no build output at ${relative(root, dist) || dist}.`)
  console.error('Run `npm run build` first. This check does not skip when there is nothing to read.')
  process.exit(2)
}
const pages = htmlFiles(dist)
if (pages.length === 0) {
  console.error(`check-built-links: ${relative(root, dist)} contains no HTML — the build produced nothing.`)
  process.exit(2)
}

// Parsed once each: a site where every page links to operations.html would
// otherwise read and scan it once per link.
const idCache = new Map()
function idsOf(file) {
  if (!idCache.has(file)) {
    const html = readFileSync(file, 'utf8')
    idCache.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])))
  }
  return idCache.get(file)
}

/**
 * Where a site path is served from, the way VitePress's cleanUrls serves it:
 * `/x` from x.html, `/x/` from x/index.html, and anything with an extension —
 * an image, a stylesheet — from itself.
 */
function fileFor(sitePath) {
  const path = decodeURIComponent(sitePath)
  const candidates = path.endsWith('/')
    ? [join(dist, path, 'index.html')]
    : [join(dist, path), join(dist, `${path}.html`), join(dist, path, 'index.html')]
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null
}

const problems = []
let checked = 0

for (const page of pages) {
  const html = readFileSync(page, 'utf8')
  const from = relative(dist, page)

  // href and src both: an image that 404s is as broken as a link that does.
  for (const [, attr, target] of html.matchAll(/\s(href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|tel:|data:|javascript:)/.test(target)) continue

    const [pathPart, anchor] = target.split('#', 2)
    checked++

    if (pathPart === '') {
      if (anchor && !idsOf(page).has(decodeURIComponent(anchor))) {
        problems.push(`${from}: ${attr}="#${anchor}" — no element on this page has that id`)
      }
      continue
    }

    if (!pathPart.startsWith(base)) {
      // Everything VitePress emits is rooted at the base. A root-relative path
      // outside it is a link that works in `vitepress dev` and 404s on the
      // published site, which is served from a subpath.
      problems.push(`${from}: ${attr}="${target}" — outside the site base ${base}`)
      continue
    }

    const file = fileFor('/' + pathPart.slice(base.length))
    if (!file) {
      problems.push(`${from}: ${attr}="${target}" — nothing is built at that path`)
      continue
    }
    if (anchor && file.endsWith('.html') && !idsOf(file).has(decodeURIComponent(anchor))) {
      problems.push(`${from}: ${attr}="${target}" — ${relative(dist, file)} has no element with id "${anchor}"`)
    }
  }
}

for (const p of problems) console.error(p)
console.log(`check-built-links: ${checked} link(s) across ${pages.length} page(s), ${problems.length} dead.`)
process.exit(problems.length ? 1 : 0)
