// Overseer - Health pipe v4. Lives at /api/health.
// Accepts TWO input shapes on POST:
//   1) Flat (your Shortcut):  {"hrv":"68","rhr":"54","sleep":"7.4", ...any fields}
//   2) Health Auto Export:    {"data":{"metrics":[{"name":"heart_rate_variability","data":[{"qty":68,...}]}, ...]}}
// Stores a rolling daily history; GET returns latest + history + trends for every metric.
// Bodyweight / body-fat / lean-mass are deliberately ignored.

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
// Map Health Auto Export metric names -> our short keys. null = deliberately ignore.
const HAE_MAP = {
  heart_rate_variability: "hrv", heart_rate_variability_sdnn: "hrv",
  resting_heart_rate: "rhr", step_count: "steps",
  active_energy: "energy", active_energy_burned: "energy",
  basal_energy_burned: "restingenergy",
  dietary_energy: "kcal", dietary_energy_consumed: "kcal",
  protein: "protein", carbohydrates: "carbs", total_fat: "fat",
  vo2_max: "vo2max", respiratory_rate: "respiratory",
  blood_oxygen_saturation: "spo2", oxygen_saturation: "spo2",
  apple_exercise_time: "exercise", apple_stand_time: "stand",
  walking_heart_rate_average: "walkinghr", heart_rate_recovery: "hrr",
  apple_sleeping_wrist_temperature: "wristtemp", physical_effort: "effort",
  // deliberately ignored:
  weight_body_mass: null, body_fat_percentage: null, lean_body_mass: null, body_mass_index: null,
};
function fromHAE(b) {
  const out = {};
  const metrics = (b.data && b.data.metrics) || [];
  for (const m of metrics) {
    const name = m.name;
    const arr = Array.isArray(m.data) ? m.data : [];
    if (!arr.length) continue;
    const last = arr[arr.length - 1];
    if (name === "sleep_analysis") {
      const h = num(last.asleep) || ((num(last.core) || 0) + (num(last.deep) || 0) + (num(last.rem) || 0)) || num(last.totalSleep);
      if (h) out.sleep = h;
      continue;
    }
    if (HAE_MAP[name] === null) continue;
    const key = HAE_MAP[name] || name;
    let v = last.qty;
    if (v == null) v = last.Avg != null ? last.Avg : (last.avg != null ? last.avg : last.value);
    const n = num(v);
    if (n != null) out[key] = n;
  }
  return out;
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
      let fields;
      if (b && b.data && Array.isArray(b.data.metrics)) fields = fromHAE(b);
      else { fields = {}; for (const k in b) { const n = num(b[k]); if (n != null) fields[k] = n; } }
      const entry = { at: new Date().toISOString(), ...fields };
      let hist = [];
      try { const raw = await kv(["GET", HIST]); if (raw) hist = JSON.parse(raw); } catch (e) {}
      const day = entry.at.slice(0, 10);
      if (hist[0] && hist[0].at && hist[0].at.slice(0, 10) === day) hist[0] = { ...hist[0], ...entry }; // merge partial exports
      else hist.unshift(entry);
      hist = hist.slice(0, 90);
      await kv(["SET", HIST, JSON.stringify(hist)]);
      return res.status(200).json({ ok: true, data: hist[0] });
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
