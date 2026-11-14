import path from "node:path";
import { pipeline, env } from "@xenova/transformers";

env.cacheDir = path.join(process.cwd(), ".cache", "transformers");
console.log("Prefetching Xenova/all-MiniLM-L6-v2 into", env.cacheDir);
await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
console.log("Local embeddings model cached.");
