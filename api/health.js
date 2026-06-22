// Overseer — Health pipe v5. Lives at /api/health.
// Captures EVERYTHING Apple Health / Health Auto Export sends, grouped by body system.
// Accepts on POST:  flat Shortcut JSON {"hrv":"68",...}  OR  HAE {"data":{"metrics":[...]}}
// GET returns: latest reading, 90-day history, trends for every metric, and a meta map
// (label / unit / direction / system) so the dashboard can render any signal correctly.
// Bodyweight / body-fat / lean-mass / BMI are deliberately never stored.

async function kv(cmd) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) throw new Error("No storage connected (add Upstash Redis in Vercel)");
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify(cmd) });
  return (await r.json()).result;
}
function num(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}

// Full catalog: HAE metric name -> {key, unit, good (true=higher better/false=lower better/null=neutral), sys, agg}
// agg: "sum" for cumulative daily totals, "avg" for instantaneous readings.
const D = {
  // --- cardiovascular ---
  heart_rate_variability:      { key:"hrv",        unit:"ms",     good:true,  sys:"cardio",      agg:"avg", label:"HRV" },
  heart_rate_variability_sdnn: { key:"hrv",        unit:"ms",     good:true,  sys:"cardio",      agg:"avg", label:"HRV" },
  resting_heart_rate:          { key:"rhr",        unit:"bpm",    good:false, sys:"cardio",      agg:"avg", label:"Resting HR" },
  walking_heart_rate_average:  { key:"walkinghr",  unit:"bpm",    good:false, sys:"cardio",      agg:"avg", label:"Walking HR" },
  heart_rate_recovery:         { key:"hrr",        unit:"bpm",    good:true,  sys:"cardio",      agg:"avg", label:"HR recovery" },
  blood_pressure_systolic:     { key:"bp_sys",     unit:"",       good:false, sys:"cardio",      agg:"avg", label:"BP systolic" },
  blood_pressure_diastolic:    { key:"bp_dia",     unit:"",       good:false, sys:"cardio",      agg:"avg", label:"BP diastolic" },
  // --- respiratory & blood ---
  blood_oxygen_saturation:     { key:"spo2",       unit:"%",      good:true,  sys:"respiratory", agg:"avg", label:"Blood O₂" },
  oxygen_saturation:           { key:"spo2",       unit:"%",      good:true,  sys:"respiratory", agg:"avg", label:"Blood O₂" },
  respiratory_rate:            { key:"respiratory",unit:"br/min", good:false, sys:"respiratory", agg:"avg", label:"Respiratory" },
  // --- aerobic fitness ---
  vo2_max:                     { key:"vo2max",     unit:"",       good:true,  sys:"fitness",     agg:"avg", label:"VO₂ max" },
  cardio_fitness:              { key:"vo2max",     unit:"",       good:true,  sys:"fitness",     agg:"avg", label:"VO₂ max" },
  six_minute_walking_test_distance:{ key:"sixminwalk", unit:"m",  good:true,  sys:"fitness",     agg:"avg", label:"6-min walk" },
  physical_effort:             { key:"effort",     unit:"MET",    good:true,  sys:"fitness",     agg:"avg", label:"Effort" },
  // --- activity & energy ---
  active_energy:               { key:"energy",     unit:"kcal",   good:true,  sys:"activity",    agg:"sum", label:"Active energy" },
  active_energy_burned:        { key:"energy",     unit:"kcal",   good:true,  sys:"activity",    agg:"sum", label:"Active energy" },
  basal_energy_burned:         { key:"restingenergy",unit:"kcal", good:null,  sys:"activity",    agg:"sum", label:"Resting energy" },
  apple_exercise_time:         { key:"exercise",   unit:"min",    good:true,  sys:"activity",    agg:"sum", label:"Exercise" },
  apple_stand_hour:            { key:"stand",      unit:"h",      good:true,  sys:"activity",    agg:"sum", label:"Stand hrs" },
  apple_stand_time:            { key:"standmin",   unit:"min",    good:true,  sys:"activity",    agg:"sum", label:"Stand min" },
  step_count:                  { key:"steps",      unit:"",       good:true,  sys:"activity",    agg:"sum", label:"Steps" },
  walking_running_distance:    { key:"distance",   unit:"km",     good:true,  sys:"activity",    agg:"sum", label:"Distance" },
  flights_climbed:             { key:"flights",    unit:"",       good:true,  sys:"activity",    agg:"sum", label:"Flights" },
  distance_cycling:            { key:"cycling",    unit:"km",     good:true,  sys:"activity",    agg:"sum", label:"Cycling" },
  swimming_stroke_count:       { key:"swimstrokes",unit:"",       good:true,  sys:"activity",    agg:"sum", label:"Swim strokes" },
  // --- sleep architecture ---
  apple_sleeping_wrist_temperature:{ key:"wristtemp", unit:"°", good:null,  sys:"sleep",       agg:"avg", label:"Wrist temp" },
  // --- fuel & nutrition ---
  dietary_energy:              { key:"kcal",       unit:"kcal",   good:true,  sys:"fuel",        agg:"sum", label:"Fuel" },
  dietary_energy_consumed:     { key:"kcal",       unit:"kcal",   good:true,  sys:"fuel",        agg:"sum", label:"Fuel" },
  protein:                     { key:"protein",    unit:"g",      good:true,  sys:"fuel",        agg:"sum", label:"Protein" },
  carbohydrates:               { key:"carbs",      unit:"g",      good:true,  sys:"fuel",        agg:"sum", label:"Carbs" },
  total_fat:                   { key:"fat",        unit:"g",      good:null,  sys:"fuel",        agg:"sum", label:"Fat" },
  fiber:                       { key:"fiber",      unit:"g",      good:true,  sys:"fuel",        agg:"sum", label:"Fiber" },
  dietary_sugar:               { key:"sugar",      unit:"g",      good:false, sys:"fuel",        agg:"sum", label:"Sugar" },
  sodium:                      { key:"sodium",     unit:"mg",     good:null,  sys:"fuel",        agg:"sum", label:"Sodium" },
  dietary_caffeine:            { key:"caffeine",   unit:"mg",     good:null,  sys:"fuel",        agg:"sum", label:"Caffeine" },
  dietary_water:               { key:"water",      unit:"L",      good:true,  sys:"fuel",        agg:"sum", label:"Water" },
  water:                       { key:"water",      unit:"L",      good:true,  sys:"fuel",        agg:"sum", label:"Water" },
  // --- movement quality / gait ---
  walking_speed:               { key:"walkspeed",  unit:"km/h",   good:true,  sys:"gait",        agg:"avg", label:"Walk speed" },
  walking_step_length:         { key:"steplen",    unit:"cm",     good:true,  sys:"gait",        agg:"avg", label:"Step length" },
  walking_asymmetry_percentage:{ key:"asymmetry",  unit:"%",      good:false, sys:"gait",        agg:"avg", label:"Asymmetry" },
  walking_double_support_percentage:{ key:"doublesupport", unit:"%", good:false, sys:"gait",    agg:"avg", label:"Double support" },
  apple_walking_steadiness:    { key:"steadiness", unit:"%",      good:true,  sys:"gait",        agg:"avg", label:"Steadiness" },
  // --- body signals / environment / mind ---
  body_temperature:            { key:"bodytemp",   unit:"°",      good:null,  sys:"signals",     agg:"avg", label:"Body temp" },
  mindful_minutes:             { key:"mindful",    unit:"min",    good:true,  sys:"signals",     agg:"sum", label:"Mindful" },
  time_in_daylight:            { key:"daylight",   unit:"min",    good:true,  sys:"signals",     agg:"sum", label:"Daylight" },
  environmental_audio_exposure:{ key:"envaudio",   unit:"dB",     good:false, sys:"signals",     agg:"avg", label:"Env audio" },
  headphone_audio_exposure:    { key:"headphoneaudio",unit:"dB",  good:false, sys:"signals",     agg:"avg", label:"Headphone audio" },
};
// Sleep stages handled specially below; their meta:
const SLEEP_META = {
  sleep:      { unit:"h", good:true,  sys:"sleep", label:"Asleep" },
  sleep_rem:  { unit:"h", good:true,  sys:"sleep", label:"REM" },
  sleep_deep: { unit:"h", good:true,  sys:"sleep", label:"Deep" },
  sleep_core: { unit:"h", good:true,  sys:"sleep", label:"Core" },
  sleep_awake:{ unit:"h", good:false, sys:"sleep", label:"Awake" },
  sleep_inbed:{ unit:"h", good:null,  sys:"sleep", label:"In bed" },
  sleep_eff:  { unit:"%", good:true,  sys:"sleep", label:"Efficiency" },
};
const HR_META = {
  hr_avg: { unit:"bpm", good:false, sys:"cardio", label:"Avg HR" },
  hr_min: { unit:"bpm", good:false, sys:"cardio", label:"Min HR" },
  hr_max: { unit:"bpm", good:null,  sys:"cardio", label:"Max HR" },
};
const IGNORE = new Set(["weight_body_mass","body_mass_index","body_fat_percentage","lean_body_mass","waist_circumference","body_mass"]);

