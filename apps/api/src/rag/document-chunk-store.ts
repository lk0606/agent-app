/**
 * document_chunks 表读写（E.7-B 向量索引持久化）。
 * rag:index 全量 replace；search_docs 在 vector/hybrid 模式下列出全部 chunk 做内存检索。
 */
import type { Pool } from "pg";

export interface StoredDocumentChunk {
  sourcePath: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
}

export class PostgresDocumentChunkStore {
  constructor(private readonly pool: Pool) {}

  async count(): Promise<number> {
    const result = await this.pool.query<{ count: string }>("select count(*)::text as count from document_chunks");
    return Number(result.rows[0]?.count ?? 0);
  }

  async listAll(): Promise<StoredDocumentChunk[]> {
    const result = await this.pool.query<{
      source_path: string;
      chunk_index: number;
      text: string;
      embedding: number[];
    }>(
      `select source_path, chunk_index, text, embedding
       from document_chunks
       order by source_path asc, chunk_index asc`,
    );

    return result.rows.map((row) => ({
      sourcePath: row.source_path,
      chunkIndex: row.chunk_index,
      text: row.text,
      embedding: row.embedding,
    }));
  }

  /** 全量替换索引：fixture 变更后 rag:index 先删后插，保证与沙箱文件一致 */
  async replaceAll(chunks: StoredDocumentChunk[]): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("begin");
      await client.query("delete from document_chunks");

      for (const chunk of chunks) {
        await client.query(
          `insert into document_chunks (source_path, chunk_index, text, embedding)
           values ($1, $2, $3, $4::jsonb)`,
          [chunk.sourcePath, chunk.chunkIndex, chunk.text, JSON.stringify(chunk.embedding)],
        );
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
