<script setup lang="ts">
/**
 * The home page.
 *
 * Replaces VitePress's stock hero-and-three-cards. That layout is the single
 * most recognisable template signature on the web, and on an API reference it
 * spends the entire first screen on three paragraphs of prose while the reader
 * is looking for an endpoint.
 *
 * The counts still on this page — the per-section endpoint totals and the
 * roles — are read from the generated census and sidebar, never typed. The
 * hand-written tagline this replaced advertised 109 endpoints against a router
 * serving 111, which is exactly the drift the generated reference exists to
 * prevent.
 */
import { withBase } from 'vitepress'
import census from '../census-generated.json'
import sections from '../sidebar-generated.json'
// The same structure the sidebar is built from, so the two cannot disagree
// about what the guide contains.
import guide from '../guide-sidebar.json'

/*
 * The method census used to sit in the hero. It is now on the API overview,
 * where a reader who needs it is already standing — see MethodCensus.vue.
 * The hero's right column carries the first action instead, because the
 * question a PKI team arrives with is "can I try this", not "how many GETs
 * are there".
 */
</script>

<template>
  <div class="home">
    <!-- Asymmetric, not centred. The right column carries real data rather
         than the empty half a centred hero leaves behind. -->
    <header class="hero">
      <div class="hero-copy">
        <h1 class="hero-title">CertPilot</h1>
        <p class="hero-lede">
          Open-source PKI and certificate lifecycle management. Discovery across
          Certificate Transparency logs and hosts behind firewalls, renewals
          deployed in declared waves and verified by handshake, and issuing CAs
          watched on the same clock as everything they sign.
        </p>
        <div class="hero-actions">
          <a class="act act-primary" :href="withBase('/evaluation')">Evaluate it</a>
          <!-- Before the endpoints, not after. Somebody who has not met
               CertPilot cannot use a route table yet, and this is the page that
               tells them what the processes are. -->
          <a class="act" :href="withBase('/architecture')">How it works</a>
          <a class="act" :href="withBase('/getting-started')">Build from source</a>
          <a class="act" :href="withBase('/api/')">API reference</a>
        </div>
      </div>

      <!-- The first action. One command, a real one, and what it leaves you
           with — so the decision to try it is not preceded by reading a page. -->
      <aside class="first-run" aria-labelledby="first-run-head">
        <p class="first-run-head" id="first-run-head">Start here</p>
        <div class="first-run-code">
          <code>base=https://raw.githubusercontent.com/certpilot/certpilot/v0.1.1/deploy</code>
          <code>curl -O $base/docker-compose.quickstart.yml -O $base/config.quickstart.yaml</code>
          <code>export CERTPILOT_VERSION=0.1.1 GATEWAY_VERSION=0.3.0</code>
          <code>docker compose -f docker-compose.quickstart.yml up -d</code>
        </div>
        <p class="first-run-note">
          Docker and nothing else — no clone, no toolchain, no database to
          provision, no account with any CA. Measured cold with nothing cached:
          <strong>about 20 seconds</strong> to a console you can sign in to.
        </p>
        <a class="first-run-more" :href="withBase('/evaluation')">
          Connect a CA, issue a certificate, renew it, put it back →
        </a>
      </aside>
    </header>

    <!-- The directory. On a reference site the most useful thing the home page
         can do is get out of the way and list what is actually here. The guide
         gets the same treatment rather than a row of cards describing it. -->
    <section class="directory">
      <h2 class="directory-head">Six ways in</h2>
      <div class="guide-groups">
        <div v-for="g in guide" :key="g.text" class="guide-group">
          <h3 class="guide-head">{{ g.text }}</h3>
          <p v-if="g.blurb" class="guide-blurb">{{ g.blurb }}</p>
          <ul class="guide-list">
            <li v-for="i in g.items" :key="i.link">
              <a :href="withBase(i.link)">{{ i.text }}</a>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <section class="directory">
      <h2 class="directory-head">Endpoint reference</h2>
      <ul class="directory-grid">
        <li v-for="s in sections" :key="s.link">
          <a :href="withBase(s.link)">
            <span class="dir-name">{{ s.text }}</span>
            <span class="dir-count">{{ s.count }}</span>
          </a>
        </li>
      </ul>
    </section>

    <section class="roles">
      <h2 class="directory-head">Who can call what</h2>
      <p class="roles-lede">
        Four roles, held in CertPilot's own table rather than read from a token
        claim, so an identity provider cannot grant or change them.
      </p>
      <ol class="roles-scale">
        <li v-for="(r, i) in census.roles" :key="r">
          <span class="roles-rank">{{ i + 1 }}</span>
          <span class="roles-name">{{ r }}</span>
        </li>
      </ol>
      <p class="roles-foot">
        <a :href="withBase('/api/roles')">How the gates work</a>
      </p>
    </section>
  </div>
