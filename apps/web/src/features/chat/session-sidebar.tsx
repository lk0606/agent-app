"use client";

import type { SessionRecord } from "@agent-app/api-contract";
import { Archive, Loader2, MessageSquarePlus, RefreshCcw } from "lucide-react";
import { useTranslations } from "next-intl";

import { formatSessionPreview } from "./session-history";

/** 左栏 session 列表（仅 xl 断点由 workbench 挂载；归档后从 active 列表消失） */
export function SessionSidebar({
  sessions,
  selectedSessionId,
  isLoading,
  isRunning,
  onSelectSession,
  onNewSession,
  onRefresh,
  onArchive,
}: {
  sessions: SessionRecord[];
  selectedSessionId: string | null;
  isLoading: boolean;
  isRunning: boolean;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onRefresh: () => void;
  onArchive: () => void;
}) {
  const t = useTranslations("sessions");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">{t("title")}</div>
        <div className="flex items-center gap-1">
          <IconButton disabled={isLoading || isRunning} label={t("newSession")} onClick={onNewSession}>
            <MessageSquarePlus className="h-4 w-4" />
          </IconButton>
          <IconButton disabled={isLoading || isRunning} label="Refresh" onClick={onRefresh}>
            <RefreshCcw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </IconButton>
          {selectedSessionId ? (
            <IconButton disabled={isRunning} label={t("archive")} onClick={onArchive}>
              <Archive className="h-4 w-4" />
            </IconButton>
          ) : null}
        </div>
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
        {isLoading && sessions.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-panel/70 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
            {t("loading")}
          </div>
        ) : null}

        {!isLoading && sessions.length === 0 ? (
          <p className="rounded-xl border border-border/70 bg-panel/70 px-3 py-3 text-xs leading-5 text-muted-foreground">
            {t("empty")}
          </p>
        ) : null}

        {sessions.map((session) => {
          const isSelected = session.id === selectedSessionId;
          const preview = formatSessionPreview(session.summary, session.id.slice(0, 8));

          return (
            <button
              className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                isSelected
                  ? "border-accent/40 bg-accent-soft/50 shadow-sm"
                  : "border-border/70 bg-panel/70 hover:border-accent/25 hover:bg-panel"
              }`}
              disabled={isRunning}
              key={session.id}
              type="button"
              onClick={() => onSelectSession(session.id)}
            >
              <div className="truncate font-mono text-[11px] text-muted-foreground">{session.id.slice(0, 8)}…</div>
              <div className="mt-1 line-clamp-2 text-sm leading-5">{preview}</div>
              {session.lastTaskAt ? (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {new Date(session.lastTaskAt).toLocaleString()}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function IconButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-panel/80 text-muted-foreground transition hover:border-accent/30 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
