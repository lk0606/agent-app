# 重试策略（E.16）：术语、公式与代码链路

> 本文整理 E.16 学习过程中提出的关键问题：参数含义、full-jitter 指数退避、惊群、幂等性、网络错误、任务取消，以及代码阅读顺序。
> 本文只维护概念与读码说明；交付进度和验收结果以 [`docs/current-status.md`](../current-status.md) §E.16 为准。

## 1. 先建立整体认识

E.16 处理的是：**一次调用遇到可能恢复的错误时，如何有条件、有间隔、可取消地再试。**

两条主链路：

- **LLM（large language model，大语言模型）调用**：`PlannerAgent` → `HunyuanLlmClient` → `withLlmRetry()` → `withRetry()` → OpenAI SDK → 模型供应商。
- **Tool（工具）调用**：`PlannerAgent` → `executeToolWithRetry()` → `withRetry()` → 具体工具的 `execute()` → 最终结果回到 Planner。

SDK（software development kit，软件开发工具包）是调用供应商接口的客户端库。项目中的 Chat 和 Embedding 客户端都使用 OpenAI SDK。

先记住四件事：

1. **可重试不等于无限重试**：要同时受次数、错误分类和取消信号限制。
2. **等待上限不等于实际等待时间**：指数公式算上限，随机抖动再决定实际延迟。
3. **幂等不等于每次返回相同内容**：关注重复操作对业务状态的影响。
4. **取消要贯穿整个链路**：既中止外部请求，也中止重试之间的等待。

### 一次逻辑调用与一次 attempt

- **逻辑调用**：业务层发起的一次操作，例如 Planner 选择一次 `http_fetch`。
- **attempt（执行尝试）**：内部实际执行一次操作；重试会产生新的 attempt，但仍属于原来的逻辑调用。

例如 `maxRetries=2`，最多是：首次 attempt 1 → 重试 attempt 2 → 重试 attempt 3。

因此正常配置下：

$$
\mathrm{maxAttempts} = \mathrm{maxRetries} + 1
$$

文字公式：`maxAttempts = maxRetries + 1`。

`maxRetries=0` 表示关闭额外重试，不是禁止首次执行；任务已经取消时，首次执行也会被阻止。

## 2. `RetryOptions` 的类型与字段是什么意思

源码：[`apps/api/src/shared/retry.ts`](../../apps/api/src/shared/retry.ts)。

`withRetry<T>()` 接收一个异步操作和一组策略：

- `T` 是操作成功时返回值的类型，例如工具返回的 `string`。
- `Promise<T>` 表示异步完成后得到 `T`，失败时则拒绝该异步结果并向外抛错。
- `operation(attempt)` 是本次要执行的操作，`attempt` 从 1 开始。
- `unknown` 表示捕获到的错误类型尚不确定，调用方需要先判断它是不是 `Error`、`AppError` 等。

| 字段 | 作用 | 需要记住的边界 |
|------|------|----------------|
| `maxRetries` | 首次调用之外最多再试几次 | 不是总执行次数 |
| `baseDelayMs` | 指数增长的基础等待上限，单位毫秒 | 不是每次固定等待时长，公式见下一节 |
| `maxDelayMs` | 每次等待的本地上限 | 不等于一次请求的超时，也不等于整个任务的总超时 |
| `signal` | `AbortSignal`，用于接收任务取消/超时通知 | 通用循环检查它；实际操作也要把它传给底层请求 |
| `shouldRetry(error)` | 判断错误是否允许重试 | 返回 `false` 时立即抛出原错误 |
| `getRetryAfterMs(error)` | 获取服务端建议的等待毫秒数 | 返回 `null` 时使用普通随机退避 |
| `onRetry(event)` | 等待前记录重试信息 | `event.attempt` 是刚失败的那次尝试，不是即将执行的尝试 |
| `random()` | 生成随机数，默认使用 `Math.random()` | 默认范围为 `[0, 1)`；测试可以注入固定值 |
| `sleep(delayMs, signal)` | 等待后再试，默认使用 `abortableSleep()` | 测试可注入不实际等待的函数 |