</template>

<style scoped>
.home {
  max-width: 1120px;
  margin: 0 auto;
  /* Clears the fixed nav, then the page's own opening space. */
  padding: calc(var(--vp-nav-height) + 3.5rem) 1.5rem 6rem;
}

/* ── Hero ────────────────────────────────────────────────────────────────── */
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 4rem;
  align-items: start;
  padding-bottom: 3.5rem;
  border-bottom: 1px solid var(--vp-c-divider);
}

.hero-title {
  /* Capped rather than scaled freely: above this the title crowds the panel
     beside it at tablet widths. */
  font-size: clamp(1.875rem, 3.4vw, 2.5rem);
  line-height: 1.08;
  letter-spacing: -0.028em;
  font-weight: 600;
  margin: 0;
  color: var(--vp-c-text-1);
}

.hero-lede {
  margin: 1.25rem 0 0;
  font-size: 1.0625rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  max-width: 46ch;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.625rem;
  margin-top: 2rem;
}

/*
 * Square, like every other edge on this site.
 *
 * VitePress ships full-radius pill buttons, which sat on a stylesheet that had
 * already squared the code blocks and the tables. One page, two shape systems,
 * and the pills were the loudest thing on it.
 */
.act {
  display: inline-flex;
  align-items: center;
  padding: 0.5625rem 1.125rem;
  border: 1px solid var(--vp-c-border);
  border-radius: 2px;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--vp-c-text-1);
  text-decoration: none;
  transition: border-color 0.14s ease, background 0.14s ease;
}

.act:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.act-primary {
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-bg);
  font-weight: 600;
}

.act-primary:hover {
  filter: brightness(1.08);
  background: var(--vp-c-brand-1);
}

/* ── First run ───────────────────────────────────────────────────────────── */
.first-run {
  border: 1px solid var(--vp-c-divider);
  border-radius: 2px;
  padding: 1.25rem;
  background: var(--vp-c-bg-alt);
  min-width: 0;
}

