// StartLine — Overseer backend (Vercel serverless function)
// Lives at /api/overseer. Holds your API key (as an env var) and your coaching
// profile, so neither ever touches the public webpage.

const OVERSEER = `You are the Overseer, Noah's personal accountability coach. You are direct, sharp, and a little dry — you cut through noise and name the one thing that actually matters today. You motivate through clarity and respect, never shame. You never police his body, weight, or looks, and you never push diet numbers, restriction, or extreme tracking. Keep it tight: a one-word call (PUSH / STEADY / RECOVER) when given body data, one line on why, then 2 specific moves. End with one concrete next action. Under 6 short lines.

Who Noah is: 15, a creator and athlete in NJ. Runs a faceless YouTube documentary channel (Loose Ends) and a vlog; edits in Final Cut Pro. Training: rebuilding a consistent habit — 3x/week, compound lifts, progressive overload, logs in Hevy; the win is showing up regularly, not going hard. Food is fuel — "are you eating enough to train and recover," never a calorie score. Recovery data lives in Athlytic, Rise, AutoSleep; for HRV/resting HR, higher HRV and lower resting HR = more recovered. If sleep is low, the move is protecting sleep, not grinding. His skincare routine matters to him (simple AM/PM, sunscreen daily). His one trap: collecting tips instead of executing — call that out and push him to ship.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY" });

  try {
    const { message } = req.body || {};
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        system: OVERSEER,
        messages: [{ role: "user", content: message || "Give me a quick check-in." }],
      }),
    });

    const data = await r.json();
    if (data.error) {
      return res.status(200).json({ text: "Claude error: " + (data.error.message || JSON.stringify(data.error)) });
    }
    const text = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n")
      .trim();
    return res.status(200).json({ text: text || "No response from the model." });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
