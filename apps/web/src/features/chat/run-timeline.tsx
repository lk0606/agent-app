"use client";

import { motion } from "framer-motion";
import { BrainCircuit, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { MarkdownMessage } from "./markdown-message";
import type { AssistantRunMessage, RunStep } from "./run-types";
import { ToolStepCard } from "./tool-step-card";

export function RunTimeline({ run }: { run: AssistantRunMessage }) {
  const t = useTranslations("chat");

  return (
    <div className="space-y-3">
      {run.steps.map((step) => (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          initial={{ opacity: 0, y: 8 }}
          key={step.id}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          <RunStepView runStatus={run.status} step={step} />
        </motion.div>
      ))}
      {run.status === "running" && run.steps.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
          {t("status.thinking")}
        </div>
      ) : null}
      {run.error ? (
        <div className="rounded-xl border border-danger/25 bg-danger-soft/50 p-3 text-sm text-danger">{run.error}</div>
      ) : null}
    </div>
  );
}

function RunStepView({ step, runStatus }: { step: RunStep; runStatus: AssistantRunMessage["status"] }) {
  const t = useTranslations("chat");

  if (step.kind === "planner_decision") {
    return (
      <div className="rounded-xl border border-border/70 bg-panel/70 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <BrainCircuit className="h-3.5 w-3.5 text-accent" />
          {t("timeline.plannerDecision", { step: step.step })}
        </div>
        <p className="mt-2 text-sm">
          {step.needsTool && step.toolName
            ? t("timeline.willCallTool", { tool: step.toolName })
            : t("timeline.willAnswerDirectly")}
        </p>
        {step.toolInput ? (
          <p className="mt-1 font-mono text-xs text-muted-foreground break-all">input: {step.toolInput}</p>
        ) : null}
      </div>
    );
  }

  if (step.kind === "tool") {
    return (
      <ToolStepCard failedLabel={t("timeline.toolFailed")} runningLabel={t("status.toolRunning")} step={step} />
    );
  }

  return (
    <div className="rounded-[1.35rem] border border-border/80 bg-panel/95 px-4 py-3 text-sm leading-6 shadow-sm">
      <MarkdownMessage content={step.content} streaming={step.streaming && runStatus === "running"} />
    </div>
  );
}