.first-run-head {
  font-family: var(--vp-font-family-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  /* --vp-c-text-3 measures 4.07:1 against this surface, under the 4.5:1 that
     text under 18.66px needs. Measured, not eyeballed — see the audit in the
     pull request. text-2 clears it in both themes. */
  color: var(--vp-c-text-2);
  margin: 0;
}

.first-run-code {
  margin: 1rem 0 0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.first-run-code code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 2px;
  padding: 0.5rem 0.625rem;
  /* Wraps rather than scrolls. A clone URL is longer than a phone is wide,
     and a command running off the edge of its own panel reads as a broken
     page rather than as something to scroll. `anywhere` because a URL has no
     spaces to break at. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  min-width: 0;
}

.first-run-note {
  font-size: 0.8125rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  margin: 1.125rem 0 0;
  padding-top: 0.875rem;
  border-top: 1px solid var(--vp-c-divider);
}

.first-run-note code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.75rem;
  color: var(--vp-c-text-1);
}

.first-run-more {
  display: inline-block;
  margin-top: 0.875rem;
  font-size: 0.8125rem;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

/* The brand colour clears 4.5:1 on the page background — a prose link measures
   4.51:1 — but this panel sits on --vp-c-bg-alt, which is a shade darker, and
   the same colour falls to 4.28:1 there. Darkened just enough to clear it,
   rather than leaving the palette for a hardcoded hex. Light theme only: in
   dark the same link measures 9.64:1. */
:root:not(.dark) .first-run-more {
  color: color-mix(in srgb, var(--vp-c-brand-1) 88%, black);
}

.first-run-more:hover {
  text-decoration: underline;
}

.guide-blurb {
  font-size: 0.8125rem;
  line-height: 1.55;
  /* --vp-c-text-3 measures 4.07:1 against this surface, under the 4.5:1 that
     text under 18.66px needs. Measured, not eyeballed — see the audit in the
     pull request. text-2 clears it in both themes. */
  color: var(--vp-c-text-2);
  margin: 0.375rem 0 0.75rem;
}

/* ── Directory ───────────────────────────────────────────────────────────── */
.directory,
.roles {
  padding-top: 3.5rem;
}

.directory-head {
  font-family: var(--vp-font-family-mono);
  font-size: 0.75rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
  font-weight: 500;
  margin: 0 0 1.25rem;
  border: 0;
  padding: 0;
}

.directory-grid {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 0;
  border-top: 1px solid var(--vp-c-divider);
}

.directory-grid a {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.625rem 0.75rem 0.625rem 0;
  border-bottom: 1px solid var(--vp-c-divider);
  text-decoration: none;
  color: var(--vp-c-text-2);
  font-size: 0.9375rem;
  transition: color 0.14s ease, padding-left 0.14s ease;
}

.directory-grid a:hover {
  color: var(--vp-c-brand-1);
  padding-left: 0.5rem;
}

.dir-count {
  font-family: var(--vp-font-family-mono);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--vp-c-text-3);
}

/* ── Roles ───────────────────────────────────────────────────────────────── */
.roles-lede {
  margin: 0 0 1.5rem;
  font-size: 1rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  max-width: 58ch;
}

.roles-scale {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.roles-scale li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 2px;
  padding: 0.4375rem 0.75rem;
}

.roles-rank {
  font-family: var(--vp-font-family-mono);
  font-size: 0.6875rem;
  color: var(--vp-c-text-3);
}

.roles-name {
  font-family: var(--vp-font-family-mono);
  font-size: 0.8125rem;
  color: var(--vp-c-text-1);
}

.roles-foot {
  margin: 1.5rem 0 0;
  font-size: 0.9375rem;
}

.roles-foot a { color: var(--vp-c-brand-1); text-decoration: none; }
.roles-foot a:hover { text-decoration: underline; }

/* ── Narrow ──────────────────────────────────────────────────────────────── */
@media (max-width: 860px) {
  .home { padding: calc(var(--vp-nav-height) + 2rem) 1.25rem 4rem; }
  .hero { grid-template-columns: minmax(0, 1fr); gap: 2.5rem; }
}

.guide-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 1.75rem 2rem;
}

.guide-head {
  margin: 0 0 0.6rem;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  /* --vp-c-text-3 measures 4.07:1 against this surface, under the 4.5:1 that
     text under 18.66px needs. Measured, not eyeballed — see the audit in the
     pull request. text-2 clears it in both themes. */
  color: var(--vp-c-text-2);
}

.guide-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.guide-list li + li {
  margin-top: 0.35rem;
}

.guide-list a {
  font-size: 0.9rem;
  color: var(--vp-c-text-1);
  text-decoration: none;
}

.guide-list a:hover {
  color: var(--vp-c-brand-1);
}

@media (prefers-reduced-motion: reduce) {
  .act,
  .directory-grid a { transition: none; }
  .directory-grid a:hover { padding-left: 0; }
}
</style>
