"use client";

import type { AgentToolCall, GetTaskResponse, SessionMemoryMessage, SessionRecord } from "@agent-app/api-contract";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Loader2,
  RefreshCcw,
  Send,
  Sparkles,
  User,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { streamAgent } from "@/lib/api/agent-api";
import {
  archiveSession,
  getSession,
  getSessionMessages,
  getTask,
  listSessions,
} from "@/lib/api/session-api";

import { applyStreamEvent, finalizeAnswerStep } from "./apply-stream-event";
import { DebugPanel } from "./debug-panel";
import { RunTimeline } from "./run-timeline";
import {
  createAssistantRun,
  isAssistantRun,
  type AssistantRunMessage,
  type ChatItem,
  type UserChatMessage,
} from "./run-types";
import { sessionMessagesToChatItems } from "./session-history";
import { SessionSidebar } from "./session-sidebar";

export function AgentWorkbench() {
  const t = useTranslations("chat");
  const common = useTranslations("common");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionRecord, setSessionRecord] = useState<SessionRecord | null>(null);
  const [serverMessages, setServerMessages] = useState<SessionMemoryMessage[]>([]);
  const [taskDetail, setTaskDetail] = useState<GetTaskResponse | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const latestRun = [...messages].reverse().find(isAssistantRun);
  const latestToolCalls = extractToolCalls(latestRun);
  // 派生 loading，避免 effect 内同步 setState（eslint react-hooks/set-state-in-effect）
  const isLoadingTask = Boolean(taskId) && taskDetail?.task.id !== taskId;

  const refreshSessions = useCallback(async () => {
    setSessionsLoading(true);

    try {
      const response = await listSessions({ status: "active", limit: 50 });
      setSessions(response.sessions);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const reloadSessionDebug = useCallback(async (id: string) => {
    // 只刷新右栏：summary + message timeline，不重置中间聊天气泡
    const [{ session }, { messages }] = await Promise.all([getSession(id), getSessionMessages(id)]);
    setSessionRecord(session);
    setServerMessages(messages);
  }, []);

  const loadSession = useCallback(async (id: string) => {
    setSessionLoading(true);

    try {
      // session 含 tasks；messages 按 taskId 配对后还原 ChatItem
      const [{ session, tasks }, { messages }] = await Promise.all([
        getSession(id),
        getSessionMessages(id),
      ]);

      setSessionId(id);
      setSessionRecord(session);
      setServerMessages(messages);
      setMessages(sessionMessagesToChatItems(messages, tasks));
      setTaskId(tasks.at(-1)?.id ?? null);
    } finally {
      setSessionLoading(false);
    }
  }, []);

  const startNewSession = useCallback(() => {
    setSessionId(null);
    setTaskId(null);
    setMessages([]);
    setSessionRecord(null);
    setServerMessages([]);
    setTaskDetail(null);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;

    void listSessions({ status: "active", limit: 50 })
      .then((response) => {
        if (!cancelled) {
          setSessions(response.sessions);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSessionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!taskId) {
      return;
    }

    // plannerTrace 只在 GET /tasks/:id，不在 session messages
    let cancelled = false;

    void getTask(taskId).then((detail) => {
      if (!cancelled) {
        setTaskDetail(detail);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [taskId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitInput();
  }

  async function submitInput() {
    const trimmedInput = input.trim();

    if (!trimmedInput || isRunning) {
      return;
    }

    setInput("");
    await sendMessage(trimmedInput);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void submitInput();
  }

  function patchAssistantRun(
    assistantMessageId: string,
    updater: (run: AssistantRunMessage) => AssistantRunMessage,
  ) {
    setMessages((current) =>
      current.map((item) =>
        isAssistantRun(item) && item.id === assistantMessageId ? updater(item) : item,
      ),
    );
  }

  async function sendMessage(content: string, existingMessageId?: string) {
    const messageId = existingMessageId ?? crypto.randomUUID();
    const assistantMessageId = `${messageId}-assistant`;

    setMessages((current) => {
      if (existingMessageId) {
        return [
          ...current
            .filter((item) => !(isAssistantRun(item) && item.replyToMessageId === existingMessageId))
            .map((item) =>
              !isAssistantRun(item) && item.id === existingMessageId
                ? { ...item, error: undefined, status: "sending" as const }
                : item,
            ),
          createAssistantRun(assistantMessageId, existingMessageId),
        ];
      }

      return [
        ...current,
        {
          id: messageId,
          role: "user",
          content,
          status: "sending",
        } satisfies UserChatMessage,
        createAssistantRun(assistantMessageId, messageId),
      ];
    });
    setIsRunning(true);

    try {
      await streamAgent(
        {
          input: content,
          ...(sessionId ? { sessionId } : {}),
        },
        (event) => {
          const applyEvent = () => {
            switch (event.type) {
              case "planner_decision":
              case "tool_start":
              case "tool_end":
              case "token":
                patchAssistantRun(assistantMessageId, (run) => ({
                  ...run,
                  steps: applyStreamEvent(run.steps, event),
                }));
                return;
              case "done":
                setSessionId(event.sessionId);
                setTaskId(event.taskId);
                patchAssistantRun(assistantMessageId, (run) => ({
                  ...run,
                  id: event.taskId,
                  taskId: event.taskId,
                  status: "done",
                  steps: finalizeAnswerStep(run.steps, event.result.summary),
                }));
                setMessages((current) =>
                  current.map((item) =>
                    !isAssistantRun(item) && item.id === messageId
                      ? { ...item, error: undefined, status: "sent" as const }
                      : item,
                  ),
                );
                // stream 落库后刷新左栏 summary 与右栏 timeline
                void refreshSessions();
                void reloadSessionDebug(event.sessionId);
                return;
              case "error":
                throw new Error(event.message);
            }
          };

          flushSync(applyEvent);
        },
      );
    } catch (requestError) {
      const message = formatRequestError(requestError);

      setMessages((current) =>
        current
          .map((item) => {
            if (isAssistantRun(item) && item.id === assistantMessageId) {
              return { ...item, status: "failed" as const, error: message };
            }

            if (!isAssistantRun(item) && item.id === messageId) {
              return { ...item, error: message, status: "failed" as const };
            }

            return item;
          })
          .filter((item) => !(isAssistantRun(item) && item.status === "failed" && item.steps.length === 0)),
      );
    } finally {
      setIsRunning(false);
    }
  }

  async function handleArchiveSession() {
    if (!sessionId || isRunning) {
      return;
    }

    await archiveSession(sessionId);
    startNewSession();
    await refreshSessions();
  }

  function formatRequestError(requestError: unknown): string {
    if (requestError instanceof TypeError) {
      return t("errors.network");
    }

    if (requestError instanceof Error) {
      return requestError.message;
    }

    return t("errors.requestFailed");
  }

  const failedCount = messages.filter(
    (item) => !isAssistantRun(item) && item.status === "failed",
  ).length;
  const statusLabel = isRunning
    ? common("status.running")
    : failedCount > 0
      ? t("status.needsRetry")
      : common("status.ready");

  return (
    <main className="relative h-dvh overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(20,111,103,0.18),transparent_26rem),radial-gradient(circle_at_82%_0%,rgba(220,118,68,0.14),transparent_24rem)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(32,56,48,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(32,56,48,0.05)_1px,transparent_1px)] opacity-70 [background-size:44px_44px]" />

      <div className="relative mx-auto flex h-dvh w-full max-w-[1540px] flex-col gap-3 px-3 py-3 sm:px-4">
        <header className="shrink-0 rounded-[1.5rem] border border-border/70 bg-panel/85 p-3 shadow-[0_18px_60px_rgba(18,36,30,0.1)] backdrop-blur-xl">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-background shadow-lg">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.26em] text-accent">
                  <Zap className="h-3.5 w-3.5" />
                  Node Agent Lab
                </div>
                <h1 className="mt-0.5 text-xl font-semibold tracking-tight sm:text-2xl">{t("title")}</h1>
                <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill icon={<CheckCircle2 className="h-3.5 w-3.5" />} label={statusLabel} />
              <ThemeToggle />
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[280px_minmax(0,1fr)_330px]">
          <aside className="hidden min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-border/70 bg-sidebar/80 p-4 shadow-[0_18px_60px_rgba(18,36,30,0.08)] backdrop-blur-xl xl:flex">
            <SessionSidebar
              isLoading={sessionsLoading || sessionLoading}
              isRunning={isRunning}
              selectedSessionId={sessionId}
              sessions={sessions}
              onArchive={() => {
                void handleArchiveSession();
              }}
              onNewSession={startNewSession}
              onRefresh={() => {
                void refreshSessions();
              }}
              onSelectSession={(id) => {
                void loadSession(id);
              }}
            />
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-border/70 bg-background/72 shadow-[0_20px_70px_rgba(18,36,30,0.12)] backdrop-blur-xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-panel/70 px-4 py-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  {t("conversation.eyebrow")}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">{t("conversation.hint")}</div>
              </div>
              <StatusPill
                icon={isRunning || sessionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                label={statusLabel}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {sessionLoading ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-accent" />
                  {t("status.thinking")}
                </div>
              ) : messages.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="space-y-5">
                  {messages.map((message) =>
                    isAssistantRun(message) ? (
                      <AssistantRunRow isRunning={isRunning} key={message.id} run={message} />
                    ) : (
                      <UserMessageRow
                        isRunning={isRunning}
                        key={message.id}
                        message={message}
                        retryLabel={t("composer.retry")}
                        sendingLabel={t("status.sending")}
                        onRetry={(failedMessage) => {
                          void sendMessage(failedMessage.content, failedMessage.id);
                        }}
                      />
                    ),
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            <form className="shrink-0 border-t border-border/70 bg-panel/75 p-3" onSubmit={handleSubmit}>
              <div className="flex gap-2 rounded-[1.25rem] border border-border bg-background/85 p-2 shadow-inner">
                <textarea
                  className="min-h-20 flex-1 resize-none bg-transparent px-2 py-2 text-base leading-7 outline-none placeholder:text-muted-foreground"
                  placeholder={t("composer.placeholder")}
                  value={input}
                  onKeyDown={handleComposerKeyDown}
                  onChange={(event) => setInput(event.target.value)}
                />
                <button
                  className="inline-flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-foreground text-background shadow-lg transition hover:-translate-y-0.5 hover:opacity-95 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
                  disabled={isRunning || input.trim().length === 0}
                  type="submit"
                >
                  {isRunning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                  <span className="sr-only">{t("composer.submit")}</span>
                </button>
              </div>
            </form>
          </section>

          <DebugPanel
            isLoadingTask={isLoadingTask}
            latestToolCalls={latestToolCalls}
            serverMessages={serverMessages}
            session={sessionRecord}
            sessionId={sessionId}
            statusLabel={statusLabel}
            taskDetail={taskId ? taskDetail : null}
            taskId={taskId}
          />
        </div>
      </div>
    </main>
  );
}

function extractToolCalls(run: AssistantRunMessage | undefined): AgentToolCall[] {
  if (!run) {
    return [];
  }

  return run.steps
    .filter((step): step is Extract<typeof step, { kind: "tool" }> => step.kind === "tool" && step.status === "succeeded")
    .map((step) => ({
      toolName: step.toolName,
      input: step.toolInput,
      output: step.output ?? "",
    }));
}

function EmptyState() {
  const t = useTranslations("chat");

  return (
    <div className="flex h-full min-h-0 items-center justify-center">
      <div className="max-w-lg rounded-[1.5rem] border border-border/80 bg-panel/80 p-6 text-center shadow-[0_18px_60px_rgba(18,36,30,0.1)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Bot className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-xl font-semibold">{t("empty.title")}</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("empty.description")}</p>
      </div>
    </div>
  );
}

function UserMessageRow({
  isRunning,
  message,
  retryLabel,
  sendingLabel,
  onRetry,
}: {
  isRunning: boolean;
  message: UserChatMessage;
  retryLabel: string;
  sendingLabel: string;
  onRetry: (message: UserChatMessage) => void;
}) {
  const isFailed = message.status === "failed";
  const isSending = message.status === "sending";

  return (
    <article className="flex items-start justify-end gap-3">
      {isFailed ? (
        <button
          aria-label={retryLabel}
          className="mt-2 inline-flex h-9 w-9 items-center justify-center rounded-full border border-danger/30 bg-danger-soft text-danger shadow-sm transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isRunning}
          type="button"
          onClick={() => onRetry(message)}
        >
          <AlertCircle className="h-4 w-4" />
        </button>
      ) : null}
      <div className="flex max-w-[85%] flex-col items-end gap-2 sm:max-w-[760px]">
        <div
          className={`rounded-[1.35rem] border px-4 py-3 text-sm leading-6 shadow-sm ${
            isFailed
              ? "border-danger/30 bg-danger-soft text-foreground"
              : "border-transparent bg-accent text-accent-foreground shadow-[0_18px_38px_rgba(15,118,110,0.2)]"
          }`}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
          {isSending ? (
            <div className="mt-3 flex items-center gap-2 text-xs opacity-80">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{sendingLabel}</span>
            </div>
          ) : null}
          {isFailed ? (
            <div className="mt-3 rounded-xl border border-danger/25 bg-background/65 p-3 text-danger">
              <p className="text-xs leading-5">{message.error}</p>
              <button
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isRunning}
                type="button"
                onClick={() => onRetry(message)}
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                {retryLabel}
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <Avatar icon={<User className="h-4 w-4" />} tone="user" />
    </article>
  );
}

function AssistantRunRow({ run, isRunning }: { run: AssistantRunMessage; isRunning: boolean }) {
  return (
    <article className="flex items-start gap-3">
      <Avatar icon={<Bot className="h-4 w-4" />} tone="assistant" />
      <div className="min-w-0 flex-1 max-w-[920px]">
        <RunTimeline run={run} />
        {run.status === "failed" && !isRunning ? (
          <div className="mt-3 rounded-xl border border-danger/25 bg-danger-soft/50 p-3 text-sm text-danger">
            {run.error}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function Avatar({ icon, tone }: { icon: ReactNode; tone: "assistant" | "user" }) {
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border shadow-sm ${
        tone === "user"
          ? "border-accent/20 bg-accent-soft text-accent"
          : "border-border bg-panel text-muted-foreground"
      }`}
    >
      {icon}
    </div>
  );
}

function StatusPill({ icon, label }: { icon?: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/70 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
      {icon}
      {label}
    </span>
  );
}
