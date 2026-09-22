<script setup lang="ts">
/**
 * Endpoints by HTTP method.
 *
 * This lived in the home page hero, which spent the most valuable space on the
 * site telling a first-time reader that CertPilot serves 41 GETs. That is a
 * genuinely useful fact — to somebody already writing against the API, reading
 * the API section. It is not what a PKI team arriving from a search result
 * needs to see first, and #79 moved it here.
 *
 * Everything is read from `census-generated.json`, which the endpoint
 * generator emits from routes.json. Nothing here is a number somebody typed:
 * the tagline this replaced advertised 109 endpoints against a router serving
 * 111, which is exactly the drift the generated tables exist to prevent.
 */
import census from '../census-generated.json'

// Widest method count, so the bars are proportional to each other rather than
// each filling its own row.
const peak = Math.max(...census.methods.map((m) => m.count))
</script>

<template>
  <aside class="census" aria-label="Endpoints by HTTP method">
    <p class="census-head">By method</p>
    <dl class="census-list">
      <div v-for="m in census.methods" :key="m.method" class="census-row">
        <dt class="census-method" :data-method="m.method">{{ m.method }}</dt>
        <dd class="census-bar">
          <span :style="{ width: `${(m.count / peak) * 100}%` }" />
        </dd>
        <dd class="census-count">{{ m.count }}</dd>
      </div>
    </dl>
    <p class="census-foot">
      {{ census.displayTokenReadable }} of them are readable by an unattended
      wall screen. The rest need a person or an agent.
    </p>
  </aside>
</template>

<style scoped>
.census {
  border: 1px solid var(--vp-c-divider);
  border-radius: 2px;
  padding: 1.25rem;
  background: var(--vp-c-bg-alt);
  max-width: 28rem;
  margin: 1.5rem 0 2rem;
}

.census-head,
.census-foot {
  font-family: var(--vp-font-family-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  /* 4.5:1 at 11px and 12px; --vp-c-text-3 measured 4.07:1 here. */
  color: var(--vp-c-text-2);
  margin: 0;
}

.census-foot {
  text-transform: none;
  letter-spacing: 0;
  font-size: 0.75rem;
  line-height: 1.5;
  margin-top: 1.125rem;
  padding-top: 0.875rem;
  border-top: 1px solid var(--vp-c-divider);
}

.census-list {
  margin: 1rem 0 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.census-row {
  display: grid;
  grid-template-columns: 4.25rem minmax(0, 1fr) 2rem;
  align-items: center;
  gap: 0.625rem;
}

.census-method {
  font-family: var(--vp-font-family-mono);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

/* Only DELETE is coloured, matching the reference tables. In this product it
   rarely means "remove a row": deleting a deployment target stops an estate
   being deployed to while every renewal carries on reporting success. */
.census-method[data-method='DELETE'] { color: var(--cp-critical); }

.census-bar {
  margin: 0;
  height: 3px;
  background: var(--vp-c-divider);
  overflow: hidden;
}

.census-bar > span {
  display: block;
  height: 100%;
  background: var(--vp-c-brand-1);
}

.census-count {
  margin: 0;
  font-family: var(--vp-font-family-mono);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--vp-c-text-1);
}
</style>
