"use client";

import { formatCount } from "@lib/format";
import { TRACES_TEXT } from "@text/traces";
import { useState } from "react";

import type { GenAiMessage } from "@lib/interfaces/spanKindTypes";

const COPIED_MS = 1500;

/** One side of a model call — the prompt or the response — as role-tagged text, with a copy action. */
export const MessageBlock = ({ title, tokens, messages }: MessageBlockProps) => {
  const [copied, setCopied] = useState(false);
  const text = messages
    .map((message) => (message.role ? `[${message.role}]\n${message.text}` : message.text))
    .join("\n\n");

  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between pb-1">
        <span className="text-kicker tracking-kicker text-work-text-dim uppercase">
          {title}
          {tokens !== null && ` · ${formatCount(tokens)}`}
        </span>
        <button
          type="button"
          onClick={copy}
          className="h-5.5 rounded-control border border-work-border-strong px-2 text-label text-work-text transition-colors duration-150 ease-out hover:bg-work-inset"
        >
          {copied ? TRACES_TEXT.copied : TRACES_TEXT.copy}
        </button>
      </div>
      <pre className="ik-scroll-work max-h-58 overflow-x-auto overflow-y-auto rounded-control border border-work-border bg-work-inset px-3 py-2.5 text-row leading-relaxed whitespace-pre-wrap text-work-text">
        {messages.map((message) => (
          <span key={message.position}>
            {message.role !== "" && (
              <span className="text-work-text-dim">
                [{TRACES_TEXT.role(message.role)}]{"\n"}
              </span>
            )}
            {message.text}
            {message.position < messages.length - 1 && "\n\n"}
          </span>
        ))}
      </pre>
    </div>
  );
};

type MessageBlockProps = {
  title: string;
  tokens: number | null;
  messages: GenAiMessage[];
};
