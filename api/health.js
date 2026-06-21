// Overseer — Health pipe (Vercel serverless function). Lives at /api/health.
// POST  (from your Apple Shortcut): stores the latest health snapshot.
// GET   (from the hub): returns the latest snapshot.
// Storage = Upstash Redis (free, from the Vercel Marketplace). Speaks plain HTTP,
// so no packages needed — it just reads two env vars Vercel injects for you.

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

export default async function handler(req, res) {
  const KEY = "overseer:health";
  try {
    if (req.method === "POST") {
      // Optional: if you set OVERSEER_SECRET in Vercel, the Shortcut must send it.
      const secret = process.env.OVERSEER_SECRET;
      if (secret && req.headers["x-overseer-secret"] !== secret) {
        return res.status(401).json({ ok: false, error: "bad secret" });
      }
      const b = req.body || {};
      const data = {
        sleep: num(b.sleep),
        hrv: num(b.hrv),
        rhr: num(b.rhr),
        steps: num(b.steps),
        energy: num(b.energy),
        at: new Date().toISOString(),
      };
      await kv(["SET", KEY, JSON.stringify(data)]);
      return res.status(200).json({ ok: true, data });
    }
    if (req.method === "GET") {
      const raw = await kv(["GET", KEY]);
      return res.status(200).json({ ok: true, data: raw ? JSON.parse(raw) : null });
    }
    return res.status(405).json({ ok: false, error: "GET or POST only" });
  } catch (e) {
    // Always 200 with ok:false so the hub keeps working even before storage is set up.
    return res.status(200).json({ ok: false, error: String(e) });
  }
}
