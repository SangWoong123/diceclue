// Privacy-safe puzzle event counting (server side).
//
// What is kept: one counter row per
//   (UTC date the event was received, event, puzzle #, result, country, device class)
// and nothing else. No IP, no user agent, no cookies, no identifiers, no
// per-request log. The user agent is read once to drop bots and derive a coarse
// device class, then discarded.
//
// Pure helpers live here so they can be unit-tested with `node --test`; the
// Durable Object below only adds SQLite storage around them.

export const EVENTS = ['start', 'finish', 'share']
export const RESULTS = ['win', 'lose']
export const MAX_BODY_BYTES = 256
export const MAX_DAYS = 90

// Same epoch as the client (`EPOCH` in App.jsx): puzzle #0 = 2026-01-01 UTC.
const EPOCH = Date.UTC(2026, 0, 1)
const DAY_MS = 86400000

/** Today's puzzle number (UTC), same formula as the client. */
export function puzzleNoFor(now) {
  const d = new Date(now)
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - EPOCH) / DAY_MS)
}

/** YYYY-MM-DD (UTC). */
export function utcDay(now) {
  return new Date(now).toISOString().slice(0, 10)
}

// Our own headless checks, crawlers, link previewers, scripts and HTTP libraries.
const BOT_UA =
  /bot|crawl|spider|slurp|headless|phantom|puppeteer|playwright|selenium|webdriver|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|preview|facebookexternalhit|embedly|curl|wget|python|httpie|aiohttp|axios|node-fetch|undici|^node|go-http|okhttp|java\/|libwww|scrapy|postman|insomnia/i

/** True when the request should be ignored as automated traffic. */
export function isBotUA(ua) {
  return !ua || ua.length < 20 || BOT_UA.test(ua)
}

/** Coarse device class from the UA. iPadOS Safari reports a Mac UA and counts as desktop. */
export function deviceClass(ua) {
  if (/iPad|Tablet|PlayBook|Silk|Kindle|Android(?!.*Mobile)/i.test(ua)) return 'tablet'
  if (/Mobi|iPhone|iPod|Android|Windows Phone|IEMobile/i.test(ua)) return 'mobile'
  return 'desktop'
}

/** Two-letter country from request.cf.country (Cloudflare codes like XX/T1 pass through). */
export function cleanCountry(c) {
  return typeof c === 'string' && /^[A-Z0-9]{2}$/.test(c) ? c : '??'
}

/**
 * Validates a client payload. Returns the normalized event or null.
 * Accepts only {e, p} or {e:'finish', p, r}; the puzzle number must be
 * today's (UTC) ±1 so stale tabs across midnight and small clock skew still count.
 */
export function parseEvent(text, now) {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_BODY_BYTES) return null
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const { e, p, r } = body
  if (!EVENTS.includes(e)) return null
  if (!Number.isInteger(p)) return null
  const today = puzzleNoFor(now)
  if (p < today - 1 || p > today + 1) return null
  const allowed = e === 'finish' ? ['e', 'p', 'r'] : ['e', 'p']
  if (Object.keys(body).some((k) => !allowed.includes(k))) return null
  if (e === 'finish' && !RESULTS.includes(r)) return null
  return { event: e, puzzle: p, result: e === 'finish' ? r : '' }
}

/** Last `days` UTC dates, newest first. */
export function dayRange(now, days) {
  const out = []
  for (let i = 0; i < days; i++) out.push(utcDay(now - i * DAY_MS))
  return out
}

const emptyBucket = () => ({ start: 0, finish: 0, share: 0 })

/**
 * Turns counter rows into the /api/stats JSON (aggregates only).
 * @param {{day:string,event:string,puzzle:number,result:string,country:string,device:string,n:number}[]} rows
 * @param {string[]} days newest first
 */