function aggregate(arr, mode) {
  const vals = arr.map(d => num(d.qty != null ? d.qty : (d.Avg != null ? d.Avg : d.value))).filter(v => v != null);
  if (!vals.length) return null;
  if (mode === "sum") return vals.reduce((a, b) => a + b, 0);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
function parseSleep(arr) {
  const s = {};
  for (const d of arr) for (const f of ["asleep","inBed","core","deep","rem","awake","totalSleep"]) {
    const v = num(d[f]); if (v != null) s[f] = (s[f] || 0) + v;
  }
  const out = {};
  const asleep = s.totalSleep != null ? s.totalSleep : (s.asleep != null ? s.asleep : (((s.core||0)+(s.deep||0)+(s.rem||0))||null));
  if (asleep != null) out.sleep = asleep;
  if (s.rem != null) out.sleep_rem = s.rem;
  if (s.deep != null) out.sleep_deep = s.deep;
  if (s.core != null) out.sleep_core = s.core;
  if (s.awake != null) out.sleep_awake = s.awake;
  if (s.inBed != null) out.sleep_inbed = s.inBed;
  if (out.sleep != null && s.inBed) out.sleep_eff = Math.round((out.sleep / s.inBed) * 100);
  return out;
}
function round(v){ return v == null ? null : Math.round(v * 100) / 100; }

function fromHAE(b) {
  const out = {};
  for (const m of (b.data && b.data.metrics) || []) {
    const name = (m.name || "").toLowerCase();
    const arr = Array.isArray(m.data) ? m.data : [];
    if (!arr.length || IGNORE.has(name)) continue;
    if (name === "sleep_analysis") { Object.assign(out, parseSleep(arr)); continue; }
    if (name === "heart_rate") {
      const avgs = arr.map(d => num(d.Avg != null ? d.Avg : d.qty)).filter(v => v != null);
      const mins = arr.map(d => num(d.Min)).filter(v => v != null);
      const maxs = arr.map(d => num(d.Max)).filter(v => v != null);
      if (avgs.length) out.hr_avg = round(avgs.reduce((a,b)=>a+b,0)/avgs.length);
      if (mins.length) out.hr_min = Math.min(...mins);
      if (maxs.length) out.hr_max = Math.max(...maxs);
      continue;
    }
    const def = D[name];
    const v = aggregate(arr, def ? def.agg : "avg");
    if (v == null) continue;
    out[def ? def.key : name.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")] = round(v);
  }
  return out;
}

function metaMap(keys) {
  const out = {};
  const byKey = {};
  for (const name in D) byKey[D[name].key] = D[name];
  for (const k of keys) {
    if (k === "at") continue;
    const d = byKey[k] || SLEEP_META[k] || HR_META[k];
    out[k] = d ? { label: d.label, unit: d.unit, good: d.good, sys: d.sys } : { label: k, unit: "", good: null, sys: "other" };
  }
  return out;
}
function trend(hist, key) {
  const vals = hist.map(h => h[key]).filter(v => v != null && !isNaN(v));
  if (!vals.length) return null;
  const latest = vals[0], base = vals.slice(1, 31);
  if (!base.length) return { latest, avg: null, pct: null, n: vals.length };
  const avg = base.reduce((a, b) => a + b, 0) / base.length;
  return { latest, avg: Math.round(avg * 100) / 100, pct: avg ? Math.round(((latest - avg) / avg) * 100) : null, n: vals.length };
}
function allTrends(hist) {
  const keys = new Set(); hist.forEach(h => Object.keys(h).forEach(k => k !== "at" && keys.add(k)));
  const out = {}; keys.forEach(k => out[k] = trend(hist, k)); return out;
}

export default async function handler(req, res) {
  const HIST = "overseer:health:hist";
  try {
    if (req.method === "POST") {
      const secret = process.env.OVERSEER_SECRET;
      if (secret && req.headers["x-overseer-secret"] !== secret && (req.body || {}).secret !== secret)
        return res.status(401).json({ ok: false, error: "bad secret" });
      const b = req.body || {};
      let fields;
      if (b && b.data && Array.isArray(b.data.metrics)) fields = fromHAE(b);
      else { fields = {}; for (const k in b) { if (IGNORE.has(k) || k === "secret") continue; const n = num(b[k]); if (n != null) fields[k] = n; } }
      if (!Object.keys(fields).length) return res.status(200).json({ ok: false, error: "no recognizable metrics in payload" });
      const entry = { at: new Date().toISOString(), ...fields };
      let hist = []; try { const raw = await kv(["GET", HIST]); if (raw) hist = JSON.parse(raw); } catch (e) {}
      const day = entry.at.slice(0, 10);
      if (hist[0] && hist[0].at && hist[0].at.slice(0, 10) === day) hist[0] = { ...hist[0], ...entry };
      else hist.unshift(entry);
      hist = hist.slice(0, 90);
      await kv(["SET", HIST, JSON.stringify(hist)]);
      return res.status(200).json({ ok: true, stored: Object.keys(fields), count: hist.length });
    }
    if (req.method === "GET") {
      let hist = []; try { const raw = await kv(["GET", HIST]); if (raw) hist = JSON.parse(raw); } catch (e) {}
      const keys = new Set(); hist.forEach(h => Object.keys(h).forEach(k => keys.add(k)));
      return res.status(200).json({ ok: true, data: hist[0] || null, history: hist, trends: allTrends(hist), meta: metaMap([...keys]) });
    }
    return res.status(405).json({ ok: false, error: "GET or POST only" });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
}
