# CI 接入与密钥配置（E.17）

本文档记录两件事，都是"换一台机器 / 换一个人要能重来一遍"的操作：

1. `HUNYUAN_API_KEY` 是怎么来的、怎么验证它有效（[§1](#1-hunyuan_api_key-是什么怎么获取)）
2. 怎么把它配到 GitHub，让 CI 里的 eval 回归能跑（[§3](#3-配置-github-repository-secret)）

对应的流水线定义在 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)。

---

## 0. 先澄清一个常见误解：CI 不需要你有服务器

GitHub **不能**托管常驻数据库，也不能跑常驻 Node 服务（Actions 的 runner 是临时虚拟机，单 job 最长 6 小时；Pages 只能托静态文件）。

但 CI 里的 Postgres **不是部署**，是**一次性的测试实例**：

```yaml
services:
  postgres:
    image: postgres:17
```

job 启动时 GitHub 临时分配一台 `ubuntu-latest`，在上面拉起 postgres 容器，跑完 eval 后整台机器连同容器一起销毁。全程不涉及你的笔记本、云账号或任何自有服务器。

所以两件事要分开：

| 目标 | GitHub 能做吗 | 需要什么 |
|------|---------------|----------|
| 每次改动自动跑类型检查 / 单测 / eval 回归（E.17） | **能** | 一个 secret |
| 部署一个 7×24 可访问的 API + 数据库（E.21） | **不能** | Render / Railway / Fly.io + Neon / Supabase 之类平台 |

---

## 1. `HUNYUAN_API_KEY` 是什么、怎么获取

### 1.1 命名与来源（容易踩的第一个坑）

变量名 `HUNYUAN_API_KEY` 是**历史命名**：项目最初接的是腾讯混元，后来整体迁到了**腾讯云 TokenHub**，变量名为了兼容没有改。

因此它必须和 `HUNYUAN_BASE_URL` 配套：

```bash
HUNYUAN_API_KEY=<TokenHub 控制台创建的 Key>
HUNYUAN_BASE_URL=https://tokenhub.tencentmaas.com/v1
```

**旧混元的 Key 不能用。** 旧地址 `api.hunyuan.cloud.tencent.com` 签发的 Key 打到 TokenHub 上会返回 `401 invalid api key`——这条排查记录在 [`consolidation-week.md`](consolidation-week.md) 里。

### 1.2 获取步骤

| 步骤 | 操作 |
|------|------|
| 1 | 登录腾讯云账号（TokenHub 属于腾讯云产品，需要实名认证） |
| 2 | 打开产品页 <https://cloud.tencent.com/product/tokenhub>，从页面进入**控制台** |
| 3 | 在控制台创建 **API Key** |
| 4 | 立刻复制并保存——密钥通常只在创建时完整显示一次，关掉后无法再查看 |
| 5 | 确认目标模型的可用额度（TokenHub 各模型的免费额度**彼此独立**，用 qwen 的额度不影响 minimax 的） |

> 仓库没有留存控制台截图，按钮文案可能随改版变化；上面第 2–3 步以控制台实际界面为准。
> 已经确认的是**端点与 Key 的匹配关系**：`HUNYUAN_BASE_URL` + 这个 Key 能通过下面的验证。

### 1.3 本地写入 `.env`

```bash
cp apps/api/.env.example apps/api/.env
# 编辑 apps/api/.env，填三个变量
```

```bash
HUNYUAN_API_KEY=sk-xxxxxxxx
HUNYUAN_MODEL=qwen3.5-flash
HUNYUAN_BASE_URL=https://tokenhub.tencentmaas.com/v1
```

`.env` 已在 `.gitignore` 里，**永远不要提交**。

### 1.4 零成本验证 Key 是否有效

不要去跑 Agent 任务（那要 DB + 消耗 token）。直接打 OpenAI 兼容的 `/models`：

```bash
cd /Users/lk/Documents/git/study/agent-app
set -a && . apps/api/.env && set +a

curl -s -o /dev/null -w "%{http_code}\n" \
  https://tokenhub.tencentmaas.com/v1/models \
  -H "Authorization: Bearer $HUNYUAN_API_KEY"
```

| 返回 | 含义 |
|------|------|
| `200` | Key 有效，且与 baseURL 匹配 |
| `401` | Key 错误，或用了旧混元的 Key |

补充：`/chat/completions` 同样可用（本项目通过 OpenAI SDK 接的就是它），但会消耗 token，日常自检用 `/models` 就够。

### 1.5 关于模型与编排模式

CI 里写死了 `HUNYUAN_MODEL=qwen3.5-flash` + `AGENT_ORCHESTRATION=single`，原因是：

- `qwen3.5-flash` 不支持 Supervisor 路由所需的 `tool_choice=required`（会 400）
- `single` 模式下 `multi-route-*` 这几条多 Agent 用例会被自动跳过，属**预期行为**，不是失败

想换模型（例如 `minimax-m2.5` 抗注入更强）时，需要**同时**判断它是否支持 supervisor，否则 CI 会挂在路由步。可参考 `apps/api/.env.example` 里的注释。

---

## 2. 为什么 CI 里没有 `.env` 文件

`apps/api/package.json` 的脚本都带 `dotenv_config_path=.env` 前缀，看起来依赖 `.env` 文件。实际上：

- **`.env` 未入库**（含密钥，不能提交）
- **文件不存在时 dotenv 静默跳过**，不报错；只要 shell 环境变量已注入，`loadConfig()` 一样能读到

CI 用的是后者——在 job 的 `env:` 段注入：

```yaml
env:
  DATABASE_URL: postgres://agent:agent@127.0.0.1:5432/agent_app
  HUNYUAN_API_KEY: ${{ secrets.HUNYUAN_API_KEY }}
  HUNYUAN_MODEL: qwen3.5-flash
  HUNYUAN_BASE_URL: https://tokenhub.tencentmaas.com/v1
  AGENT_ORCHESTRATION: single
```

本地验证过这个行为：

```bash
cd apps/api
DOTENV_CONFIG_PATH=.env.does-not-exist npx tsx -e "import 'dotenv/config'; console.log('ok')"
# 输出 ok，不抛错
```

同理，本地 `compose.yaml` 里挂载的 `docker-entrypoint-initdb.d` 在 GitHub 的 service container（服务容器）中**不生效**，所以 CI 的建表完全依赖 `pnpm run db:migrate`（迁移 SQL 全部写成 `if not exists`，可重复执行）。

---

## 3. 配置 GitHub Repository secret

路径：仓库页面 → **Settings** → 左侧 **Secrets and variables** → **Actions** → **Repository secrets** → 绿色按钮 **New repository secret**。

| 字段 | 填什么 |
|------|--------|
| **Name** | `HUNYUAN_API_KEY`（一字不差，workflow 里按这个名字取） |
| **Secret** | `apps/api/.env` 里 `HUNYUAN_API_KEY=` 后面的值 |

从本地直接抄值：

```bash
grep '^HUNYUAN_API_KEY=' apps/api/.env
```

点 **Add secret** 保存。

### 容易搞错的三个点

| 点 | 说明 |
|----|------|
| **不要用 Environment secrets** | 那个按 staging/production 分组，需要额外在 workflow 里声明 `environment:`。本项目只有一个环境，Repository secrets 就够 |
| **保存后无法再查看原值** | 页面只显示名字。填错了只能 Delete 后重加 |
| **fork 提交的 PR 拿不到 secret** | GitHub 的安全限制。本仓库是单人学习项目，不受影响 |

---

## 4. 流水线结构与触发策略

| Job | 触发条件 | 内容 | 需要 secret |
|-----|----------|------|-------------|
| `checks` | 所有 push / PR / 手动 | `pnpm install --frozen-lockfile` → contract build → `pnpm run test` → `pnpm run check:all` | 否 |
| `evals` | **仅** push 到 `main` / 手动触发 | Postgres service → `db:migrate` → `evals:run` | **是** |

设计取舍（方案 A）：

- **PR 只跑 `checks`**：eval 打真实 LLM，存在已知模型波动（例如 `blocked-write-absolute-path` 偶发口头拒绝），放进 PR 会让红线变成噪音
- **合并进 `main` 必跑 `evals`**：确保主干的行为回归不会漏
- **并发取消**：同一分支连续推送时，旧运行被 `concurrency.cancel-in-progress` 取消，省 private 仓库的免费分钟数

额度参考：

| 仓库类型 | Actions 免费额度 |
|----------|------------------|
| public | 无限 |
| private | 每月 2000 分钟 |

一次全量 eval 是 30 条真实 LLM 调用，耗时在分钟级别；`checks` 的主要耗时在 install 与 web build，有 pnpm 缓存后会明显变快。private 仓库的 2000 分钟够用，但**不要**把 `evals` 改成每次 push 都触发。

> CI 里的前端 `next build` 没有 `.env.local`，`NEXT_PUBLIC_*` 走 `api-utils.ts` 的默认值（`http://localhost:3000`）。这只用于验证「能不能构建」，产物不可直接部署。

---

## 5. 首次运行检查清单

1. Secret 已加：Settings → Secrets and variables → Actions，能看到 `HUNYUAN_API_KEY`
2. 代码已推到 `main`（`git remote -v` 应显示 `github.com:lk0606/agent-app.git`）
3. 打开仓库 **Actions** 标签页 → 选中 `CI` → 看是否有运行记录
4. 点进去确认两个 job：`Checks (types / unit tests / web build)` 与 `Eval regression (real LLM)`
5. `evals` job 跑完后，页面底部 **Artifacts** 里应有 `eval-report-<run_id>.zip`，解压即为 `eval-run-*.json`

手动触发：Actions → 左侧 `CI` → 右上 **Run workflow** → 选分支 → Run。

---

## 6. 失败排查

| 现象 | 原因 | 处理 |
|------|------|------|
| `HUNYUAN_API_KEY secret 未配置` | secret 没加，或加成了 Environment secret | 按 [§3](#3-配置-github-repository-secret) 重加 |
| `Missing HUNYUAN_API_KEY` | 上一步预检被跳过（旧版本 workflow） | 确认用的是当前 `ci.yml` |
| `ECONNREFUSED 127.0.0.1:5432` | Postgres 还没起来就跑了 migrate | 确认 `services.postgres.options` 里的 healthcheck 没被删 |
| `401 invalid api key` | Key 错 / 用了旧混元 Key / secret 填错 | 本地按 [§1.4](#14-零成本验证-key-是否有效) 验证同一个值 |
| `429` 或超时 | 免费额度用尽，或模型侧限流 | 换模型；本地先确认额度 |
| eval 有 1–2 条失败但本地全绿 | 模型行为波动（已知 flakiness） | 下载 artifact 看 `failures[]` 的 `taskId`，本地 `pnpm run task:replay -- <taskId>` 复现 |
| `doc-summary` case 失败 | 这是唯一**依赖外网**的用例：它会真实 `http_fetch` 腾讯云文档页；CI 出网受限或页面结构变化都会失败 | 本地复跑同一命令确认；长期方案是把该用例改为本地 fixture（未做） |
| `ERR_PNPM_OUTDATED_LOCKFILE` | lockfile（依赖锁文件）与 package.json 不一致 | 本地 `pnpm install` 后把 `pnpm-lock.yaml` 一起提交 |
| 前端 build 失败 | Node 版本或 Next 依赖问题 | 本地跑 `pnpm run check:web` 对齐 |

**本地等价验证**（不推 GitHub 也能预演 checks job）：

```bash
cd /Users/lk/Documents/git/study/agent-app
pnpm install --frozen-lockfile
pnpm --filter @agent-app/api-contract build
pnpm run test
pnpm run check:all
```

预演 evals job（需本地 Postgres 已起）：

```bash
docker compose -f apps/api/infra/postgres/compose.yaml up -d
pnpm run db:migrate
AGENT_ORCHESTRATION=single \
AGENT_REFLECTION=true \
PROMPT_INJECTION_GUARD=true \
SEARCH_DOCS_MODE=keyword \
HUNYUAN_MODEL=qwen3.5-flash \
pnpm run evals:run
```

> **必须显式带上开关**：本地 `apps/api/.env` 可能与 CI 不同（例如本地常把 `AGENT_REFLECTION` 设成 `false`）。
> 命令行的前缀变量优先于 `.env`（dotenv 默认不覆盖已存在的环境变量），所以这样写才能复现 CI 的真实行为。

### 已知 flakiness（模型非确定性，不是配置问题）

| case | 症状 | 状态 |
|------|------|------|
| `session-memory-name` | 第 3 轮问名字时额外调 `search_docs`，`failures` 出现 `Forbidden tool "search_docs" was used` + `Successful tool call count 1 exceeded limit 0`；答案本身是对的 | 2026-10-29 复现；已在该轮文案补「不要调用任何工具」，本地 3/3 通过 |
| `read-file-no-secret-leak` 等**城市名类** | 模型把 "Taipei" 翻译成「台北」→ `Expected keyword "Taipei" was not found in summary`；答案本身是对的 | 2026-10-29 复现；6 条改用 `expectedKeywordsAnyOf` + 题面要求英文，正反分支已验证 |
| `blocked-write-absolute-path` | 模型口头拒绝、不调工具 → `Expected tool was not used` | 见【E.11】，属既有波动 |
| `doc-summary` | 唯一依赖外网的用例（真实抓取腾讯云文档页） | 网络受限或页面改版即失败 |

**看到失败先按 `failures[]` 归类，不要猜环境（时区/网络）：**

| `failures` 内容 | 归类 |
|---|---|
| `Expected keyword "X" was not found`，且 `summary` 是中文而 X 是英文 | 语言漂移 → 用 `expectedKeywordsAnyOf` 容纳等价写法 |
| `Forbidden tool ... was used` / `Successful tool call count N exceeded limit M` | 多调工具 → 收紧题面文案 |
| `Expected tool ... was not used` | 模型口头拒绝 → 见【E.11】文案口径 |
| 仅 `doc-summary` 一条失败 | 外网/页面变化 |
| `HUNYUAN_API_KEY` / `ECONNREFUSED` / `401` 类报错 | 才是真正的 CI 配置问题 |

> 长期方案可以给 eval 加「失败 case 自动重试一次」（重试是应对 LLM 非确定性的常见做法），
> 但要清楚它的副作用：**偶发失败不再报警**。重试只能当兜底，不能替代修根因。

---

## 7. 相关文档

| 文档 | 内容 |
|------|------|
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | 流水线定义（每个 step 都有中文注释说明为什么这么做） |
| [`evals-and-replay.md`](evals-and-replay.md) | eval 用例组织、报告字段、回放排查 |
| [`postgres-setup.md`](postgres-setup.md) | 本地数据库启动与迁移 |
| [`current-status.md`](current-status.md) | E.17 条目、测试方法、学习要点 |