这里的设计是：`withRetry()` 负责重试流程，**“哪些错误能重试”由 LLM 或 Tool 调用方决定**，不是在通用函数里写死。

## 3. `baseDelayMs`、指数退避与 full jitter

### 3.1 名称解释：指数退避

**指数退避（exponential backoff）**：失败后先等待再重试，等待上限随着重试次数按指数增长。

- **退避**：不立刻再次请求，而是主动暂停，给远端恢复或解除限流的机会。
- **指数**：本实现的上限按 2 的幂增长，即基础值的 1、2、4、8 倍。

设：

- $B$ 为 `baseDelayMs`。
- $M$ 为 `maxDelayMs`。
- $n$ 为第几次重试，**从 1 开始**。

第 $n$ 次重试之前的等待上限（使用代码里的变量名）：

$$
\mathrm{cap} = \min\left(\mathrm{maxDelayMs},\, \mathrm{baseDelayMs} \times 2^{\mathrm{attempt}-1}\right)
$$

可复制的文字公式：`cap = min(maxDelayMs, baseDelayMs × 2^(attempt - 1))`。

使用上面的简记变量，同一公式为 $cap_n = \min(M,\ B \times 2^{n-1})$。

本文使用 `$...$` 表示行内公式、`$$...$$` 表示独立公式块。这是 Markdown 的数学扩展语法，需要预览器支持数学渲染；不支持时仍可阅读上面的文字公式，不必依赖图片。

如果指数序号 $k$ 从 0 开始，也可以写成 $B \times 2^k$，其中 $k=n-1$。

代码通过 `options.baseDelayMs * 2 ** (attempt - 1)` 计算指数部分，再用 `Math.min()` 封顶。

注意：这里的 `attempt` 是刚失败的执行次数。首次执行 `attempt=1` 失败后，准备第 1 次重试，所以指数是 `1 - 1 = 0`。

### 3.2 名称解释：full jitter

**Full jitter（全范围随机抖动）**：不是固定等待上限，而是在整个 `[0, 上限)` 范围随机选择实际等待时间。

“Full”指随机范围覆盖从 0 到整个上限，不只是给固定等待值加一点随机偏差。

默认随机数 $U$ 满足 $0 \le U < 1$，实际等待时间为：

$$
delay_n = \lfloor U \times cap_n \rfloor
$$

可复制的文字公式：`delay_n = floor(U × cap_n)`。

其中 $\lfloor \cdot \rfloor$ 表示向下取整。本实现对应 `Math.floor(Math.max(0, random()) * exponentialCap)`。

所以 **full-jitter 指数退避 = 指数增长的等待上限 + 全范围随机的实际等待时间**。

### 3.3 数值示例

假设 `baseDelayMs=250`、`maxDelayMs=1000`，为了演示固定取 `random()=0.5`：

| 重试序号 $n$ | 即将执行的 attempt | 未封顶的上限 | 封顶后的上限 | 实际等待 |
|----------------|-------------------|--------------|--------------|----------|
| 1 | 2 | 250ms | 250ms | 125ms |
| 2 | 3 | 500ms | 500ms | 250ms |
| 3 | 4 | 1000ms | 1000ms | 500ms |
| 4 | 5 | 2000ms | 1000ms | 500ms |

这是算法示意，是否有这么多次重试还受 `maxRetries` 限制。若 `maxRetries=2`，只会走前两行。

生产中的随机数每次不同：**上限不下降，不代表实际等待时间一定递增**。一次可能等 200ms，下一次虽然上限更大，也可能只等 30ms。

### 3.4 名称解释：惊群

**惊群（thundering herd）**：大量等待者被同一事件同时唤醒或触发，集中争抢资源。

在重试场景里：很多客户端一起失败 → 都固定等 1 秒 → 又在同一时刻请求 → 形成请求洪峰，服务可能再次过载。

随机抖动将客户端的重试时间分散，例如分别等 127ms、583ms、914ms，从而缓解这种集中冲击。

## 4. `Retry-After` 与 backoff sleep

### `Retry-After`：服务端建议稍后再请求

