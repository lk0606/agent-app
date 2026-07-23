  /**
 * 离线建文档向量索引：遍历沙箱切块 → 调 Embedding API → 写入 document_chunks。
 * 供 `pnpm run rag:index` 与 eval 启动前自动补索引共用。
 */
import type { Pool } from "pg";

import type { EmbeddingClient } from "../llm/embedding-client.js";
import { DocumentIndex } from "./document-index.js";
import { PostgresDocumentChunkStore } from "./document-chunk-store.js";

const DEFAULT_BATCH_SIZE = 16;

export interface BuildDocumentIndexOptions {
  rootDir: string;
  allowedExtensions: string[];
  deniedBasenames: string[];
  chunkChars: number;
  batchSize?: number;
}

export async function buildAndStoreDocumentIndex(
  pool: Pool,
  embeddingClient: EmbeddingClient,
  options: BuildDocumentIndexOptions,
): Promise<{ chunkCount: number }> {
  const index = new DocumentIndex({
    rootDir: options.rootDir,
    allowedExtensions: options.allowedExtensions,
    deniedBasenames: options.deniedBasenames,
    chunkChars: options.chunkChars,
  });

  await index.build();
  const chunks = index.getChunks();

  if (chunks.length === 0) {
    const store = new PostgresDocumentChunkStore(pool);
    await store.replaceAll([]);
    return { chunkCount: 0 };
  }

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const embeddings: number[][] = [];

  for (let start = 0; start < chunks.length; start += batchSize) {
    const batch = chunks.slice(start, start + batchSize);
    const batchEmbeddings = await embeddingClient.embedTexts(batch.map((chunk) => chunk.text));
    embeddings.push(...batchEmbeddings);
  }

  const stored = chunks.map((chunk, chunkIndex) => ({
    sourcePath: chunk.sourcePath,
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
    embedding: embeddings[chunkIndex] ?? [],
  }));

  const store = new PostgresDocumentChunkStore(pool);
  await store.replaceAll(stored);

  return { chunkCount: stored.length };
}
