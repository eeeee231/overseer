// Overseer — Canvas pull (Vercel serverless function). Lives at /api/canvas.
// GET: fetches your upcoming assignments from Canvas and returns a clean list.
// Your token stays in an env var on the server — it never touches the webpage.
// Needs two env vars in Vercel:
//   CANVAS_BASE_URL  e.g. https://yourschool.instructure.com   (the site you log into)
//   CANVAS_TOKEN     a personal access token you generate in Canvas settings

export default async function handler(req, res) {
  const base = (process.env.CANVAS_BASE_URL || "").replace(/\/+$/, "");
  const tok = process.env.CANVAS_TOKEN;
  if (!base || !tok) {
    return res.status(200).json({ ok: false, error: "Canvas not configured" });
  }
  try {
    const start = new Date().toISOString().slice(0, 10);
    const url = `${base}/api/v1/planner/items?start_date=${start}&per_page=40`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) {
      return res.status(200).json({ ok: false, error: "Canvas " + r.status });
    }
    const arr = await r.json();
    const items = (Array.isArray(arr) ? arr : [])
      .map((it) => {
        const p = it.plannable || {};
        const title = p.title || p.name || it.context_name || "Untitled";
        const due = p.due_at || it.plannable_date || p.todo_date || null;
        const type = (it.plannable_type || "").toLowerCase();
        return {
          title,
          due: due ? String(due).slice(0, 10) : "",
          type,
          course: it.context_name || "",
        };
      })
      .filter((x) => x.due) // only dated items
      .sort((a, b) => (a.due < b.due ? -1 : 1))
      .slice(0, 25);
    return res.status(200).json({ ok: true, items });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
}