`Retry-After` 是 HTTP 响应头，告诉客户端下一次请求之前应该等多久。

源码：[`hunyuan-llm-client.ts`](../../apps/api/src/llm/hunyuan-llm-client.ts) 的 `readRetryAfterMs()`。

支持两种形式：

- 秒数，例如 `Retry-After: 2` → 2000ms。
- HTTP 日期 → 目标时间减去当前时间；已经过去的时间按 0 处理。

没有有效建议时返回 `null`，由 `withRetry()` 使用 full jitter。

**当前实现的边界**：服务端建议也会被 `maxDelayMs` 封顶，而且这个分支不加随机抖动。若建议等待 60 秒、本地上限是 4 秒，实际只等 4 秒；因此不能把它理解成“一定等待满服务端要求的时间”。

当前只在 LLM 策略中接入 `Retry-After`；通用 Tool 重试入口没有读取这个响应头。

### Backoff sleep：重试前的退避等待

**Backoff sleep（退避等待）**：请求失败后，下一次 attempt 之前主动等待一段时间。

对应 `withRetry()` 内部的 `await sleep(delayMs, options.signal)`，默认执行 `abortableSleep()`。

它是异步定时等待，不是阻塞整个 Node.js 线程，也不是业务工具 `wait`：

- 到时间：移除取消监听并完成等待，循环进入下一次 attempt。
- 任务取消：清除定时器、移除监听并抛出取消原因，不必等满延迟。

**通用循环的顺序**：检查取消 → 执行 `operation()` → 失败后再次检查取消 → 判断次数与错误 → 计算延迟 → 可取消地等待 → 下次 attempt。

## 5. `idempotent` 为什么是关键安全门

源码：[`tool.ts`](../../apps/api/src/tools/tool.ts) 与 [`tool-retry.ts`](../../apps/api/src/tools/tool-retry.ts)。

**Idempotent（幂等）**：相同操作执行一次或多次，对业务状态的预期影响等价，重复执行不会累积额外副作用。

例如重复读取一个网页，网页内容可能变化，但按 HTTP GET 的语义，并不应该因为“读取了两次”而额外修改业务数据。

因此：**幂等不要求每次返回内容完全相同，也不保证第一次操作根本没有发生。**

### `readonly idempotent = true` 分别表示什么

- `readonly`：TypeScript 将这个属性限制为只读，不能在正常类型检查通过的代码中随意改成另一个值；它本身不会启动重试。
- `idempotent`：工具对重复执行安全性的显式声明。
- `true`：有资格进入自动重试流程，不代表所有错误都重试。

`executeToolWithRetry()` 需要同时满足：

1. `tool.idempotent === true`。
2. 错误是 `AppError`，且 `error.code === "NETWORK_ERROR"`。
3. 还有重试次数，任务没有取消/超时。

| 工具/情况 | 当前策略 | 原因 |
|-----------|----------|------|
| `http_fetch` | `idempotent=true` | 固定 GET，按协议语义读取；瞬态失败交给 Planner 层统一重试 |
| `read_file`、`list_dir`、`echo`、`time` | `idempotent=true` | 不累积业务写入副作用；仍要满足错误分类，不是任何错误都重试 |
| `write_file` | `idempotent=false` | 保守禁止重复写入；即使某种覆盖写在特定条件下可幂等，也不假设总是安全 |
| `wait` | `idempotent=false` | 避免重复等待，放大任务耗时 |
| `search_docs` | `idempotent=false` | 向量检索可能调用有费用的 embedding，策略上关闭自动重试 |
| `BAD_REQUEST`、`CANCELLED`、`TIMEOUT_ERROR` | 不自动重试 | 参数/安全错误或任务终止，不应继续尝试 |

这里的标记兼有重试许可作用：`search_docs` 标为 `false`，不等于“搜索必然修改数据”，而是项目保守的成本控制决定。

`http_fetch` 的声明也依赖远端遵守 GET 语义，并不是代码能证明任意网站绝无副作用。

### 为什么不能每个 attempt 都写一条 `tool_calls`

