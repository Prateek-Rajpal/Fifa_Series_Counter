/**
 * FC 26 series log — sync backend.
 *
 * GET  /pull?room=CODE   -> { series: [], matches: [], settings: {} | null, now }
 * POST /push             -> { ok: true, now }
 * GET  /health           -> { ok: true }
 *
 * The room code is the only credential. Anyone who has it can read and write
 * that room, which is the intended trade-off for a three-person score log.
 *
 * Merge rule everywhere: the row with the newer `updated` value wins. Deletes
 * are tombstones (deleted = 1), never real row removals, so a delete on one
 * phone is not undone by a phone that had not synced yet.
 */

const ROOM_RE = /^[A-Za-z0-9_-]{4,64}$/;
const MAX_ROWS = 5000;
const MAX_SETTINGS_BYTES = 64 * 1024;

// Set this to your site's origin (e.g. "https://pratz.github.io") to stop
// other sites calling your Worker from a browser. "*" allows any.
const ALLOWED_ORIGIN = "*";

const CORS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function str(v, max = 200) {
  return String(v == null ? "" : v).slice(0, max);
}

function requireRoom(room) {
  if (!ROOM_RE.test(String(room || ""))) {
    throw new HttpError("Room code must be 4-64 letters, numbers, dashes or underscores.", 400);
  }
  return String(room);
}

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function pull(url, env) {
  const room = requireRoom(url.searchParams.get("room"));

  const [series, matches, settings] = await Promise.all([
    env.DB.prepare(
      "SELECT id, created, updated, deleted FROM series WHERE room = ?"
    ).bind(room).all(),
    env.DB.prepare(
      "SELECT id, series_id, ord, pa, pb, ga, gb, ta, tb, updated, deleted FROM matches WHERE room = ?"
    ).bind(room).all(),
    env.DB.prepare(
      "SELECT json, updated FROM settings WHERE room = ?"
    ).bind(room).first(),
  ]);

  return json({
    series: series.results || [],
    matches: matches.results || [],
    settings: settings || null,
    now: Date.now(),
  });
}

async function push(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    throw new HttpError("Body must be JSON.", 400);
  }

  const room = requireRoom(body.room);
  const series = Array.isArray(body.series) ? body.series : [];
  const matches = Array.isArray(body.matches) ? body.matches : [];

  if (series.length + matches.length > MAX_ROWS) {
    throw new HttpError("Too many rows in one push.", 413);
  }

  const stmts = [];

  // The WHERE on DO UPDATE is what makes this last-writer-wins rather than
  // last-arriver-wins: an older row arriving late is simply ignored.
  const seriesUpsert = env.DB.prepare(
    `INSERT INTO series (room, id, created, updated, deleted)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(room, id) DO UPDATE SET
       created = excluded.created,
       updated = excluded.updated,
       deleted = excluded.deleted
     WHERE excluded.updated > series.updated`
  );

  for (const s of series) {
    if (!s || !s.id) continue;
    stmts.push(seriesUpsert.bind(
      room, str(s.id, 64), num(s.created), num(s.updated), s.deleted ? 1 : 0
    ));
  }

  const matchUpsert = env.DB.prepare(
    `INSERT INTO matches (room, id, series_id, ord, pa, pb, ga, gb, ta, tb, updated, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(room, id) DO UPDATE SET
       series_id = excluded.series_id,
       ord = excluded.ord,
       pa = excluded.pa, pb = excluded.pb,
       ga = excluded.ga, gb = excluded.gb,
       ta = excluded.ta, tb = excluded.tb,
       updated = excluded.updated,
       deleted = excluded.deleted
     WHERE excluded.updated > matches.updated`
  );

  for (const m of matches) {
    if (!m || !m.id || !m.series_id) continue;
    stmts.push(matchUpsert.bind(
      room, str(m.id, 64), str(m.series_id, 64), num(m.ord),
      str(m.pa, 32), str(m.pb, 32), num(m.ga), num(m.gb),
      str(m.ta, 80), str(m.tb, 80), num(m.updated), m.deleted ? 1 : 0
    ));
  }

  if (body.settings && typeof body.settings.json === "string") {
    if (body.settings.json.length > MAX_SETTINGS_BYTES) {
      throw new HttpError("Settings blob too large.", 413);
    }
    stmts.push(env.DB.prepare(
      `INSERT INTO settings (room, json, updated)
       VALUES (?, ?, ?)
       ON CONFLICT(room) DO UPDATE SET
         json = excluded.json,
         updated = excluded.updated
       WHERE excluded.updated > settings.updated`
    ).bind(room, body.settings.json, num(body.settings.updated)));
  }

  if (stmts.length) await env.DB.batch(stmts);

  return json({ ok: true, written: stmts.length, now: Date.now() });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);

    try {
      if (!env.DB) throw new HttpError("D1 binding 'DB' is missing on this Worker.", 500);

      if (url.pathname === "/health") return json({ ok: true, now: Date.now() });
      if (url.pathname === "/pull" && request.method === "GET") return await pull(url, env);
      if (url.pathname === "/push" && request.method === "POST") return await push(request, env);

      return json({ error: "Not found." }, 404);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      return json({ error: err.message || "Server error." }, status);
    }
  },
};
