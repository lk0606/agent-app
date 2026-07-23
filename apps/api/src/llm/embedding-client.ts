/**
 * 文本向量化客户端（E.7-B）。
 * 走 TokenHub OpenAI 兼容 /embeddings；与 chat 共用 baseURL/apiKey，模型单独配置。
 */
import OpenAI from "openai";

import { AppError } from "../shared/app-error.js";

export interface EmbeddingClient {
  /** 批量把文本转成固定维向量；顺序与入参 texts 一一对应 */
  embedTexts(texts: string[]): Promise<number[][]>;
}

export class TokenHubEmbeddingClient implements EmbeddingClient {
  private readonly client: OpenAI;

  constructor(private readonly options: { apiKey: string; model: string; baseURL: string }) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    try {
      const response = await this.client.embeddings.create({
        model: this.options.model,
        input: texts,
        // TokenHub kinfra embedding 仅支持 float，OpenAI SDK 默认可能带 base64
        encoding_format: "float",
      });

      const sorted = [...response.data].sort((a, b) => a.index - b.index);

      return sorted.map((item) => item.embedding);
    } catch (error) {
      throw new AppError(
        "LLM_ERROR",
        `Embedding API failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
