/** Owner analytics, computed from recent chat logs (pure function so it is easy to test). */
export type LogRow = {
  id: string; session_id: string; role: string; message: string; was_unsure: boolean;
  feedback: string | null; page_url: string | null; created_at: string; lang?: string | null;
};

export function hourIn(iso: string, timeZone: string): number {
  try {
    const h = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone }).format(new Date(iso));
    return Number(h) % 24;
  } catch { return new Date(iso).getUTCHours(); }
}
function dayIn(iso: string, timeZone: string): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)); }
  catch { return iso.slice(0, 10); }
}
const norm = (t: string) => t.trim().toLowerCase().replace(/[?!.\s]+$/g, "").replace(/\s+/g, " ");

export function computeAnalytics(input: {
  logs: LogRow[]; leads: number; leadSessions?: string[]; csat?: number[]; tickets?: Array<{ status: string }>;
  timeZone?: string; now?: Date; days?: number;
}) {
  const tz = input.timeZone || "Europe/London";
  const rows = [...input.logs].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const questions = new Map<string, { message: string; count: number }>();
  const hours = new Array(24).fill(0) as number[];
  const sessions = new Set<string>();
  const langs = new Map<string, number>();
  const lastUser = new Map<string, LogRow>();
  const lowConfidence: Array<{ logId: string; question: string; answer: string; reason: "unsure" | "thumbs_down"; created_at: string }> = [];
  let up = 0, down = 0, assistant = 0, unsureCount = 0;
  const days = input.days ?? 14;
  const now = input.now ?? new Date();
  const daily = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) daily.set(dayIn(new Date(now.getTime() - i * 86400000).toISOString(), tz), 0);

  for (const r of rows) {
    if (r.role === "user") {
      sessions.add(r.session_id);
      lastUser.set(r.session_id, r);
      const key = norm(r.message || "");
      if (key) { const q = questions.get(key) || { message: r.message.trim(), count: 0 }; q.count++; questions.set(key, q); }
      hours[hourIn(r.created_at, tz)]++;
      const d = dayIn(r.created_at, tz);
      if (daily.has(d)) daily.set(d, (daily.get(d) || 0) + 1);
      if (r.lang) langs.set(r.lang, (langs.get(r.lang) || 0) + 1);
    } else if (r.role === "assistant") {
      assistant++;
      if (r.feedback === "up") up++;
      if (r.feedback === "down") down++;
      if (r.was_unsure) unsureCount++;
      if (r.was_unsure || r.feedback === "down") {
        const q = lastUser.get(r.session_id);
        lowConfidence.push({ logId: r.id, question: q?.message || "", answer: r.message, reason: r.was_unsure ? "unsure" : "thumbs_down", created_at: r.created_at });
      }
    }
  }
  const leadSessions = new Set((input.leadSessions || []).filter(Boolean));
  const converted = [...sessions].filter((s) => leadSessions.has(s)).length;
  const conversations = sessions.size;
  const csat = (input.csat || []).filter((n) => n >= 1 && n <= 5);
  const peak = hours.reduce((best, n, h) => (n > hours[best] ? h : best), 0);
  return {
    topQuestions: [...questions.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    lowConfidence: lowConfidence.reverse().slice(0, 30),
    conversion: {
      conversations, leads: input.leads, convertedConversations: converted,
      rate: conversations ? Math.round((Math.max(converted, Math.min(input.leads, conversations)) / conversations) * 1000) / 10 : 0,
    },
    hours, peakHour: hours[peak] ? peak : null, timeZone: tz,
    daily: [...daily.entries()].map(([date, count]) => ({ date, count })),
    answerRate: assistant ? Math.round(((assistant - unsureCount) / assistant) * 100) : null,
    languages: [...langs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([lang, count]) => ({ lang, count })),
    satisfaction: { up, down, rated: up + down, score: up + down ? Math.round((up / (up + down)) * 100) : null },
    csat: { count: csat.length, average: csat.length ? Math.round((csat.reduce((a, b) => a + b, 0) / csat.length) * 10) / 10 : null },
    tickets: input.tickets ? { open: input.tickets.filter((t) => t.status === "open").length, pending: input.tickets.filter((t) => t.status === "pending").length, solved: input.tickets.filter((t) => t.status === "solved").length } : null,
    totals: { messages: rows.length, assistant },
  };
}
