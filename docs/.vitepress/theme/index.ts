import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { nextTick, onMounted, watch } from 'vue'
import { useData, useRoute } from 'vitepress'
import mediumZoom from 'medium-zoom'
import type { Zoom } from 'medium-zoom'

/*
 * Fonts are self-hosted, not linked from a CDN.
 *
 * A documentation site that fetches its typeface from fonts.googleapis.com asks
 * every reader's browser to announce that it is reading CertPilot's API docs to
 * a third party, and renders in a fallback face for anyone behind a network
 * that blocks it. Both of those are avoidable by shipping the files.
 *
 * IBM Plex Sans for prose and JetBrains Mono for anything a machine produced:
 * paths, methods, handler names, JSON. The pairing is the conventional one for
 * developer documentation because it works, and Plex has the wide aperture and
 * unambiguous 1/l/I that a page full of URL fragments needs.
 */
import '@fontsource-variable/ibm-plex-sans'
import '@fontsource-variable/jetbrains-mono'

import HomeIndex from './HomeIndex.vue'
import './custom.css'

/*
 * Screenshots open full size on click.
 *
 * They are captured at 1600px and rendered in a column around half that, which
 * is fine for "here is the shape of the page" and useless for the thing each
 * one is actually illustrating — a finding, a severity chip, a column of days
 * remaining. Scaled to fit, a screenshot of a dense console is decoration.
 */
const overlay = (dark: boolean) =>
  dark ? 'rgba(8, 8, 12, 0.94)' : 'rgba(250, 250, 252, 0.96)'

let zoom: Zoom | undefined

function attachZoom(dark: boolean) {
  zoom?.detach()

  // Only images inside the prose. The nav logo is not a screenshot, and the
  // home page's own graphics are laid out to their container rather than
  // rendered down from something larger.
  const images = [
    ...document.querySelectorAll<HTMLImageElement>('.vp-doc img'),
  ]
  if (!images.length) {
    zoom = undefined
    return
  }

  // An image is not focusable by default, so click-to-zoom would be the only
  // way in and a keyboard reader would never reach it. medium-zoom already
  // closes on Escape; this is the other half.
  for (const image of images) {
    image.tabIndex = 0
    image.setAttribute('role', 'button')
    image.setAttribute('aria-label', `${image.alt || 'Screenshot'} — open full size`)
  }

  zoom = mediumZoom(images, { background: overlay(dark), margin: 24 })
}

function openOnKey(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  const target = event.target as HTMLElement | null
  if (!target?.matches?.('.vp-doc img')) return
  event.preventDefault()
  zoom?.open({ target: target as HTMLImageElement })
}

export default {
  extends: DefaultTheme,
  setup() {
    const route = useRoute()
    const { isDark } = useData()

    onMounted(() => {
      attachZoom(isDark.value)
      document.addEventListener('keydown', openOnKey)
    })

    // Client-side navigation swaps the content without remounting the theme, so
    // the images on the next page would otherwise never be attached to.
    watch(
      () => route.path,
      () => nextTick(() => attachZoom(isDark.value)),
    )

    // The overlay is set when the instance is created, so a reader who switches
    // theme with a page already open would get the other theme's backdrop.
    watch(isDark, (dark) => zoom?.update({ background: overlay(dark) }))
  },
  enhanceApp({ app }) {
    app.component('HomeIndex', HomeIndex)
  },
} satisfies Theme