`PlannerAgent` 先等待 `executeToolWithRetry()` 的最终结果，再调用 `recordToolCall()`。内部 attempt 只记录重试日志，不单独成为 Planner 的新工具步骤。

这样正常执行路径中，一次逻辑调用可以包含多次 attempt，却不会按 attempt 增加业务工具记录和步数。

这不是“任何故障下都恰好执行/落库一次”的保证。持久化异常等场景还需要额外的数据库设计；E.16 解决的是内部重试与业务记录分层。

## 6. 这些网络错误各是什么意思

源码：[`hunyuan-llm-client.ts`](../../apps/api/src/llm/hunyuan-llm-client.ts) 的 `isRetryableLlmError()`。

有 HTTP 状态码时，当前策略优先看状态码：

| 状态码 | 含义 | 策略 |
|--------|------|------|
| 408 | 请求超时 | 允许有限重试 |
| 429 | 请求过多，被限流 | 允许有限重试，并可读取 `Retry-After` |
| 5xx | 服务端或网关异常 | 允许有限重试；代码条件为 `status >= 500` |
| 常见其他 4xx，如 400、401、403、404 | 参数、认证、权限或资源问题 | 不自动重试 |

没有状态码时，再识别错误码或消息：

| 错误码 | 意思 | 常见场景 |
|--------|------|----------|
| `ECONNRESET` | 已建立的连接被重置 | 对端、网关或网络设备断开连接 |
| `ECONNREFUSED` | 目标拒绝建立连接 | 端口没有服务监听，或服务重启中 |
| `ETIMEDOUT` | 连接或读写超时 | 对端迟迟未响应、网络不通 |
| `ENOTFOUND` | DNS 找不到主机 | 域名写错，或解析出现问题 |
| `EAI_AGAIN` | DNS 临时解析失败 | DNS 服务短暂不可用，稍后可能恢复 |

DNS（domain name system，域名系统）负责把主机名解析成网络地址。

`candidate.code?.toLowerCase()` 和 `candidate.message.toLowerCase()` 将大小写统一，便于匹配。某些错误没有稳定的 `code`，所以还用 `network`、`connection`、`fetch failed`、`timed out` 等消息关键词兼容识别。

注意两点：

- **被列为可重试，不代表一定是临时故障**。例如域名写错、端口配置错，反复重试也不会恢复，因此必须限制次数。
- LLM 的底层 `ETIMEDOUT` 与工具层 `AppError("TIMEOUT_ERROR")` 不同。前者可能允许重试；后者在当前 Tool 策略中不重试。任务信号已中止时，也会直接退出。

`http_fetch` 会把 408/429/5xx 或普通 fetch 网络失败分类为 `NETWORK_ERROR`，再由外层策略决定重试；它自己不再保留一个内部重试循环。

## 7. Embedding 支持任务取消，究竟体现在哪里

**Embedding（文本向量化）**：把文本转成一组数字向量，供语义相似度检索使用。这里的在线调用是给搜索问题生成向量。

**协作取消**：上层发出取消通知，下层主动接收并终止操作，而不是强行杀死任意代码。

- `AbortController`：发出通知，调用它的 `abort()`。
- `AbortSignal`：携带取消状态和原因，传给等待函数或外部请求。

### 信号完整传递链

`PlannerAgent` 的 `context.signal` → `ToolInput.signal` → `SearchDocsTool` → `EmbeddingClient.embedTexts()` → OpenAI SDK → 底层 `fetch`。

| 位置 | 看什么 | 作用 |
|------|--------|------|
| [`planner-agent.ts`](../../apps/api/src/agents/planner-agent.ts) | `executeToolWithRetry()` 入参中的 `signal: context.signal` | 把任务通知交给工具 |
| [`search-docs-tool.ts`](../../apps/api/src/tools/search-docs-tool.ts) | `embedTexts([query], { signal: input.signal })` | 向量/混合检索时继续向下传递通知 |
| [`embedding-client.ts`](../../apps/api/src/llm/embedding-client.ts) | `embedTexts()` 的可选 `signal` 参数 | 接口允许调用方指定取消通知 |
| 同文件 | `embeddings.create()` 第二个参数中的 `signal: requestOptions?.signal` | SDK 和底层 HTTP 请求真正收到通知，这是中止请求的关键 |
| [`abort-utils.ts`](../../apps/api/src/runtime/abort-utils.ts) | `rethrowIfLlmAborted()`、`throwIfAborted()` | 避免把取消误包装成普通 `LLM_ERROR` |

