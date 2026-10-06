// Anonymous puzzle event counting (client side).
//
// Sends only {e: event, p: puzzle #, r: result} to the same-origin /api/e —
// no identifiers, no cookies. `start` and `finish` are sent at most once per
// puzzle per browser (localStorage flag). A browser opened once with `?nolog=1`
// never sends events again (the Web Analytics beacon in index.html honours the
// same flag); `?nolog=0` turns logging back on.

const NOLOG_KEY = 'dc_nolog';
const SENT_PREFIX = 'dc_ev_';
const ENDPOINT = '/api/e';
const sentThisPage = new Set(); // fallback when localStorage is blocked

function applyNologParam() {
  try {
    const v = new URLSearchParams(location.search).get('nolog');
    if (v === '1') localStorage.setItem(NOLOG_KEY, '1');
    else if (v === '0') localStorage.removeItem(NOLOG_KEY);
  } catch {}
}
applyNologParam();

function isNolog() {
  try {
    if (new URLSearchParams(location.search).get('nolog') === '1') return true;
    return localStorage.getItem(NOLOG_KEY) === '1';
  } catch {
    return false;
  }
}

function post(payload) {
  if (isNolog()) return;
  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body)) return;
  } catch {}
  try {
    fetch(ENDPOINT, { method: 'POST', body, keepalive: true, credentials: 'omit' }).catch(() => {});
  } catch {}
}

/** Sends `event` for this puzzle only once per browser (start / finish). */
function once(event, puzzleNo, payload) {
  if (isNolog()) return;
  const key = `${SENT_PREFIX}${puzzleNo}`;
  const mark = event[0]; // 's' | 'f'
  let sent = '';
  try {
    sent = localStorage.getItem(key) || '';
    if (sent.includes(mark)) return;
    localStorage.setItem(key, sent + mark);
    // keep only today's flags
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(SENT_PREFIX) && k !== key) localStorage.removeItem(k);
    }
  } catch {
    if (sentThisPage.has(key + mark)) return;
    sentThisPage.add(key + mark);
  }
  post(payload);
}

export const trackStart = (puzzleNo) => once('start', puzzleNo, { e: 'start', p: puzzleNo });
export const trackFinish = (puzzleNo, result) => once('finish', puzzleNo, { e: 'finish', p: puzzleNo, r: result });
export const trackShare = (puzzleNo) => post({ e: 'share', p: puzzleNo });
