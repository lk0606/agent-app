"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownMessage({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <div className="prose-agent">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} rel="noopener noreferrer" target="_blank">
              {children}
            </a>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-xl border border-border/80 bg-background/80 p-3 font-mono text-xs">
              {children}
            </pre>
          ),
          code: ({ className, children }) => {
            const isBlock = Boolean(className);
            if (isBlock) {
              return <code className={className}>{children}</code>;
            }

            return (
              <code className="rounded-md bg-background/80 px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {streaming ? <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-accent align-middle" /> : null}
    </div>
  );
}