export function aggregate(rows, days) {
  const byDay = new Map(
    days.map((date) => [
      date,
      { date, starts: 0, finishes: { win: 0, lose: 0, total: 0 }, shares: 0, puzzles: {}, countries: {}, devices: {} },
    ])
  )
  for (const row of rows) {
    const d = byDay.get(row.day)
    if (!d || !EVENTS.includes(row.event)) continue
    const n = Number(row.n) || 0
    if (row.event === 'start') d.starts += n
    else if (row.event === 'share') d.shares += n
    else {
      d.finishes.total += n
      if (RESULTS.includes(row.result)) d.finishes[row.result] += n
    }
    for (const [key, field] of [
      ['puzzles', String(row.puzzle)],
      ['countries', row.country],
      ['devices', row.device],
    ]) {
      const b = (d[key][field] ||= emptyBucket())
      b[row.event] += n
    }
  }
  const list = [...byDay.values()]
  const totals = { starts: 0, finishes: { win: 0, lose: 0, total: 0 }, shares: 0 }
  for (const d of list) {
    totals.starts += d.starts
    totals.shares += d.shares
    for (const k of ['win', 'lose', 'total']) totals.finishes[k] += d.finishes[k]
  }
  return { dateBasis: 'UTC date the event was received', days: list, totals }
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS daily_counts (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  puzzle INTEGER NOT NULL,
  result TEXT NOT NULL,
  country TEXT NOT NULL,
  device TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, puzzle, result, country, device)
) WITHOUT ROWID`

/**
 * One SQLite-backed Durable Object instance holds every daily counter.
 * Internal only: reachable from this Worker via the EVENT_COUNTER binding.
 */
export class EventCounter {
  constructor(ctx) {
    this.sql = ctx.storage.sql
    this.sql.exec(SCHEMA)
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/inc') {
      const { day, event, puzzle, result, country, device } = await request.json()
      this.sql.exec(
        `INSERT INTO daily_counts (day, event, puzzle, result, country, device, n) VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT (day, event, puzzle, result, country, device) DO UPDATE SET n = n + 1`,
        day, event, puzzle, result, country, device
      )
      return new Response(null, { status: 204 })
    }
    if (request.method === 'GET' && url.pathname === '/rows') {
      const from = url.searchParams.get('from') || '0000-00-00'
      const rows = this.sql
        .exec('SELECT day, event, puzzle, result, country, device, n FROM daily_counts WHERE day >= ?', from)
        .toArray()
      return Response.json(rows)
    }
    return new Response('not found', { status: 404 })
  }
}

const counter = (env) => env.EVENT_COUNTER.get(env.EVENT_COUNTER.idFromName('daily-v1'))

// Response header so automated checks can tell outcomes apart; browsers ignore it.
const reply = (status, outcome) =>
  new Response(null, { status, headers: { 'x-dc-event': outcome, 'cache-control': 'no-store' } })

/** POST /api/e — record one event. Always cheap, never throws to the client. */
export async function handleEvent(request, env, now = Date.now()) {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { allow: 'POST', 'x-dc-event': 'method' } })
  }
  const url = new URL(request.url)
  const origin = request.headers.get('origin')
  const site = request.headers.get('sec-fetch-site')
  if ((origin && origin !== url.origin) || site === 'cross-site') return reply(403, 'cross-origin')
  const len = Number(request.headers.get('content-length') || 0)
  if (!len) return reply(411, 'length-required')
  if (len > MAX_BODY_BYTES) return reply(413, 'too-large')

  const ua = request.headers.get('user-agent') || ''
  if (isBotUA(ua)) return reply(204, 'ignored')

  const text = await request.text()
  const ev = parseEvent(text, now)
  if (!ev) return reply(400, 'invalid')

  const row = {
    day: utcDay(now),
    ...ev,
    country: cleanCountry(request.cf?.country),
    device: deviceClass(ua),
  }
  // ?dry=1 runs every check above but stores nothing (for live smoke tests).
  if (url.searchParams.get('dry') === '1') return reply(204, 'ok-dry')
  try {
    await counter(env).fetch('https://counter/inc', { method: 'POST', body: JSON.stringify(row) })
  } catch (err) {
    console.error('event counter unavailable', err?.message)
    return reply(204, 'dropped')
  }
  return reply(204, 'ok')
}

/** GET /api/stats?days=N — daily aggregates for the last N UTC days (1–90, default 7). */
export async function handleStats(request, env, now = Date.now()) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET' } })
  }
  const url = new URL(request.url)
  const asked = Number.parseInt(url.searchParams.get('days') || '7', 10)
  const days = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), MAX_DAYS) : 7
  const range = dayRange(now, days)
  const res = await counter(env).fetch(`https://counter/rows?from=${range[range.length - 1]}`)
  const rows = await res.json()
  const body = { generatedAt: new Date(now).toISOString(), ...aggregate(rows, range) }
  return Response.json(body, { headers: { 'cache-control': 'no-store' } })
}
