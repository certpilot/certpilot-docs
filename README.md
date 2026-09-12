<p align="center">
  <img src="docs/public/logo.svg" alt="" width="76" height="76" />
</p>

# CertPilot documentation

The published documentation for
[CertPilot](https://github.com/certpilot/certpilot) — the guide to how it works
and how to run it, and the reference for all 121 endpoints. Built with
[VitePress](https://vitepress.dev) and published to GitHub Pages.

**https://certpilot.github.io/certpilot-docs/**

## Why this repo exists separately

The documentation site has a different release cadence, a different audience,
and a different toolchain from the Go control plane. Keeping it here means a
typo fix does not rebuild six Go modules, and the docs can be deployed without
shipping a release of CertPilot.

## One-time setup

Pages has to be switched on by hand before the first deploy can succeed:

**Settings → Pages → Build and deployment → Source: _GitHub Actions_**

The workflow cannot do this for itself. Creating a Pages site requires
repository-admin rights, and `GITHUB_TOKEN` is an app installation token that
cannot hold them — it fails with *"Resource not accessible by integration"*. If
you fork or recreate this repository, expect the first deploy to fail until you
have done the above, then re-run it.

## The route table is generated

The endpoint pages under `docs/api/reference/` are **generated**, not written.
They come from `routes.json`, which is extracted from `core/api/router.go` in
the CertPilot repository by `scripts/extract-routes.py` over there.

That matters because a hand-maintained route table has exactly one failure mode
and it is silent: somebody adds a route, forgets the docs, and the reference is
quietly wrong for six months. Here a missing route is impossible — the table is
the router.

The generated pages are gitignored. Reviewing a diff of machine output on every
route change is noise, and it invites editing the output instead of the source.

```
core/api/router.go            ← the truth
  └─ scripts/extract-routes.py
       └─ docs/routes.json    ← committed in the CertPilot repo
            └─ routes.json    ← vendored here, refreshed by `npm run sync`
                 └─ docs/api/reference/*.md   ← generated at build time
```

The router's own comments explain why each endpoint is gated where it is, and
those are carried through as prose on each route. **Edit the router, not the
generated page.**

## The prose is vendored too

The route table answers "what exists and who may call it". It does not answer
"what do I send", which is the question a reader actually arrives with, and no
amount of generating gets you there from a router: that `common_name` and
`csr_pem` are mutually exclusive is a fact about the handler, not the route.

That explanation was already written, in `docs/api-reference.md` in the code
repository, where it was readable only by somebody who had cloned the code --
precisely the audience that needs it least. `scripts/sync-guides.mjs` splits
that file on its H2 headings into `guides/`, one fragment per resource, and
`generate-endpoints.mjs` sets each fragment beside the route table for the same
resource. A reader gets the table and the examples on one page.

```bash
npm run sync:guides                # refresh from the default branch
npm run sync:guides -- --check     # exit 1 if stale (CI runs this)

# Author the prose in the code repository, then sync from a local checkout:
CERTPILOT_GUIDE_PATH=../pki_project/docs/api-reference.md npm run sync:guides
```

**Edit `docs/api-reference.md` in the code repository, not `guides/`.** The
fragments carry a header saying so, and CI fails if they drift.

Three transformations happen on the way in, all because a document written to
live in one repository does not survive being published from another:

- **Headings are promoted one level.** They sat under an H2 for the resource;
  here the resource is the H1, so they belong at H2. Demoting them instead put
  every one at H4, and this site's outline is configured for levels 2 and 3, so
  ninety lines per page had no table-of-contents entry at all.
- **Repository-relative links become GitHub URLs.** `../pkg/agentauth` resolved
  to a real directory in the code repository and to nothing here.
- **Anchors into skipped sections are repointed**, via `ANCHOR_TO_PAGE`. An
  unlisted one is a hard error rather than a guess.

The opening ASCII route listing in each source section is dropped, because the
generated table sits directly above it saying the same thing with roles filled
in and paths linked, and the ASCII one is the copy that can be wrong.

Sections with no matching route section are reported and skipped. Today that is
none; `Health`, `Sign-in discovery`, `The caller's own identity`, `The agent
API` and `Custom metadata fields` have no prose in the source yet, so those
pages render as they always did.

## The guide is vendored as well

The guides above are fragments of one file. The fifteen documents under
**Guide** are whole pages from the code repository -- architecture, discovery,
monitoring, deployment, the agent, posture, the Vault gateway, writing a
gateway, configuration, operations, security, the database, troubleshooting,
getting started and implementation status.

They were in the same position the API prose used to be in: about four thousand
lines, readable only by somebody who had already cloned the code. That is
backwards for the pages a reader reaches before they know what CertPilot is.

`scripts/sync-pages.mjs` fetches them whole, with the screenshots they
reference. Three things happen on the way in:

- **Links between published pages become site routes.** `security.md` in the
  source becomes `/security` here, anchors intact, so the set reads as one
  document instead of a ring of round trips to GitHub.
- **Links to code become GitHub URLs.** `../core/store/store.go` resolved to a
  real file in the code repository and to nothing here.
- **Screenshots are copied into `docs/public/images/`** and their links become
  `/images/…`, which VitePress resolves against `base` on the published subpath.

Anything still unresolved after that is a hard error rather than a guess. This
site fails the build on a dead link rather than shipping one, and a silent
rewrite would leave prose promising an explanation it no longer points to.

```bash
npm run sync:pages                 # refresh from the default branch
npm run sync:pages -- --check      # exit 1 if stale (CI runs this)

# Author the pages in the code repository, then sync from a local checkout:
CERTPILOT_DOCS_DIR=../certpilot/docs npm run sync:pages
```

**Edit these in the code repository, not here.** Each synced copy carries a
header saying so and sets `editLink: false`, because the edit button would
otherwise offer to change a file the next sync overwrites.

Each page in the manifest names a sentinel heading that must appear in what
comes back. A file renamed upstream, or a 404 served as a 200, otherwise arrives
as a page that builds cleanly and says nothing.

`api-reference.md` is deliberately not in the manifest: `sync-guides.mjs`
already splits it into the per-resource fragments that sit beside the generated
route tables, and importing it whole as well would give a reader two accounts of
the same endpoint with no way to tell which is current.

### The sidebar and the home page read the same file

`docs/.vitepress/guide-sidebar.json` holds the guide's groups. The sidebar is
built from it and so is the directory on the landing page. Two copies would give
the two places different answers about what the guide contains, and nothing
would say which was right.

### Diagrams

The architecture and deployment pages carry mermaid diagrams, rendered here by
`vitepress-plugin-mermaid` and by GitHub natively, so one source displays in
both places.

Two constraints are worth knowing before adding one, because both produce a
diagram that looks fine in isolation and wrong once published:

- **A node label is at most two lines.** Mermaid sizes the box from the label it
  measured and then draws it with different metrics; a third line is drawn
  across the bottom edge of its own box.
- **A cluster title is one line.** The second line is drawn where the first row
  of nodes goes, and ends up behind them.

## Working on it

```bash
npm install
npm run dev      # generate pages, then serve with hot reload
npm run build    # generate, then build to docs/.vitepress/dist
npm run preview  # serve the built site
```

| Command | What it does |
|:--|:--|
| `npm run gen` | Regenerate the endpoint pages from `routes.json` |
| `npm run sync` | Refresh `routes.json` from the CertPilot repository |
| `npm run sync:guides` | Refresh the guide fragments from `docs/api-reference.md` |
| `npm run sync:pages` | Refresh the fifteen guide pages and their screenshots |
| `npm run check` | Fail if any route is undocumented or any anchor is broken |

Hand-written pages live in `docs/api/` — authentication, roles, conventions,
errors, the event stream, and display tokens. Those are prose and are meant to
be edited directly.

## Keeping it in sync

Everything on this site comes from the CertPilot repository: the route table,
the API prose, and the fifteen guide pages with their screenshots. A scheduled
workflow refreshes all three weekly and opens a pull request when anything has
changed, so a new endpoint or a rewritten explanation shows up here without
anyone remembering to push it.

Each of `sync`, `sync:guides` and `sync:pages` takes `-- --check`, which exits
non-zero if the vendored copy is stale. CI runs all three on a pull request, so
the cost of vendoring — drift nobody notices — is paid by a failing check rather
than by a reader.

## Conventions

British spelling. Prose explains **why**, not what — matching the codebase it
documents. Errors and security properties are described in terms of the failure
they prevent, because that is what makes them stick.
