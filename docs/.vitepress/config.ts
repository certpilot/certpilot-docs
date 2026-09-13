import { defineConfig } from 'vitepress'
// Renders ```mermaid fences. The architecture page is synced from the code
// repository, where the diagrams are authored as text next to the prose they
// illustrate and GitHub renders them natively; without this they arrive here as
// a code block full of arrow syntax.
import { withMermaid } from 'vitepress-plugin-mermaid'
import generated from './sidebar-generated.json' with { type: 'json' }
// Shared with the home page, which lists the same groups. Two copies of this
// structure would give the sidebar and the landing page different answers about
// what the guide contains, and nothing would say which was right.
import guide from './guide-sidebar.json' with { type: 'json' }

const REPO = 'https://github.com/certpilot/certpilot-docs'
const CODE = 'https://github.com/certpilot/certpilot'

export default withMermaid(
  defineConfig({
    title: 'CertPilot Docs',
    description:
      'Documentation for CertPilot — open-source PKI and certificate lifecycle ' +
      'management. How it works, how to run it, and every endpoint.',
    lang: 'en-GB',

    // Project pages are served from a subpath. Getting this wrong produces a
    // site whose every asset 404s while the HTML itself loads fine.
    base: '/certpilot-docs/',

    cleanUrls: true,
    lastUpdated: true,

    // A dead link in an API reference sends somebody hunting for an endpoint
    // that does not exist, so it fails the build rather than shipping.
    ignoreDeadLinks: false,

    markdown: {
      /*
       * Languages the upstream prose fences with that Shiki has never heard of.
       *
       * Without this the build prints "the language 'caddyfile' is not loaded"
       * on every run. It still renders — it falls back to plain text — so the
       * only thing the warning achieves is teaching whoever reads this build
       * log that warnings here are normal, which is the last thing a build log
       * should teach anybody.
       *
       * nginx rather than plain text, and not by preference: `text` and
       * `plaintext` are both rejected as alias targets — the alias has to name
       * a grammar Shiki will actually load. nginx is the closest one that
       * exists. Braces, a directive, its arguments, and `#` comments are the
       * same shape in both, which is most of a Caddyfile.
       */
      languageAlias: {
        caddyfile: 'nginx',
      },
    },

    head: [
      // `base` is not applied to head entries the way it is to theme assets, so
      // this path carries the subpath itself. Without it the icon 404s on the
      // published site while working perfectly in `vitepress dev`.
      [
        'link',
        { rel: 'icon', type: 'image/svg+xml', href: '/certpilot-docs/logo.svg' },
      ],
      ['meta', { name: 'theme-color', content: '#5ac8fa' }],
      ['meta', { name: 'colour-scheme', content: 'dark light' }],
    ],

    themeConfig: {
      // Base-relative: VitePress resolves theme asset paths against `base`.
      logo: '/logo.svg',

      outline: { level: [2, 3], label: 'On this page' },

      nav: [
        { text: 'Guide', link: '/getting-started', activeMatch: '^/(?!api/)' },
        { text: 'API', link: '/api/', activeMatch: '^/api/(?!reference)' },
        {
          text: 'Endpoints',
          link: generated[0]?.link ?? '/api/',
          activeMatch: '^/api/reference/',
        },
        { text: 'CertPilot', link: CODE },
      ],

      /*
       * Two sidebars, keyed by path. The guide and the endpoint reference are
       * read for different reasons and at different times, and a single list of
       * forty entries makes both harder to use than either alone.
       *
       * The grouping is the code repository's own, from docs/README.md. It
       * decided this information architecture already, and a second opinion
       * here would only give the two places different answers.
       */
      sidebar: {
        '/api/': [
          {
            text: 'Getting started',
            collapsed: false,
            items: [
              { text: 'Overview', link: '/api/' },
              { text: 'Authentication', link: '/api/authentication' },
              { text: 'Roles and permissions', link: '/api/roles' },
              { text: 'Conventions', link: '/api/conventions' },
              { text: 'Errors', link: '/api/errors' },
            ],
          },
          {
            text: 'Live data',
            collapsed: false,
            items: [
              { text: 'Event stream (SSE)', link: '/api/events' },
              { text: 'Unattended screens', link: '/api/display-tokens' },
            ],
          },
          {
            text: 'Endpoint reference',
            collapsed: false,
            items: generated.map((s) => ({
              text: `${s.text} (${s.count})`,
              link: s.link,
            })),
          },
          {
            // Where every "returns a Certificate" in the tables above lands.
            text: 'Schemas',
            collapsed: false,
            items: [{ text: 'Objects', link: '/api/reference/models' }],
          },
        ],

        '/': guide.map((group) => ({
          ...group,
          collapsed: group.text === 'Project',
        })),
      },

      socialLinks: [{ icon: 'github', link: CODE }],

      editLink: {
        pattern: `${REPO}/edit/main/docs/:path`,
        text: 'Edit this page',
      },

      search: { provider: 'local' },

      footer: {
        message: `Released under the <a href="${CODE}/blob/main/LICENSE">Apache 2.0 licence</a>.`,
        copyright: `© 2026 CertPilot · Synced from <a href="${CODE}">the CertPilot repository</a>`,
      },
    },
  }),
)
