import { forwardRef, useCallback, useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { WsClient } from "../lib/ws-client";
import { parseContent } from "../lib/parse-content";
import { MediaBlock, InlineImage } from "./MediaBlock";

type ResponsePanelProps = {
  activeQuery: string;
  response: string;
  isStreaming: boolean;
  isThinking: boolean;
  onCopy: () => void;
  client: WsClient;
};

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const text = String(children).replace(/\n$/, "");
  const language = className?.replace("language-", "") ?? "";

  const copyCode = useCallback(() => {
    void navigator.clipboard.writeText(text);
  }, [text]);

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-block-lang">{language}</span>
        <button className="code-copy-btn" onClick={copyCode} title="Copy code">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
      </div>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

function MarkdownBlock({ children }: { children: string }) {
  return (
    <Markdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={{
        code({ className, children, ...rest }) {
          const isBlock =
            typeof children === "string" && children.includes("\n");
          if (isBlock || className) {
            return <CodeBlock className={className}>{children}</CodeBlock>;
          }
          return (
            <code className="inline-code" {...rest}>
              {children}
            </code>
          );
        },
        pre({ children }) {
          return <>{children}</>;
        },
      }}
    >
      {children}
    </Markdown>
  );
}

export const ResponsePanel = forwardRef<HTMLElement, ResponsePanelProps>(
  function ResponsePanel({ activeQuery, response, isStreaming, isThinking, onCopy, client }, ref) {
    if (!activeQuery) {
      return null;
    }

    // Only parse MEDIA/inline-image segments from final text.
    // During streaming, render plain Markdown (MEDIA paths may be incomplete).
    const segments = useMemo(
      () => (isStreaming ? null : parseContent(response)),
      [response, isStreaming],
    );
    const canCopy = !!response && !isThinking;

    return (
      <section className="dropdown-panel" ref={ref}>
        {canCopy && (
          <button
            className="copy-btn"
            onClick={onCopy}
            title="Copy to clipboard"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        )}
        <div className="answer-body">
          {response ? (
            segments ? (
              segments.map((seg, i) => {
                if (seg.kind === "text") {
                  return <MarkdownBlock key={i}>{seg.value}</MarkdownBlock>;
                }
                if (seg.kind === "media") {
                  return (
                    <MediaBlock
                      key={i}
                      filePath={seg.filePath}
                      mimeType={seg.mimeType}
                      client={client}
                    />
                  );
                }
                if (seg.kind === "inline-image") {
                  return (
                    <InlineImage
                      key={i}
                      mediaType={seg.mediaType}
                      base64={seg.base64}
                    />
                  );
                }
                return null;
              })
            ) : (
              <MarkdownBlock>{response}</MarkdownBlock>
            )
          ) : isThinking ? (
            <div className="thinking-indicator">
              <span className="thinking-dot" />
              <span className="thinking-dot" />
              <span className="thinking-dot" />
            </div>
          ) : null}
        </div>
      </section>
    );
  },
);
