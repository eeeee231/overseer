// Overseer — Canvas pull v2. Lives at /api/canvas.
// GET: returns upcoming assignments + your courses with current grades.
// Token + base URL stay in env vars on the server.
//   CANVAS_BASE_URL  e.g. https://somsd.instructure.com
//   CANVAS_TOKEN     your personal access token

export default async function handler(req, res) {
  const base = (process.env.CANVAS_BASE_URL || "").replace(/\/+$/, "");
  const tok = process.env.CANVAS_TOKEN;
  if (!base || !tok) return res.status(200).json({ ok: false, error: "Canvas not configured" });
  const H = { Authorization: `Bearer ${tok}` };
  try {
    // Upcoming assignments (planner)
    let items = [];
    try {
      const start = new Date().toISOString().slice(0, 10);
      const r = await fetch(`${base}/api/v1/planner/items?start_date=${start}&per_page=40`, { headers: H });
      if (r.ok) {
        const arr = await r.json();
        items = (Array.isArray(arr) ? arr : []).map((it) => {
          const p = it.plannable || {};
          const due = p.due_at || it.plannable_date || p.todo_date || null;
          return { title: p.title || p.name || it.context_name || "Untitled", due: due ? String(due).slice(0, 10) : "", course: it.context_name || "" };
        }).filter((x) => x.due).sort((a, b) => (a.due < b.due ? -1 : 1)).slice(0, 25);
      }
    } catch (e) {}
    // Courses + current grades
    let courses = [];
    try {
      const r = await fetch(`${base}/api/v1/courses?enrollment_state=active&include[]=total_scores&per_page=50`, { headers: H });
      if (r.ok) {
        const arr = await r.json();
        courses = (Array.isArray(arr) ? arr : []).map((c) => {
          const en = (c.enrollments || []).find((e) => e.type === "student") || {};
          return { name: c.name || "Course", score: en.computed_current_score != null ? en.computed_current_score : null, grade: en.computed_current_grade || null };
        }).filter((c) => c.name && (c.score != null || c.name !== "Course"));
      }
    } catch (e) {}
    return res.status(200).json({ ok: true, items, courses });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
}
