# list_dir 工具与 Node 列目录（E.6-B 补充）

> 对应源码：`apps/api/src/tools/list-dir-tool.ts`  
> 进度状态仍以 [`docs/current-status.md`](../current-status.md) 为准。

## 这工具在 Agent 链路里干什么

```text
用户：「列出沙箱里有哪些文件」
  → Planner 选 list_dir（function calling）
  → TaskRunner 调 ListDirTool.execute()
  → readdir 沙箱目录 → 格式化成字符串
  → 写入 tool_calls 表 → 回流 LLM 组织自然语言回答
```

与 `read_file` 的关系：

| 工具 | 做什么 | 共用配置 |
|------|--------|----------|
| `list_dir` | 看目录里**有哪些名字**（一层） | `READ_FILE_ROOT_DIR` |
| `read_file` | **读某个文件**的内容 | 同上 + 扩展名白名单 |

典型组合：先 `list_dir` 看文件名，再 `read_file` 读 `sample-notes.txt`。

---

## 核心 API：`readdir` + `Dirent`

```typescript
const entries = await readdir(absolutePath, { withFileTypes: true });
```

| 选项 | 返回值 | 常用能力 |
|------|--------|----------|
| 默认（无 `withFileTypes`） | `string[]` | 只有文件名 |
| `{ withFileTypes: true }` | `fs.Dirent[]` | 每个条目带类型判断方法 |

`Dirent` 是 **Node.js `fs` 模块原生类型**（不是项目自定义类）。常用方法：

| 方法 | 含义 |
|------|------|
| `entry.name` | 条目名字（**不含父路径**） |
| `entry.isDirectory()` | 是否是目录 |
| `entry.isFile()` | 是否是普通文件 |
| `entry.isSymbolicLink()` | 是否是符号链接（本工具未单独分支） |

官方文档：[Node.js fs.Dirent](https://nodejs.org/api/fs.html#class-fsdirent)

---

## 输出格式：`类型\t名字`

```typescript
const kind = entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other";
return `${kind}\t${entry.name}`;
```

示例输出：

```text
Path: .
Entries: 1
Listing:
file	sample-notes.txt
```

注意：

1. **不是完整路径**——只有 `sample-notes.txt`，不是 `evals/fixtures/sample-notes.txt`。
2. **只列一层**——不会递归进子目录把所有深层文件都列出来。
3. **`\t` 是制表符**，固定两列：`类型` + `名字`，方便 LLM 解析。

若要完整相对路径，需自己拼：`${relativePath}/${entry.name}`（当前实现故意不拼，控制输出长度）。

---

## `dir` / `file` / `other` 分别什么时候出现

```typescript
entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other"
```

| 标签 | 条件 | 沙箱里常见吗 |
|------|------|----------------|
| `dir` | `isDirectory()` 为 true | 有子目录时出现 |
| `file` | `isFile()` 为 true | **最常见**（如 `sample-notes.txt`） |
| `other` | 上面两个都是 false | 沙箱里很少见，防御性兜底 |

`other` 在 Unix/macOS 上可能对应：

| 文件系统对象 | 例子 |
|--------------|------|
| 符号链接 | `my-link` → 指向别处 |
| 命名管道 (FIFO) | `pipe.sock` |
| Unix 域套接字 | `app.sock` |
| 设备文件 | 特殊设备节点 |

输出形态是 `other\tmy-socket.sock`，**不是** `other/xx` 这种路径——`other` 是类型列，后面一列才是名字。

```text
other	app.sock
│     └── 文件名（不是子路径）
└── 类型标签
```

在本项目 `evals/fixtures` 沙箱中，通常只会看到 `file` 和 `dir`。

### 手测：自己造一个 `other`

命名管道（FIFO）会让 `isDirectory()` 和 `isFile()` 都为 false：

```bash
cd apps/api/evals/fixtures
mkfifo demo-pipe

node --input-type=module -e "
import { readdir } from 'node:fs/promises';
for (const e of await readdir('apps/api/evals/fixtures', { withFileTypes: true })) {
  const kind = e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other';
  console.log(kind, e.name);
}
"
# 预期多一行：other demo-pipe

rm demo-pipe   # 测完删掉
```

符号链接较特殊：有的系统上若链接指向普通文件，`isFile()` 可能为 true（显示 `file` 而非 `other`），因 OS/Node 版本而异；`other` 分支是兜底写法。

---

## 安全与过滤（和 read_file 分工）

| 层 | list_dir | read_file |
|----|----------|-----------|
| 路径穿越 | `resolveSafePath` 前缀校验 | 同左 |
| 绝对路径 | 拦截 `/etc` 等 | 同左 |
| 隐藏文件 | 列表时 filter `.` 开头 | `deniedBasenames` + 隐藏名 |
| 扩展名 | 不校验（列目录不需要） | 白名单 `.txt/.md/...` |
| 输出上限 | `LIST_DIR_MAX_ENTRIES`（默认 50） | `READ_FILE_MAX_BYTES` |

---

## 手测命令

```bash
# 1. 直接看 Node readdir 返回什么
node --input-type=module -e "
import { readdir } from 'node:fs/promises';
const entries = await readdir('apps/api/evals/fixtures', { withFileTypes: true });
for (const e of entries) {
  const kind = e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other';
  console.log(kind, e.name);
}
"

# 2. 走 Agent 端到端（需 dev:server 已重启）
curl -s -X POST http://localhost:3000/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请用 list_dir 列出沙箱根目录有哪些文件"}' | jq '.result.toolCalls'
```

---

## 常见误区

| 误区 | 实际 |
|------|------|
| 「列出了所有文件路径」 | 只列**当前目录一层**的文件名 |
| `isDirectory` 是项目方法 | Node `fs.Dirent` 原生方法 |
| 注册工具后 curl 立刻可用 | **须重启 `dev:server`**，HTTP 进程才加载新 tools |
| eval 过了但 curl 没有 list_dir | eval 直连 TaskRunner，不经过旧 HTTP 进程 |

---

## 相关文档

| 文档 | 用途 |
|------|------|
| [agent-core-flow.md](./agent-core-flow.md) | Agent 全链路 |
| [eval-break-lab.md](./eval-break-lab.md) | 实验 7：摘掉 list_dir |
| `docs/current-status.md` E.6-B | 交付清单与验证命令 |
