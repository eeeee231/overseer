// Overseer - Health pipe v3. Lives at /api/health.
// POST (from Shortcut): accepts ANY numeric health fields you send (hrv, rhr, sleep,
//   steps, energy, kcal, protein, carbs, vo2max, hrr, respiratory, spo2, exercise,
//   stand, walkinghr, ... anything). Stores a rolling daily history.
// GET (from hub): returns latest + history + trends for every metric seen.
// Everything you send is fed to the AI even if the screen only shows the headline ones.

async function kv(cmd) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) throw new Error("No storage connected (add Upstash Redis in Vercel)");
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const d = await r.json();
  return d.result;
}
function num(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}
function trend(hist, key) {
  const vals = hist.map((h) => h[key]).filter((v) => v != null && !isNaN(v));
  if (vals.length === 0) return null;
  const latest = vals[0];
  const base = vals.slice(1, 8);
  if (base.length === 0) return { latest, avg: null, pct: null, n: vals.length };
  const avg = base.reduce((a, b) => a + b, 0) / base.length;
  const pct = avg ? Math.round(((latest - avg) / avg) * 100) : null;
  return { latest, avg: Math.round(avg * 10) / 10, pct, n: vals.length };
}
function allTrends(hist) {
  const keys = new Set();
  hist.forEach((h) => Object.keys(h).forEach((k) => { if (k !== "at") keys.add(k); }));
  const out = {};
  keys.forEach((k) => { out[k] = trend(hist, k); });
  return out;
}

export default async function handler(req, res) {
  const HIST = "overseer:health:hist";
  try {
    if (req.method === "POST") {
      const secret = process.env.OVERSEER_SECRET;
      if (secret && req.headers["x-overseer-secret"] !== secret) {
        return res.status(401).json({ ok: false, error: "bad secret" });
      }
      const b = req.body || {};
      const entry = { at: new Date().toISOString() };
      for (const k in b) { const n = num(b[k]); if (n != null) entry[k] = n; }
      let hist = [];
      try { const raw = await kv(["GET", HIST]); if (raw) hist = JSON.parse(raw); } catch (e) {}
      const day = entry.at.slice(0, 10);
      if (hist[0] && hist[0].at && hist[0].at.slice(0, 10) === day) hist[0] = { ...hist[0], ...entry };
      else hist.unshift(entry);
      hist = hist.slice(0, 90);
      await kv(["SET", HIST, JSON.stringify(hist)]);
      return res.status(200).json({ ok: true, data: entry });
    }
    if (req.method === "GET") {
      let hist = [];
      try { const raw = await kv(["GET", HIST]); if (raw) hist = JSON.parse(raw); } catch (e) {}
      return res.status(200).json({ ok: true, data: hist[0] || null, history: hist, trends: allTrends(hist) });
    }
    return res.status(405).json({ ok: false, error: "GET or POST only" });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
}
