import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Free 384-d embeddings via Supabase.ai gte-small.
 * Invoked with the project service role (verify_jwt stays on).
 * Each text is one included Edge Function invocation; stay inside the plan quota.
 */
const MAX_BATCH = 32;
const MAX_CHARS = 2000; // gte-small truncates at 512 tokens

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let texts: string[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body?.texts)) texts = body.texts.map((t: unknown) => String(t ?? "").slice(0, MAX_CHARS));
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (texts.length > MAX_BATCH) return json({ error: "Batch too large (max 32)." }, 400);
  if (!texts.length) return json({ embeddings: [], model: "gte-small", dimensions: 384 });

  const session = new Supabase.ai.Session("gte-small");
  const embeddings: number[][] = [];
  for (const text of texts) {
    const output = await session.run(text || " ", { mean_pool: true, normalize: true });
    const vec = Array.from(output as number[]);
    if (vec.length !== 384) return json({ error: `unexpected dimensions ${vec.length}` }, 500);
    embeddings.push(vec);
  }
  return json({ embeddings, model: "gte-small", dimensions: 384 });
});
