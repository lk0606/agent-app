"use client";

import type { AgentToolCall } from "@agent-app/api-contract";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCcw,
  Send,
  Sparkles,
  User,
  Wrench,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, type KeyboardEvent, type ReactNode, useState } from "react";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { runAgent } from "@/lib/api/agent-api";

type MessageStatus = "sending" | "sent" | "failed";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: MessageStatus;
  error?: string;
  toolCalls?: AgentToolCall[];
};

export function AgentWorkbench() {
  const t = useTranslations("chat");
  const common = useTranslations("common");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

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

  async function sendMessage(content: string, existingMessageId?: string) {
    const messageId = existingMessageId ?? crypto.randomUUID();

    setMessages((current) => {
      if (existingMessageId) {
        return current.map((message) =>
          message.id === existingMessageId
            ? { ...message, error: undefined, status: "sending" }
            : message,
        );
      }

      return [
        ...current,
        {
          id: messageId,
          role: "user",
          content,
          status: "sending",
        },
      ];
    });
    setIsRunning(true);

    try {
      const response = await runAgent({
        input: content,
        ...(sessionId ? { sessionId } : {}),
      });

      setSessionId(response.sessionId);
      setTaskId(response.taskId);
      setMessages((current) => [
        ...current.map((message) =>
          message.id === messageId ? { ...message, error: undefined, status: "sent" as const } : message,
        ),
        {
          id: response.taskId,
          role: "assistant",
          content: response.result.summary,
          toolCalls: response.result.toolCalls,
        },
      ]);
    } catch (requestError) {
      const message = formatRequestError(requestError);

      setMessages((current) =>
        current.map((chatMessage) =>
          chatMessage.id === messageId
            ? {
                ...chatMessage,
                error: message,
                status: "failed",
              }
            : chatMessage,
        ),
      );
    } finally {
      setIsRunning(false);
    }
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

  const latestToolCalls = [...messages].reverse().find((message) => message.toolCalls?.length)?.toolCalls ?? [];
  const failedCount = messages.filter((message) => message.status === "failed").length;
  const statusLabel = isRunning ? common("status.running") : failedCount > 0 ? t("status.needsRetry") : common("status.ready");

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
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              {common("appName")}
            </div>
            <div className="mt-3 rounded-[1.25rem] border border-border/80 bg-panel/85 p-3">
              <div className="text-sm font-semibold">{t("overview.title")}</div>
              <p className="mt-1.5 text-sm leading-5 text-muted-foreground">{t("overview.description")}</p>
            </div>
            <div className="mt-3 grid gap-2">
              <MiniStat icon={<Database className="h-4 w-4" />} label={t("panels.session")} value={sessionId ?? "-"} />
              <MiniStat icon={<Zap className="h-4 w-4" />} label={t("panels.task")} value={taskId ?? "-"} />
              <MiniStat icon={<Wrench className="h-4 w-4" />} label={t("panels.tools")} value={String(latestToolCalls.length)} />
            </div>
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-border/70 bg-background/72 shadow-[0_20px_70px_rgba(18,36,30,0.12)] backdrop-blur-xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-panel/70 px-4 py-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  {t("conversation.eyebrow")}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">{t("conversation.hint")}</div>
              </div>
              <StatusPill icon={isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} label={statusLabel} />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {messages.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="space-y-5">
                  {messages.map((message) => (
                    <MessageRow
                      isRunning={isRunning}
                      key={message.id}
                      message={message}
                      retryLabel={t("composer.retry")}
                      sendingLabel={t("status.sending")}
                      onRetry={(failedMessage) => {
                        void sendMessage(failedMessage.content, failedMessage.id);
                      }}
                    />
                  ))}
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

          <aside className="min-h-0 overflow-hidden rounded-[1.5rem] border border-border/70 bg-sidebar/80 p-4 shadow-[0_18px_60px_rgba(18,36,30,0.08)] backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">{t("panels.debug")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("panels.debugHint")}</p>
              </div>
              <StatusPill label={statusLabel} />
            </div>
            <div className="mt-4 space-y-3">
              <DebugField label={t("panels.session")} value={sessionId ?? "-"} />
              <DebugField label={t("panels.task")} value={taskId ?? "-"} />
              <section className="rounded-[1.25rem] border border-border/80 bg-panel/85 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  <Wrench className="h-3.5 w-3.5" />
                  {t("panels.tools")}
                </div>
                {latestToolCalls.length > 0 ? (
                  <ToolCallList toolCalls={latestToolCalls} />
                ) : (
                  <p className="text-sm text-muted-foreground">-</p>
                )}
              </section>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
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

function MessageRow({
  isRunning,
  message,
  retryLabel,
  sendingLabel,
  onRetry,
}: {
  isRunning: boolean;
  message: ChatMessage;
  retryLabel: string;
  sendingLabel: string;
  onRetry: (message: ChatMessage) => void;
}) {
  const isUser = message.role === "user";
  const isFailed = message.status === "failed";
  const isSending = message.status === "sending";

  return (
    <article className={`flex items-start gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser ? <Avatar icon={<Bot className="h-4 w-4" />} tone="assistant" /> : null}
      {isUser && isFailed ? (
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
      <div className={`flex max-w-[85%] flex-col gap-2 sm:max-w-[760px] ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-[1.35rem] border px-4 py-3 text-sm leading-6 shadow-sm ${
            isUser
              ? isFailed
                ? "border-danger/30 bg-danger-soft text-foreground"
                : "border-transparent bg-accent text-accent-foreground shadow-[0_18px_38px_rgba(15,118,110,0.2)]"
              : "border-border/80 bg-panel/95"
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
          {message.toolCalls && message.toolCalls.length > 0 ? <ToolCallList toolCalls={message.toolCalls} /> : null}
        </div>
      </div>
      {isUser ? <Avatar icon={<User className="h-4 w-4" />} tone="user" /> : null}
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

function MiniStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <section className="rounded-[1.2rem] border border-border/80 bg-panel/85 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 line-clamp-2 break-all font-mono text-xs leading-5">{value}</div>
    </section>
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
    <div className="mt-3 space-y-2">
      {toolCalls.map((toolCall, index) => (
        <div className="rounded-2xl border border-border/80 bg-background/70 p-3" key={`${toolCall.toolName}-${index}`}>
          <div className="flex items-center gap-2 text-xs font-semibold">
            <Wrench className="h-3.5 w-3.5 text-accent" />
            {toolCall.toolName}
          </div>
          <div className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
            <p className="break-all">input: {toolCall.input}</p>
            <p className="line-clamp-3 break-all">output: {toolCall.output}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