取消/任务超时发生后：

1. 下层 HTTP 请求因信号中止而抛错。
2. `rethrowIfLlmAborted()` 将 SDK 的中止异常归一化为 `CANCELLED`，或保留已有的 `CANCELLED`/`TIMEOUT_ERROR`。
3. Tool 外层的 `withRetry()` 再检查任务 `signal`，有原始 `AppError` 原因时原样抛出，不进入重试等待。
4. Planner 对任务取消/超时直接向上抛出，不按普通工具失败处理。

**只在请求结束后检查 `signal`，不能中断正在进行的网络请求**。必须把同一个信号传到真正执行 I/O（输入/输出操作）的 API。

取消的边界也要记住：未传入 `signal` 的调用没有这条取消通知链；中止本地请求不保证远端已经停止计算，也不保证没有产生费用。

`http_fetch` 还使用 `AbortSignal.any()` 合并“任务取消/超时”和“单次请求超时”两个信号，任意一个中止都会通知底层请求。

## 8. 为什么关闭 SDK 重试，流式响应又为什么特殊

### 避免重试次数相乘

`HunyuanLlmClient` 构造 OpenAI 客户端时设置 `maxRetries: 0`，实际重试由项目自己的策略控制。

否则，假设项目层最多尝试 3 次，每次 SDK 又最多尝试 3 次，底层可能总共发出 9 次请求，而不是预期的 3 次。

普通 Chat 调用通过 `withLlmRetry()`；流式回答直接使用 `withRetry()` 加入额外的输出边界判断。Embedding SDK 也关闭内建重试，但没有接入 Chat 的 `withLlmRetry()`，不能理解成“所有 OpenAI 调用现在都自动重试”。

### 首个文本片段发出后不能从头重放

源码：[`hunyuan-llm-client.ts`](../../apps/api/src/llm/hunyuan-llm-client.ts) 的 `answerWithTool()` 流式分支。

- **Token**：模型处理文本的分词单位。
- **Delta**：一次流式响应中的增量片段，可能包含多个 token。
- **SSE（server-sent events，服务器发送事件）**：服务器持续向客户端单向推送事件的方式，本项目用于输出流式回答。

代码的“首 token”边界，实际依据是**首个非空 `delta.content` 是否已调用 `onToken(delta)` 对外推送**，不是精确统计模型分词数量。

- 发送内容前失败：`tokenEmitted=false`，瞬态错误仍可重试。
- 发送内容后失败：`tokenEmitted=true`，`shouldRetry` 不再允许重放，避免客户端看到重复文字。

同理，一次逻辑 LLM 调用的指标不等于实际 HTTP 请求数量；内部重试仍可能增加耗时和外部费用。

## 9. 代码按什么顺序读，如何验证

| 顺序 | 文件 | 重点 |
|------|------|------|
| 1 | [`config/env.ts`](../../apps/api/src/config/env.ts)、[`apps/api/.env.example`](../../apps/api/.env.example) | 次数、基础延迟和最大延迟的配置含义 |
| 2 | [`app/create-agent-runtime.ts`](../../apps/api/src/app/create-agent-runtime.ts) | 配置分别注入 LLM Client 和 Planner |
| 3 | [`shared/retry.ts`](../../apps/api/src/shared/retry.ts) | `RetryOptions` → `withRetry()` → 指数上限/随机延迟 → `abortableSleep()` |
| 4 | [`llm/hunyuan-llm-client.ts`](../../apps/api/src/llm/hunyuan-llm-client.ts) | 关闭 SDK 重试 → `withLlmRetry()` → 错误分类 → `Retry-After` → `answerWithTool()` 流式边界 |
| 5 | [`tools/tool.ts`](../../apps/api/src/tools/tool.ts)、[`tools/tool-retry.ts`](../../apps/api/src/tools/tool-retry.ts) | 幂等声明 + `NETWORK_ERROR` 两道安全门 |
| 6 | [`agents/planner-agent.ts`](../../apps/api/src/agents/planner-agent.ts) | 工具确认后执行；最终结果回到业务记录层 |
| 7 | [`tools/http-fetch-tool.ts`](../../apps/api/src/tools/http-fetch-tool.ts) | 单次 GET、错误分类、合并取消与超时 |
| 8 | [`tools/search-docs-tool.ts`](../../apps/api/src/tools/search-docs-tool.ts)、[`llm/embedding-client.ts`](../../apps/api/src/llm/embedding-client.ts)、[`runtime/abort-utils.ts`](../../apps/api/src/runtime/abort-utils.ts) | 逐层追踪取消信号和异常 |
| 9 | [`test/e16-retry.test.ts`](../../apps/api/test/e16-retry.test.ts) | 用测试反向理解允许/禁止重试的条件 |

