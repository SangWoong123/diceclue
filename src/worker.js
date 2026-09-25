// Cloudflare Worker entry: 301 the workers.dev host to the canonical domain,
// serve everything else from static assets exactly as before.
const WORKERS_DEV_HOST = 'diceclue.diceclue.workers.dev'
const CANONICAL_ORIGIN = 'https://diceclue.com'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.hostname === WORKERS_DEV_HOST) {
      return Response.redirect(CANONICAL_ORIGIN + url.pathname + url.search, 301)
    }
    return env.ASSETS.fetch(request)
  },
}
