import type { AgentStreamEvent } from "@agent-app/api-contract";

import type { RunStep } from "./run-types";

function upsertStep(steps: RunStep[], step: RunStep): RunStep[] {
  const index = steps.findIndex((item) => item.id === step.id);
  if (index === -1) {
    return [...steps, step];
  }

  return steps.map((item, itemIndex) => (itemIndex === index ? step : item));
}

/** 将 SSE 事件归约成 RunTimeline 步骤（纯函数，便于测试） */
export function applyStreamEvent(steps: RunStep[], event: AgentStreamEvent): RunStep[] {
  switch (event.type) {
    case "thinking":
      // 契约保留；当前后端不 emit，忽略即可
      return steps;
    case "planner_decision":
      return upsertStep(steps, {
        id: `decision-${event.step}`,
        kind: "planner_decision",
        step: event.step,
        needsTool: event.needsTool,
        toolName: event.toolName,
        toolInput: event.toolInput,
      });
    case "tool_start":
      return upsertStep(steps, {
        id: `tool-${event.step}`,
        kind: "tool",
        step: event.step,
        toolName: event.toolName,
        toolInput: event.toolInput,
        status: "running",
      });
    case "tool_end": {
      const existing = steps.find((item) => item.id === `tool-${event.step}` && item.kind === "tool");
      return upsertStep(steps, {
        id: `tool-${event.step}`,
        kind: "tool",
        step: event.step,
        toolName: event.toolName,
        toolInput: existing?.kind === "tool" ? existing.toolInput : "",
        status: event.status,
        output: event.toolOutput ?? null,
        errorMessage: event.errorMessage ?? null,
      });
    }
    case "token": {
      const existing = steps.find((item) => item.kind === "answer");
      return upsertStep(steps, {
        id: "answer",
        kind: "answer",
        content: `${existing?.kind === "answer" ? existing.content : ""}${event.delta}`,
        streaming: true,
      });
    }
    default:
      return steps;
  }
}

export function finalizeAnswerStep(steps: RunStep[], summary: string): RunStep[] {
  return upsertStep(steps, {
    id: "answer",
    kind: "answer",
    content: summary,
    streaming: false,
  });
}
