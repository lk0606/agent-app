# Embedding 与余弦相似度（E.7-B 野路子理解）

> 对应源码：`apps/api/src/llm/embedding-client.ts`、`apps/api/src/rag/cosine-similarity.ts`、`apps/api/src/rag/document-index.ts`  
> 总览：[`lightweight-rag-plan.md`](./lightweight-rag-plan.md) · 工具细节：[`search-docs-tool-notes.md`](./search-docs-tool-notes.md)

本文只讲两件事：**文本怎么变成向量**、**两个向量怎么比「像不像」**。不讲向量库产品选型。

---

## 1. Embedding = 自然语言向量化

一句话：把一段文本映射成**固定长度的数字数组**，语义相近的文本 → 在空间里方向也接近。

| | 说明 |
|---|------|
| **入参** | 一段（或多段）文本，如 `"怎么取消订单"` |
| **出参** | `number[]`，维数由模型决定（常几百～上千） |
| **不负责** | 回答问题；只负责「压成可比的坐标」 |

本仓库：

```ts
// embedding-client.ts
embedTexts(texts: string[]): Promise<number[][]>
// 入参 texts[i] → 出参 vectors[i]，顺序一一对应
```

走 TokenHub OpenAI 兼容 `/embeddings`；与 chat 共用 baseURL/apiKey，模型单独配（默认 `kinfra-text-embedding-0.6b`），且须 `encoding_format: "float"`。

**边界：** 不只口语——文档 chunk、标题、代码片段都可以 embed。输入是「文本」，不限于自然语言聊天。

---

## 2. 为什么要用向量比，而不是字符串比

| 方式 | 「台北」搜 "Taipei" |
|------|---------------------|
| 关键词（E.7-A） | 字面无重叠 → 常漏召 |
| 向量（E.7-B） | 语义近 → 余弦分数高 → 能召回 |

心智模型：

```text
离线 rag:index
  每个 chunk 文本 → embed → 存 document_chunks

在线 search_docs
  query 文本 → embed 一次
  与每个 chunk 向量算余弦相似度 → 分数排序 → Top-K 片段给 LLM
```

---

## 3. 余弦相似度：入参 / 出参

```ts
cosineSimilarity(left: number[], right: number[]): number
```

| | 是什么 | 例子（假装只有 3 维，真实是几百～上千维） |
|---|---|---|
| **入参 `left`** | 第一条文本的 embedding | query：`[0.2, 0.5, 0.1]` |
| **入参 `right`** | 另一条文本的 embedding | 某个 chunk：`[0.3, 0.4, 0.2]` |
| **出参** | 一个分数，大致在 `[-1, 1]` | `0.97` 很像，`0.1` 不太像 |

两边必须**同长度**（同一 embedding 模型出来的维数一样）。长度不同或空数组 → 直接 `0`。

分数直觉（补充）：

| 分数 | 野路子理解 |
|------|------------|
| ≈ `1` | 方向几乎一样，语义很近 |
| ≈ `0` | 正交，不太沾边 |
| ≈ `-1` | 完全反向（文本里少见） |

---

## 4. 公式怎么对上代码（分子 / 分母）

```text
        A · B              dot
cosθ = ─────────  =  ─────────────────────────
       ‖A‖ · ‖B‖     √leftNorm × √rightNorm
```

一次循环把三样东西算完：

```text
下标 i=0,1,2,...（每一维）

分子 dot：
  left[0]*right[0] + left[1]*right[1] + left[2]*right[2] + ...
  → 「同一维上，两边是不是一起大/一起小」

leftNorm：
  left[0]² + left[1]² + left[2]² + ...
  → left 有多「长」（还没开方）

rightNorm：
  right[0]² + right[1]² + ...
  → right 有多「长」

分母：
  √leftNorm × √rightNorm
  → 真正的长度相乘，把长短抹掉，只留方向
```

出参：`dot / 分母`。

**核心直觉：比夹角（方向），不比长度。** 同一句话两种说法，向量可能长短不同，但方向接近 → 分数仍高。

---

## 5. 假数字手算（建立肌肉记忆）

```text
left  = [1, 0]     // 朝右
right = [1, 0]     // 也朝右
dot=1, 分母=1×1 → 分数=1   （一模一样）
```

```text
left  = [1, 0]
right = [0, 1]     // 朝上，垂直
dot=0 → 分数=0     （不沾边）
```

```text
left  = [2, 0]     // 仍朝右，但更长
right = [1, 0]
dot=2, ‖left‖=2, ‖right‖=1 → 分数=1  （长短不管，方向一样仍满分）
```

本地验证：

```bash
node -e "
const { cosineSimilarity } = require('./apps/api/dist/rag/cosine-similarity.js');
// 若未 build，可把函数体贴进 REPL 试：
function cos(a,b){let d=0,l=0,r=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];l+=a[i]*a[i];r+=b[i]*b[i];}return d/(Math.sqrt(l)*Math.sqrt(r));}
console.log(cos([1,0],[1,0])); // 1
console.log(cos([1,0],[0,1])); // 0
console.log(cos([2,0],[1,0])); // 1
"
```

---

## 6. 检索时怎么「对比」

不是一次神秘运算，就是暴力打分再排序：

```text
query 向量（left，只算一次）
   ├─ vs chunkA → 0.91
   ├─ vs chunkB → 0.42
   └─ vs chunkC → 0.88
按分数降序 → Top-K（如 A、C）→ 片段写进 search_docs 的 tool output
```

对应代码：`document-index.ts` 里 `score: cosineSimilarity(queryEmbedding, chunk.embedding)`。

---

## 7. 这是行业常做的方法吗？

**是。** 语义检索的默认基线之一。

| 场景 | 常见做法 |
|------|----------|
| 自学 / 小规模（本仓库） | 内存或 JSONB 存向量，应用层算余弦 |
| 生产向量库（pgvector / Pinecone / Milvus） | 距离度量选 `cosine` 或 `ip`（内积） |
| 大规模 | ANN（如 HNSW）近似最近邻；度量仍是余弦/内积 |

备选：纯点积、欧氏距离、hybrid（向量 + BM25 关键词）。本仓库 `SEARCH_DOCS_MODE=hybrid` 就是关键词分 + 向量分加权合并。

若 embedding 已做 L2 归一化，余弦与点积等价——生产里常见「入库前归一化，检索时只算点积」。

---

## 8. 读码顺序（只抠这一块）

| 顺序 | 文件 | 看什么 |
|------|------|--------|
| 1 | `apps/api/src/llm/embedding-client.ts` | 文本 → `number[][]` |
| 2 | `apps/api/src/rag/cosine-similarity.ts` | `dot / (‖A‖‖B‖)` |
| 3 | `apps/api/src/rag/document-index.ts` | `searchVector`：query embed → 余弦打分 → Top-K |
| 4 | `apps/api/src/scripts/rag-index.ts` | 离线批量 embed 写入 `document_chunks` |

---

## 相关文档

| 文档 | 用途 |
|------|------|
| [`lightweight-rag-plan.md`](./lightweight-rag-plan.md) | E.7 阶段目标与自检 |
| [`search-docs-tool-notes.md`](./search-docs-tool-notes.md) | `search_docs` 切块、keyword / hybrid 手测 |
| [`docs/current-status.md`](../current-status.md) §E.7-B | 进度、配置陷阱、eval |
