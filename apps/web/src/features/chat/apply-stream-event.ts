import type { AgentStreamEvent } from "@agent-app/api-contract";

import type { RunStep } from "./run-types";

function upsertStep(steps: RunStep[], step: RunStep): RunStep[] {
  const index = steps.findIndex((item) => item.id === step.id);
  if (index === -1) {
    return [...steps, step];
  }

  return steps.map((item, itemIndex) => (itemIndex === index ? step : item));
}

function removeThinkingForStep(steps: RunStep[], step: number): RunStep[] {
  return steps.filter((item) => !(item.kind === "thinking" && item.step === step));
}

function removeAllThinking(steps: RunStep[]): RunStep[] {
  return steps.filter((item) => item.kind !== "thinking");
}

/** 将 SSE 事件归约成 RunTimeline 步骤（纯函数，便于测试） */
export function applyStreamEvent(steps: RunStep[], event: AgentStreamEvent): RunStep[] {
  switch (event.type) {
    case "thinking":
      return upsertStep(steps, {
        id: `thinking-${event.step}`,
        kind: "thinking",
        step: event.step,
      });
    case "planner_decision":
      return upsertStep(removeThinkingForStep(steps, event.step), {
        id: `decision-${event.step}`,
        kind: "planner_decision",
        step: event.step,
        needsTool: event.needsTool,
        toolName: event.toolName,
        toolInput: event.toolInput,
      });
    case "tool_start":
      return upsertStep(removeThinkingForStep(steps, event.step), {
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
      const baseSteps = removeAllThinking(steps);
      const existing = baseSteps.find((item) => item.kind === "answer");
      return upsertStep(baseSteps, {
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
  return upsertStep(removeAllThinking(steps), {
    id: "answer",
    kind: "answer",
    content: summary,
    streaming: false,
  });
}