当前默认配置：

| 配置 | LLM | Tool |
|------|-----|------|
| 额外重试次数 | `LLM_MAX_RETRIES=2` | `TOOL_MAX_RETRIES=2` |
| 基础等待上限 | `LLM_RETRY_BASE_DELAY_MS=250` | `TOOL_RETRY_BASE_DELAY_MS=100` |
| 单次最大等待 | `LLM_RETRY_MAX_DELAY_MS=4000` | `TOOL_RETRY_MAX_DELAY_MS=2000` |

学习时可运行：

- `pnpm run test`：7 个专项测试，覆盖退避、错误分类、响应头解析、幂等许可和取消等待。
- `pnpm run check:all`：API 类型检查、Web lint（静态检查）与构建。
- `pnpm run evals:run`：eval（自动评测）验证完整 Agent 行为，需要数据库和模型服务配置。

专项测试里的 Tool 是模拟对象；`http_fetch` 测试直接检查其幂等声明。它们没有直接覆盖真实流式断连、真实 embedding 取消或数据库行数，不能把测试覆盖范围说得比断言更大。

### 为什么验收前运行数据库迁移

E.16 没有新增数据库字段或迁移 SQL。`idempotent` 是工具代码中的类型/属性，不是数据库列。

运行 `db:migrate` 是为确保数据库结构完整，属于 eval 的环境准备，不是 E.16 重试链路的一环。数据库迁移（schema migration）是把表、字段、索引等结构补到代码需要的版本。

当前 [`migrate-postgres.ts`](../../apps/api/src/scripts/migrate-postgres.ts) 每次依次执行 `001`～`006`，没有迁移版本记录表。SQL 使用 `IF NOT EXISTS` 避免重复新增已有对象；日志 `Applied` 只表示 SQL 执行成功，不表示本次一定增加了表或字段。

## 10. 复习自检与注释约定

能独立回答下面的问题，就抓住了 E.16 的重点：

1. `maxRetries=2` 最多执行几次？第 1 次重试前的指数为什么是 0？
2. `baseDelayMs=250` 是否意味着每次至少等待 250ms？为什么？
3. 指数上限递增，实际等待时间是否一定递增？
4. Full jitter 如何缓解惊群？`Retry-After` 分支是否也加随机抖动？
5. `idempotent=true` 为什么不能保证每次返回相同内容，也不能保证所有错误都重试？
6. `ENOTFOUND` 为什么可能重试也无效？
7. 取消信号要传到哪里，才能中断 embedding 请求与 backoff sleep？
8. 流式回答为什么一旦对外发送文本就不能自动从头重放？
9. 一次逻辑调用里的多个 attempt，为什么不应各记为一个新的业务工具步骤？
10. 这次数据库迁移是不是因为 E.16 新增了字段？当前是否记录迁移版本？

后续代码注释约定：**新术语首次出现时，写明英文名称、中文名称、定义和当前场景；涉及公式时说明变量、序号起点、单位，并给一个简短示例。**

例如只写“使用 full jitter 避免惊群”还不够，应同时解释 full jitter 随机的是哪段范围、惊群指什么集中冲击。
