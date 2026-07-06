"use client";

import type {
  AgentToolCall,
  GetTaskResponse,
  SessionMemoryMessage,
  SessionRecord,
} from "@agent-app/api-contract";
import { BrainCircuit, Loader2, MessageSquareText, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * 右栏调试面板：读服务端真相（summary / messages / task / plannerTrace）。
 * 工具调用优先展示 live SSE（latestToolCalls），无 live 数据时回退 taskDetail.toolCalls。
 */
export function DebugPanel({
  sessionId,
  taskId,
  session,
  serverMessages,
  taskDetail,
  isLoadingTask,
  latestToolCalls,
  statusLabel,
}: {
  sessionId: string | null;
  taskId: string | null;
  session: SessionRecord | null;
  serverMessages: SessionMemoryMessage[];
  taskDetail: GetTaskResponse | null;
  isLoadingTask: boolean;
  latestToolCalls: AgentToolCall[];
  statusLabel: string;
}) {
  const t = useTranslations("chat");
  const sessions = useTranslations("sessions");

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-border/70 bg-sidebar/80 p-4 shadow-[0_18px_60px_rgba(18,36,30,0.08)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">{t("panels.debug")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("panels.debugHint")}</p>
        </div>
        <span className="inline-flex items-center rounded-full border border-border bg-background/70 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
          {statusLabel}
        </span>
      </div>

      <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto">
        <DebugField label={t("panels.session")} value={sessionId ?? "-"} />
        <DebugField label={t("panels.task")} value={taskId ?? "-"} />

        <section className="rounded-[1.25rem] border border-border/80 bg-panel/85 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {sessions("summary.title")}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
            {session?.summary?.trim() || sessions("summary.empty")}
          </p>
        </section>

        <section className="rounded-[1.25rem] border border-border/80 bg-panel/85 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <MessageSquareText className="h-3.5 w-3.5" />
            {sessions("timeline.title")}
          </div>
          {serverMessages.length > 0 ? (
            <div className="max-h-48 space-y-2 overflow-y-auto font-mono text-[11px] leading-5 text-muted-foreground">
              {serverMessages.map((message, index) => (
                <div className="rounded-lg border border-border/60 bg-background/60 p-2" key={`${message.taskId}-${index}`}>
                  <p>
                    [{message.role}] task={message.taskId.slice(0, 8)}…
                  </p>
                  <p className="mt-1 line-clamp-3 break-all whitespace-pre-wrap">{message.content}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{sessions("timeline.empty")}</p>
          )}
        </section>

        <section className="rounded-[1.25rem] border border-border/80 bg-panel/85 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {sessions("task.status")}
          </div>
          {isLoadingTask ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
              {sessions("loading")}
            </div>
          ) : taskDetail ? (
            <div className="space-y-1 font-mono text-xs text-muted-foreground">
              <p>status: {taskDetail.task.status}</p>
              {taskDetail.task.errorCode ? <p className="text-danger">code: {taskDetail.task.errorCode}</p> : null}
              {taskDetail.task.errorMessage ? (
                <p className="break-all text-danger">{taskDetail.task.errorMessage}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">-</p>
          )}
        </section>

        {taskDetail && taskDetail.plannerTrace.length > 0 ? (
          <section className="rounded-[1.25rem] border border-border/80 bg-panel/85 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <BrainCircuit className="h-3.5 w-3.5 text-accent" />
              {sessions("task.plannerTrace")}
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              {sessions("task.steps", { count: taskDetail.plannerTrace.length })}
            </p>
            <div className="space-y-2 font-mono text-[11px] text-muted-foreground">
              {taskDetail.plannerTrace.map((step) => (
                <div className="rounded-lg border border-border/60 bg-background/60 p-2" key={step.id}>
                  <p>
                    step {step.step}: {step.outcome}
                    {step.toolName ? ` · ${step.toolName}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-[1.25rem] border border-border/80 bg-panel/85 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <Wrench className="h-3.5 w-3.5" />
            {t("panels.tools")}
          </div>
          {latestToolCalls.length > 0 ? (
            <ToolCallList toolCalls={latestToolCalls} />
          ) : taskDetail && taskDetail.toolCalls.length > 0 ? (
            // 选中历史 session 或无 live run 时，用落库 tool_calls 回填
            <div className="space-y-2 font-mono text-xs text-muted-foreground">
              {taskDetail.toolCalls.map((toolCall) => (
                <div className="rounded-lg border border-border/60 bg-background/60 p-2" key={toolCall.id}>
                  <p>{toolCall.toolName}</p>
                  <p className="mt-1 break-all">input: {toolCall.toolInput}</p>
                  <p className="line-clamp-3 break-all">output: {toolCall.toolOutput ?? "-"}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">-</p>
          )}
        </section>
      </div>
    </aside>
  );
}

function DebugField({ label, value }: { label: string; value: string }) {
  return (
    <section className="rounded-[1.25rem] border border-border/80 bg-panel/85 p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="mt-2 break-all font-mono text-xs leading-5">{value}</div>
    </section>
  );
}

function ToolCallList({ toolCalls }: { toolCalls: AgentToolCall[] }) {
  return (
    <div className="space-y-2">
      {toolCalls.map((toolCall, index) => (
        <div className="rounded-lg border border-border/60 bg-background/60 p-2" key={`${toolCall.toolName}-${index}`}>
          <div className="text-xs font-semibold">{toolCall.toolName}</div>
          <div className="mt-1 space-y-1 font-mono text-xs text-muted-foreground">
            <p className="break-all">input: {toolCall.input}</p>
            <p className="line-clamp-3 break-all">output: {toolCall.output}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
