"use client";

import { CheckCircle2, Loader2, Wrench, XCircle } from "lucide-react";
import { useState } from "react";

import type { RunStep } from "./run-types";

export function ToolStepCard({
  step,
  runningLabel,
  failedLabel,
}: {
  step: Extract<RunStep, { kind: "tool" }>;
  runningLabel: string;
  failedLabel: string;
}) {
  const [expanded, setExpanded] = useState(step.status !== "running");

  const statusIcon =
    step.status === "running" ? (
      <Loader2 className="h-4 w-4 animate-spin text-accent" />
    ) : step.status === "succeeded" ? (
      <CheckCircle2 className="h-4 w-4 text-accent" />
    ) : (
      <XCircle className="h-4 w-4 text-danger" />
    );

  return (
    <div
      className={`rounded-2xl border p-3 transition-colors ${
        step.status === "failed"
          ? "border-danger/30 bg-danger-soft/40"
          : step.status === "running"
            ? "border-accent/30 bg-accent-soft/30"
            : "border-border/80 bg-background/70"
      }`}
    >
      <button
        className="flex w-full items-start gap-2 text-left"
        type="button"
        onClick={() => setExpanded((value) => !value)}
      >
        {statusIcon}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Wrench className="h-3.5 w-3.5 shrink-0 text-accent" />
            {step.toolName}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {step.status === "running" ? runningLabel : step.status === "failed" ? failedLabel : step.toolName}
          </p>
        </div>
      </button>
      {expanded ? (
        <div className="mt-3 space-y-2 border-t border-border/60 pt-3 font-mono text-xs text-muted-foreground">
          <p className="break-all">input: {step.toolInput || "-"}</p>
          {step.output ? <p className="break-all whitespace-pre-wrap">output: {step.output}</p> : null}
          {step.errorMessage ? <p className="break-all text-danger">{step.errorMessage}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
