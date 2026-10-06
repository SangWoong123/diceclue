var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-3dnA4B/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// src/server/events.js
var EVENTS = ["start", "finish", "share"];
var RESULTS = ["win", "lose"];
var MAX_BODY_BYTES = 256;
var MAX_DAYS = 90;
var EPOCH = Date.UTC(2026, 0, 1);
var DAY_MS = 864e5;
function puzzleNoFor(now) {
  const d = new Date(now);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - EPOCH) / DAY_MS);
}
__name(puzzleNoFor, "puzzleNoFor");
function utcDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}
__name(utcDay, "utcDay");
var BOT_UA = /bot|crawl|spider|slurp|headless|phantom|puppeteer|playwright|selenium|webdriver|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|preview|facebookexternalhit|embedly|curl|wget|python|httpie|aiohttp|axios|node-fetch|undici|^node|go-http|okhttp|java\/|libwww|scrapy|postman|insomnia/i;
function isBotUA(ua) {
  return !ua || ua.length < 20 || BOT_UA.test(ua);
}
__name(isBotUA, "isBotUA");
function deviceClass(ua) {
  if (/iPad|Tablet|PlayBook|Silk|Kindle|Android(?!.*Mobile)/i.test(ua))
    return "tablet";
  if (/Mobi|iPhone|iPod|Android|Windows Phone|IEMobile/i.test(ua))
    return "mobile";
  return "desktop";
}
__name(deviceClass, "deviceClass");
function cleanCountry(c) {
  return typeof c === "string" && /^[A-Z0-9]{2}$/.test(c) ? c : "??";
}
__name(cleanCountry, "cleanCountry");
function parseEvent(text, now) {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_BODY_BYTES)
    return null;
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return null;
  const { e, p, r } = body;
  if (!EVENTS.includes(e))
    return null;
  if (!Number.isInteger(p))
    return null;
  const today = puzzleNoFor(now);
  if (p < today - 1 || p > today + 1)
    return null;
  const allowed = e === "finish" ? ["e", "p", "r"] : ["e", "p"];
  if (Object.keys(body).some((k) => !allowed.includes(k)))
    return null;
  if (e === "finish" && !RESULTS.includes(r))
    return null;
  return { event: e, puzzle: p, result: e === "finish" ? r : "" };
}
__name(parseEvent, "parseEvent");
function dayRange(now, days) {
  const out = [];
  for (let i = 0; i < days; i++)
    out.push(utcDay(now - i * DAY_MS));
  return out;
}
__name(dayRange, "dayRange");
var emptyBucket = /* @__PURE__ */ __name(() => ({ start: 0, finish: 0, share: 0 }), "emptyBucket");
function aggregate(rows, days) {
  const byDay = new Map(
    days.map((date) => [
      date,
      { date, starts: 0, finishes: { win: 0, lose: 0, total: 0 }, shares: 0, puzzles: {}, countries: {}, devices: {} }
    ])
  );
  for (const row of rows) {
    const d = byDay.get(row.day);
    if (!d || !EVENTS.includes(row.event))
      continue;
    const n = Number(row.n) || 0;
    if (row.event === "start")
      d.starts += n;
    else if (row.event === "share")
      d.shares += n;
    else {
      d.finishes.total += n;
      if (RESULTS.includes(row.result))
        d.finishes[row.result] += n;
    }
    for (const [key, field] of [
      ["puzzles", String(row.puzzle)],
      ["countries", row.country],
      ["devices", row.device]
    ]) {
      const b = d[key][field] ||= emptyBucket();
      b[row.event] += n;
    }
  }
  const list = [...byDay.values()];
  const totals = { starts: 0, finishes: { win: 0, lose: 0, total: 0 }, shares: 0 };
  for (const d of list) {
    totals.starts += d.starts;
    totals.shares += d.shares;
    for (const k of ["win", "lose", "total"])
      totals.finishes[k] += d.finishes[k];
  }
  return { dateBasis: "UTC date the event was received", days: list, totals };
}
__name(aggregate, "aggregate");
var SCHEMA = `CREATE TABLE IF NOT EXISTS daily_counts (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  puzzle INTEGER NOT NULL,
  result TEXT NOT NULL,
  country TEXT NOT NULL,
  device TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, puzzle, result, country, device)
) WITHOUT ROWID`;
var EventCounter = class {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.sql.exec(SCHEMA);
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/inc") {
      const { day, event, puzzle, result, country, device } = await request.json();
      this.sql.exec(
        `INSERT INTO daily_counts (day, event, puzzle, result, country, device, n) VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT (day, event, puzzle, result, country, device) DO UPDATE SET n = n + 1`,
        day,
        event,
        puzzle,
        result,
        country,
        device
      );
      return new Response(null, { status: 204 });
    }
    if (request.method === "GET" && url.pathname === "/rows") {
      const from = url.searchParams.get("from") || "0000-00-00";
      const rows = this.sql.exec("SELECT day, event, puzzle, result, country, device, n FROM daily_counts WHERE day >= ?", from).toArray();
      return Response.json(rows);
    }
    return new Response("not found", { status: 404 });
  }
};
__name(EventCounter, "EventCounter");
var counter = /* @__PURE__ */ __name((env) => env.EVENT_COUNTER.get(env.EVENT_COUNTER.idFromName("daily-v1")), "counter");
var reply = /* @__PURE__ */ __name((status, outcome) => new Response(null, { status, headers: { "x-dc-event": outcome, "cache-control": "no-store" } }), "reply");
async function handleEvent(request, env, now = Date.now()) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST", "x-dc-event": "method" } });
  }
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (origin && origin !== url.origin || site === "cross-site")
    return reply(403, "cross-origin");
  const len = Number(request.headers.get("content-length") || 0);
  if (!len)
    return reply(411, "length-required");
  if (len > MAX_BODY_BYTES)
    return reply(413, "too-large");
  const ua = request.headers.get("user-agent") || "";
  if (isBotUA(ua))
    return reply(204, "ignored");
  const text = await request.text();
  const ev = parseEvent(text, now);
  if (!ev)
    return reply(400, "invalid");
  const row = {
    day: utcDay(now),
    ...ev,
    country: cleanCountry(request.cf?.country),
    device: deviceClass(ua)
  };
  if (url.searchParams.get("dry") === "1")
    return reply(204, "ok-dry");
  try {
    await counter(env).fetch("https://counter/inc", { method: "POST", body: JSON.stringify(row) });
  } catch (err) {
    console.error("event counter unavailable", err?.message);
    return reply(204, "dropped");
  }
  return reply(204, "ok");
}
__name(handleEvent, "handleEvent");
async function handleStats(request, env, now = Date.now()) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET" } });
  }
  const url = new URL(request.url);
  const asked = Number.parseInt(url.searchParams.get("days") || "7", 10);
  const days = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), MAX_DAYS) : 7;
  const range = dayRange(now, days);
  const res = await counter(env).fetch(`https://counter/rows?from=${range[range.length - 1]}`);
  const rows = await res.json();
  const body = { generatedAt: new Date(now).toISOString(), ...aggregate(rows, range) };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
__name(handleStats, "handleStats");

// src/worker.js
var WORKERS_DEV_HOST = "diceclue.diceclue.workers.dev";
var CANONICAL_ORIGIN = "https://diceclue.com";
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === WORKERS_DEV_HOST) {
      return Response.redirect(CANONICAL_ORIGIN + url.pathname + url.search, 301);
    }
    if (url.pathname === "/api/e")
      return handleEvent(request, env);
    if (url.pathname === "/api/stats")
      return handleStats(request, env);
    return env.ASSETS.fetch(request);
  }
};

// ../../cf/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../cf/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-3dnA4B/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../cf/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-3dnA4B/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  EventCounter,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
