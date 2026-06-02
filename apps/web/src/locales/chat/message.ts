export const chatMessages = {
  title: {
    "zh-CN": "Agent 调试工作台",
    "en-US": "Agent Chat Workbench",
  },
  subtitle: {
    "zh-CN": "一个用于验证会话记忆、工具调用和任务轨迹的 Agent 控制台。",
    "en-US": "An Agent cockpit for validating memory, tool calls, and task traces.",
  },
  composer: {
    placeholder: {
      "zh-CN": "输入一个任务，比如：请记住我喜欢东京，或者总结一个 URL...",
      "en-US": "Enter a task, for example: remember I like Tokyo, or summarize a URL...",
    },
    submit: {
      "zh-CN": "发送",
      "en-US": "Send",
    },
    retry: {
      "zh-CN": "重发",
      "en-US": "Retry",
    },
  },
  conversation: {
    eyebrow: {
      "zh-CN": "实时对话",
      "en-US": "Live Conversation",
    },
    hint: {
      "zh-CN": "失败消息可以直接重发，成功后会继续复用当前 session。",
      "en-US": "Failed messages can be retried and will keep using the current session.",
    },
  },
  overview: {
    title: {
      "zh-CN": "运行概览",
      "en-US": "Runtime overview",
    },
    description: {
      "zh-CN": "先把单轮请求、会话复用和工具调用跑稳，再扩展会话列表与流式响应。",
      "en-US": "Stabilize requests, session reuse, and tool calls before adding session lists and streaming.",
    },
  },
  panels: {
    debug: {
      "zh-CN": "调试面板",
      "en-US": "Debug panel",
    },
    session: {
      "zh-CN": "会话",
      "en-US": "Session",
    },
    task: {
      "zh-CN": "任务",
      "en-US": "Task",
    },
    tools: {
      "zh-CN": "工具调用",
      "en-US": "Tool calls",
    },
    debugHint: {
      "zh-CN": "观察本次请求的关键运行态。",
      "en-US": "Watch the key runtime state for this request.",
    },
  },
  status: {
    sending: {
      "zh-CN": "发送中",
      "en-US": "Sending",
    },
    needsRetry: {
      "zh-CN": "待重发",
      "en-US": "Needs retry",
    },
  },
  empty: {
    title: {
      "zh-CN": "开始一轮真实 Agent 调试",
      "en-US": "Start a real Agent debugging run",
    },
    description: {
      "zh-CN": "第一条消息会自动创建 session，后续请求会复用上下文。",
      "en-US": "The first message creates a session, and later requests reuse its context.",
    },
  },
  errors: {
    requestFailed: {
      "zh-CN": "请求失败，请确认后端服务已启动。",
      "en-US": "Request failed. Please make sure the backend server is running.",
    },
    network: {
      "zh-CN": "无法连接后端服务。请确认运行的是 pnpm run dev:server，而不是 pnpm run dev。",
      "en-US": "Cannot reach the backend. Please run pnpm run dev:server instead of pnpm run dev.",
    },
  },
} as const;
