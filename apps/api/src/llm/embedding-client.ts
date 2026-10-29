/**
 * 文本向量化客户端（E.7-B）。
 * 走 TokenHub OpenAI 兼容 /embeddings；与 chat 共用 baseURL/apiKey，模型单独配置。
 */
import OpenAI from "openai";

import { rethrowIfLlmAborted } from "../runtime/abort-utils.js";
import { AppError } from "../shared/app-error.js";

export interface EmbeddingClient {
  /**
   * 批量把文本转成固定维向量；顺序与入参 texts 一一对应。
   * signal 来自任务上下文：任务取消/超时时，中止正在进行的 embedding HTTP 请求。
   */
  embedTexts(texts: string[], options?: { signal?: AbortSignal }): Promise<number[][]>;
}

export class TokenHubEmbeddingClient implements EmbeddingClient {
  private readonly client: OpenAI;

  constructor(private readonly options: { apiKey: string; model: string; baseURL: string }) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      // E.16：search_docs 不做外层自动重试，SDK 也固定为一次，避免隐藏的成本放大。
      maxRetries: 0,
    });
  }

  async embedTexts(texts: string[], requestOptions?: { signal?: AbortSignal }): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    try {
      const response = await this.client.embeddings.create({
        model: this.options.model,
        input: texts,
        // TokenHub kinfra embedding 仅支持 float，OpenAI SDK 默认可能带 base64
        encoding_format: "float",
      }, {
        // 关键点：把上层 AbortSignal 传给 OpenAI SDK/fetch，而不是只在请求结束后检查取消。
        signal: requestOptions?.signal,
      });

      const sorted = [...response.data].sort((a, b) => a.index - b.index);

      return sorted.map((item) => item.embedding);
    } catch (error: unknown) {
      // SDK 因 signal 中止而抛错时，转换/保留为 CANCELLED 或 TIMEOUT_ERROR，不能误包装成普通 LLM_ERROR。
      rethrowIfLlmAborted(error);
      throw new AppError(
        "LLM_ERROR",
        `Embedding API failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
