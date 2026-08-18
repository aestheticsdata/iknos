"use client";

import { cn } from "@lib/utils";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { TONE_TEXT } from "./surface";

import type { Tone } from "./surface";

/**
 * Toasts — always the chassis surface and always elevated, like modals and the user menu (§3.1).
 *
 * A provider rather than a component the caller places, because the things that raise a toast are
 * scattered — the user menu, a copy action, a failed mutation — and prop-drilling a setter to each
 * of them is how a toast ends up reimplemented three times.
 *
 * `role="status"` with `aria-live="polite"`: a toast is an aside, and interrupting whatever is
 * being read to announce "copied" is worse than saying it a moment later. Anything that genuinely
 * must interrupt is an error that belongs in the page, not in a corner that fades.
 */

export type Toast = { id: number; message: string; tone: Tone };

type ToastContextValue = { show: (message: string, tone?: Tone) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

/** The default lifetime. Long enough to read a short sentence twice, which is the actual bar. */
const LIFETIME_MS = 4000;

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, tone: Tone = "neutral") => {
    // `Date.now()` would collide for two toasts raised in the same millisecond — rare, and the
    // symptom is a duplicate React key rather than anything visible, which makes it the kind of
    // bug that survives for months. A counter cannot collide.
    setToasts((current) => {
      const id = (current.at(-1)?.id ?? 0) + 1;
      setTimeout(() => setToasts((rest) => rest.filter((toast) => toast.id !== id)), LIFETIME_MS);
      return [...current, { id, message, tone }];
    });
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastHost
        toasts={toasts}
        onDismiss={(id) => setToasts((rest) => rest.filter((t) => t.id !== id))}
      />
    </ToastContext.Provider>
  );
};

/** Throws rather than no-opping: a toast that silently never appears is a bug you chase in the UI. */
export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (context === null) throw new Error("useToast must be used inside a <ToastProvider>");
  return context;
};

const ToastHost = ({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) => (
  <div
    role="status"
    aria-live="polite"
    className="pointer-events-none fixed right-3 bottom-8 z-50 flex flex-col items-end gap-1.5"
  >
    {toasts.map((toast) => (
      <div
        key={toast.id}
        className={cn(
          "pointer-events-auto flex items-center gap-2 rounded-control border border-chassis-border-strong",
          "bg-chassis-raised px-2.5 py-1.5 font-mono text-dense shadow-menu",
          TONE_TEXT.chassis[toast.tone],
        )}
      >
        <span>{toast.message}</span>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss"
          className="text-chassis-text-dim hover:text-chassis-text"
        >
          ×
        </button>
      </div>
    ))}
  </div>
);
