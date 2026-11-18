/** Pure aggregation for the Team → Agent reviews leaderboard, plus a workspace loader. */
import { getDb } from "./supabase.js";


export type ReviewRow = {
  rating: number;
  comment: string | null;
  agent_id: string | null;
  agent_name: string | null;
  created_at: string;
  handled_by_human?: boolean;
};

export type HandledChat = {
  agent_id: string | null;
  agent_name: string | null;
  first_response_ms: number | null;
};

export type MemberHint = {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

export type AgentReviewCard = {
  key: string;
  agent_id: string | null;
  display_name: string;
  avatar_url: string | null;
  average_rating: number | null;
  ratings: number;
  chats_handled: number;
  median_first_response_ms: number | null;
  recent_comments: Array<{ rating: number; comment: string; created_at: string }>;
  rank: number;
};

export function agentKey(id?: string | null, name?: string | null): string {
  const cleanId = typeof id === "string" && id.trim() ? id.trim() : "";
  if (cleanId) return `id:${cleanId}`;
  const cleanName = typeof name === "string" && name.trim() ? name.trim().toLowerCase() : "";
  if (cleanName) return `name:${cleanName}`;
  return "unknown";
}

export function median(nums: number[]): number | null {
  const list = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

export function displayName(id: string | null, name: string | null, members: MemberHint[] = []): string {
  if (id) {
    const m = members.find((x) => x.id && x.id === id);
    if (m?.name?.trim()) return m.name.trim();
    if (m?.email?.trim()) return m.email.trim();
  }
  if (name && name.trim()) return name.trim();
  return "Agent";
}

export function avatarFor(id: string | null, members: MemberHint[] = []): string | null {
  if (!id) return null;
  return members.find((x) => x.id && x.id === id)?.avatar_url || null;
}

export function buildAgentReviewBoard(reviews: ReviewRow[], chats: HandledChat[], members: MemberHint[] = []): AgentReviewCard[] {
  const humanReviews = reviews.filter((r) => r.handled_by_human !== false && (r.agent_id || r.agent_name) && Number.isFinite(r.rating));
  const keys = new Set<string>();
  for (const r of humanReviews) keys.add(agentKey(r.agent_id, r.agent_name));
  for (const c of chats) keys.add(agentKey(c.agent_id, c.agent_name));
  keys.delete("unknown");

  const cards: AgentReviewCard[] = [];
  for (const key of keys) {
    const mine = humanReviews.filter((r) => agentKey(r.agent_id, r.agent_name) === key);
    const handled = chats.filter((c) => agentKey(c.agent_id, c.agent_name) === key);
    const sample = mine[0] || { agent_id: handled[0]?.agent_id || null, agent_name: handled[0]?.agent_name || null };
    const id = sample.agent_id || handled[0]?.agent_id || null;
    const name = sample.agent_name || handled[0]?.agent_name || null;
    const ratings = mine.map((r) => r.rating);
    const comments = mine
      .filter((r) => r.comment && r.comment.trim())
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, 5)
      .map((r) => ({ rating: r.rating, comment: String(r.comment).trim(), created_at: r.created_at }));
    const avg = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null;
    cards.push({
      key,
      agent_id: id,
      display_name: displayName(id, name, members),
      avatar_url: avatarFor(id, members),
      average_rating: avg,
      ratings: ratings.length,
      chats_handled: handled.length,
      median_first_response_ms: median(handled.map((c) => c.first_response_ms).filter((n): n is number => n != null && Number.isFinite(n))),
      recent_comments: comments,
      rank: 0,
    });
  }

  cards.sort((a, b) => {
    const ar = a.average_rating ?? -1;
    const br = b.average_rating ?? -1;
    if (br !== ar) return br - ar;
    if (b.ratings !== a.ratings) return b.ratings - a.ratings;
    if (b.chats_handled !== a.chats_handled) return b.chats_handled - a.chats_handled;
    return a.display_name.localeCompare(b.display_name);
  });
  cards.forEach((c, i) => { c.rank = i + 1; });
  return cards;
}

export function firstResponseMs(waitingSince: string | null | undefined, firstAgentAt: string | null | undefined): number | null {
  if (!waitingSince || !firstAgentAt) return null;
  const start = Date.parse(waitingSince);
  const first = Date.parse(firstAgentAt);
  if (!Number.isFinite(start) || !Number.isFinite(first) || first < start) return null;
  return first - start;
}

export async function loadAgentReviews(workspaceId: string): Promise<{ agents: AgentReviewCard[]; total_ratings: number }> {
  const db = getDb();
  const { data: sites } = await db.from("ghostchat_sites").select("id").eq("owner_id", workspaceId);
  const siteIds = (sites || []).map((s: { id: string }) => s.id);
  if (!siteIds.length) return { agents: [], total_ratings: 0 };

  const { data: reviewRows } = await db
    .from("ghostchat_csat")
    .select("rating, comment, agent_id, agent_name, created_at, handled_by_human")
    .in("site_id", siteIds)
    .eq("handled_by_human", true)
    .order("created_at", { ascending: false })
    .limit(2000);

  const { data: convs } = await db
    .from("ghostchat_live_conversations")
    .select("id, site_id, session_id, last_agent_id, last_agent_name, waiting_since, created_at")
    .in("site_id", siteIds)
    .not("last_agent_name", "is", null)
    .order("updated_at", { ascending: false })
    .limit(2000);

  const firstAgent = new Map<string, string>();
  if (convs && convs.length) {
    const { data: logs } = await db
      .from("ghostchat_logs")
      .select("site_id, session_id, created_at")
      .in("site_id", siteIds)
      .eq("role", "agent")
      .order("created_at", { ascending: true })
      .limit(4000);
    for (const l of logs || []) {
      const k = `${l.site_id}:${l.session_id}`;
      if (!firstAgent.has(k)) firstAgent.set(k, l.created_at);
    }
  }

  const chats: HandledChat[] = (convs || []).map((c: { last_agent_id: string | null; last_agent_name: string | null; waiting_since: string | null; created_at: string; site_id: string; session_id: string }) => ({
    agent_id: c.last_agent_id,
    agent_name: c.last_agent_name,
    first_response_ms: firstResponseMs(c.waiting_since || c.created_at, firstAgent.get(`${c.site_id}:${c.session_id}`)),
  }));

  const ids = new Set<string>();
  ids.add(workspaceId);
  for (const r of reviewRows || []) if (r.agent_id) ids.add(r.agent_id);
  for (const c of convs || []) if (c.last_agent_id) ids.add(c.last_agent_id);

  const { data: owners } = ids.size
    ? await db.from("ghostchat_owners").select("id, name, email, avatar_url").in("id", [...ids])
    : { data: [] as MemberHint[] };
  const members: MemberHint[] = (owners || []).map((o) => ({
    id: o.id ?? null, name: o.name ?? null, email: o.email ?? null, avatar_url: o.avatar_url ?? null,
  }));

  const agents = buildAgentReviewBoard((reviewRows || []) as ReviewRow[], chats, members);
  const total_ratings = agents.reduce((n, a) => n + a.ratings, 0);
  return { agents, total_ratings };
}
