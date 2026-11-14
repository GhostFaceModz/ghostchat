import path from "node:path";

export const LOCAL_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const LOCAL_EMBEDDING_DIMENSIONS = 384;

type FeatureExtractor = (
  text: string,
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: ArrayLike<number> }>;

let extractorPromise: Promise<FeatureExtractor> | null = null;

function cacheDir(): string {
  return path.join(process.cwd(), ".cache", "transformers");
}

async function loadExtractor(): Promise<FeatureExtractor> {
  const { pipeline, env } = await import("@xenova/transformers");
  env.allowLocalModels = true;
  env.cacheDir = cacheDir();
  // Keep memory predictable on Render's free plan.
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1;
  }
  const extractor = await pipeline("feature-extraction", LOCAL_EMBEDDING_MODEL);
  return extractor as unknown as FeatureExtractor;
}

export async function getLocalExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) extractorPromise = loadExtractor();
  return extractorPromise;
}

export async function warmupLocalEmbeddings(): Promise<void> {
  await getLocalExtractor();
}

export async function localEmbed(texts: string[]): Promise<number[][]> {
  const extractor = await getLocalExtractor();
  const vectors: number[][] = [];
  for (const text of texts) {
    const trimmed = text.slice(0, 8000);
    const result = await extractor(trimmed, { pooling: "mean", normalize: true });
    const values = Array.from(result.data);
    if (values.length !== LOCAL_EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Local embeddings returned ${values.length} dimensions; expected ${LOCAL_EMBEDDING_DIMENSIONS}.`,
      );
    }
    vectors.push(values);
  }
  return vectors;
}
