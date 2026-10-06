// node --test — pure helpers behind POST /api/e and GET /api/stats
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregate,
  cleanCountry,
  dayRange,
  deviceClass,
  handleEvent,
  isBotUA,
  parseEvent,
  puzzleNoFor,
} from '../src/server/events.js'

const NOW = Date.UTC(2026, 9, 6, 12) // 2026-10-06 12:00 UTC
const TODAY = puzzleNoFor(NOW)
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const ANDROID_TAB = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'

test('puzzle number matches the client epoch', () => {
  assert.equal(puzzleNoFor(Date.UTC(2026, 0, 1)), 0)
  assert.equal(TODAY, 278)
})

test('parseEvent accepts only the three events with valid fields', () => {
  assert.deepEqual(parseEvent(`{"e":"start","p":${TODAY}}`, NOW), { event: 'start', puzzle: TODAY, result: '' })
  assert.deepEqual(parseEvent(`{"e":"finish","p":${TODAY},"r":"win"}`, NOW), {
    event: 'finish',
    puzzle: TODAY,
    result: 'win',
  })
  assert.deepEqual(parseEvent(`{"e":"share","p":${TODAY - 1}}`, NOW), { event: 'share', puzzle: TODAY - 1, result: '' })
  for (const bad of [
    '',
    'nope',
    '[]',
    `{"e":"click","p":${TODAY}}`,
    `{"e":"start","p":"${TODAY}"}`,
    `{"e":"start","p":${TODAY + 2}}`,
    `{"e":"start","p":${TODAY - 2}}`,
    `{"e":"start","p":${TODAY},"uid":"x"}`,
    `{"e":"start","p":${TODAY},"r":"win"}`,
    `{"e":"finish","p":${TODAY}}`,
    `{"e":"finish","p":${TODAY},"r":"draw"}`,
    JSON.stringify({ e: 'start', p: TODAY, pad: 'x'.repeat(300) }),
  ]) {
    assert.equal(parseEvent(bad, NOW), null, bad)
  }
})

test('bots, headless browsers and scripts are ignored; real browsers are not', () => {
  for (const ua of [
    '',
    'curl/8.5.0',
    'python-requests/2.32',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'facebookexternalhit/1.1',
    'node',
  ]) {
    assert.equal(isBotUA(ua), true, ua)
  }
  for (const ua of [CHROME, IPHONE, ANDROID_TAB]) assert.equal(isBotUA(ua), false, ua)
})

test('device class and country are coarse', () => {
  assert.equal(deviceClass(CHROME), 'desktop')
  assert.equal(deviceClass(IPHONE), 'mobile')
  assert.equal(deviceClass(ANDROID_TAB), 'tablet')
  assert.equal(cleanCountry('KR'), 'KR')
  assert.equal(cleanCountry(undefined), '??')
  assert.equal(cleanCountry('<script>'), '??')
})

test('aggregate builds per-day totals and breakdowns, zero-filling empty days', () => {
  const days = dayRange(NOW, 3)
  assert.deepEqual(days, ['2026-10-06', '2026-10-05', '2026-10-04'])
  const rows = [
    { day: '2026-10-06', event: 'start', puzzle: 278, result: '', country: 'KR', device: 'mobile', n: 3 },
    { day: '2026-10-06', event: 'start', puzzle: 278, result: '', country: 'US', device: 'desktop', n: 2 },
    { day: '2026-10-06', event: 'finish', puzzle: 278, result: 'win', country: 'KR', device: 'mobile', n: 2 },
    { day: '2026-10-06', event: 'finish', puzzle: 278, result: 'lose', country: 'US', device: 'desktop', n: 1 },
    { day: '2026-10-06', event: 'share', puzzle: 278, result: '', country: 'KR', device: 'mobile', n: 1 },
    { day: '2026-10-05', event: 'start', puzzle: 277, result: '', country: 'KR', device: 'tablet', n: 4 },
    { day: '2026-09-01', event: 'start', puzzle: 243, result: '', country: 'KR', device: 'tablet', n: 99 },
  ]
  const out = aggregate(rows, days)
  const [d0, d1, d2] = out.days
  assert.equal(d0.starts, 5)
  assert.deepEqual(d0.finishes, { win: 2, lose: 1, total: 3 })
  assert.equal(d0.shares, 1)
  assert.deepEqual(d0.countries.KR, { start: 3, finish: 2, share: 1 })
  assert.deepEqual(d0.devices.desktop, { start: 2, finish: 1, share: 0 })
  assert.deepEqual(d0.puzzles['278'], { start: 5, finish: 3, share: 1 })
  assert.equal(d1.starts, 4)
  assert.deepEqual(d2, {
    date: '2026-10-04',
    starts: 0,
    finishes: { win: 0, lose: 0, total: 0 },
    shares: 0,
    puzzles: {},
    countries: {},
    devices: {},
  })
  assert.equal(out.totals.starts, 9) // the out-of-range 2026-09-01 row is excluded
})

// Minimal stand-in for the Durable Object binding: records what would be stored.
function fakeEnv() {
  const stored = []
  return {
    stored,
    EVENT_COUNTER: {
      idFromName: () => 'id',
      get: () => ({ fetch: async (_url, init) => (stored.push(JSON.parse(init.body)), new Response(null, { status: 204 })) }),
    },
  }
}
const req = (body, headers = {}, method = 'POST', url = 'https://diceclue.com/api/e') =>
  Object.assign(
    new Request(url, {
      method,
      body: method === 'POST' ? body : undefined,
      headers: { 'user-agent': CHROME, 'content-length': String(body.length), ...headers },
    }),
    { cf: { country: 'KR' } }
  )

test('handleEvent stores only day/event/puzzle/result/country/device', async () => {
  const env = fakeEnv()
  const res = await handleEvent(req(`{"e":"finish","p":${TODAY},"r":"win"}`, { 'cf-connecting-ip': '203.0.113.9' }), env, NOW)
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('x-dc-event'), 'ok')
  assert.deepEqual(env.stored, [
    { day: '2026-10-06', event: 'finish', puzzle: TODAY, result: 'win', country: 'KR', device: 'desktop' },
  ])
})

test('handleEvent rejection paths store nothing', async () => {
  const env = fakeEnv()
  const ok = `{"e":"start","p":${TODAY}}`
  const cases = [
    [req('', {}, 'GET'), 405],
    [req(ok, { origin: 'https://evil.example' }), 403],
    [req(ok, { 'sec-fetch-site': 'cross-site' }), 403],
    [req('x'.repeat(300)), 413],
    [req(ok, { 'user-agent': 'Mozilla/5.0 HeadlessChrome/141.0.0.0 Safari/537.36' }), 204, 'ignored'],
    [req(ok, { 'user-agent': 'curl/8.5.0' }), 204, 'ignored'],
    [req(`{"e":"start","p":${TODAY + 5}}`), 400],
    [req(ok, {}, 'POST', 'https://diceclue.com/api/e?dry=1'), 204, 'ok-dry'],
  ]
  for (const [r, status, outcome] of cases) {
    const res = await handleEvent(r, env, NOW)
    assert.equal(res.status, status)
    if (outcome) assert.equal(res.headers.get('x-dc-event'), outcome)
  }
  assert.equal(env.stored.length, 0)
  const same = await handleEvent(req(ok, { origin: 'https://diceclue.com' }), env, NOW)
  assert.equal(same.status, 204)
  assert.equal(env.stored.length, 1)
})
