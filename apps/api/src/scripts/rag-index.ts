import "dotenv/config";

import { loadConfig } from "../config/env.js";
import { getDatabaseConfig } from "../db/connection-config.js";
import { createPgPool, verifyPgConnection } from "../db/pg-client.js";
import { TokenHubEmbeddingClient } from "../llm/embedding-client.js";
import { buildAndStoreDocumentIndex } from "../rag/build-document-index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const database = getDatabaseConfig(config);
  const pool = createPgPool({
    connectionString: database.url,
  });

  await verifyPgConnection(pool);

  const embeddingClient = new TokenHubEmbeddingClient({
    apiKey: config.hunyuanApiKey,
    model: config.hunyuanEmbeddingModel,
    baseURL: config.hunyuanBaseUrl,
  });

  const startedAt = Date.now();
  const result = await buildAndStoreDocumentIndex(pool, embeddingClient, {
    rootDir: config.readFileRootDir,
    allowedExtensions: config.readFileAllowedExtensions,
    deniedBasenames: config.readFileDeniedBasenames,
    chunkChars: config.searchDocsChunkChars,
  });

  console.log(
    JSON.stringify(
      {
        chunkCount: result.chunkCount,
        mode: config.searchDocsMode,
        embeddingModel: config.hunyuanEmbeddingModel,
        durationMs: Date.now() - startedAt,
      },
      null,
      2,
    ),
  );

  await pool.end();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
