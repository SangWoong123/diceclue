// Cloudflare Worker entry: 301 the workers.dev host to the canonical domain,
// handle the two small analytics endpoints, serve everything else from static
// assets exactly as before.
import { EventCounter, handleEvent, handleStats } from './server/events.js'

const WORKERS_DEV_HOST = 'diceclue.diceclue.workers.dev'
const CANONICAL_ORIGIN = 'https://diceclue.com'

export { EventCounter }

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.hostname === WORKERS_DEV_HOST) {
      return Response.redirect(CANONICAL_ORIGIN + url.pathname + url.search, 301)
    }
    if (url.pathname === '/api/e') return handleEvent(request, env)
    if (url.pathname === '/api/stats') return handleStats(request, env)
    return env.ASSETS.fetch(request)
  },
}
