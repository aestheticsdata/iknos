"use client";

import { AUTH_TEXT } from "@text/auth";

/**
 * `SHOW` / `HIDE` beside a secret field.
 *
 * Worth having on all three forms, and most of all on registration: the passphrase is typed twice,
 * has to be transcribed onto paper, and is the single thing standing between the operator and a
 * locked box. Typing it blind twice and getting "the two entries do not match" with no way to see
 * what went wrong is how people end up choosing a shorter one.
 *
 * `type="button"` explicitly — a bare `<button>` inside a form submits it, which here would post a
 * half-filled registration on the way to reading your own passphrase.
 */
export const RevealToggle = ({ revealed, onToggle }: { revealed: boolean; onToggle: () => void }) => (
  <button
    aria-pressed={revealed}
    className="rounded-chip border border-chassis-border-strong px-1.5 py-px text-kicker tracking-control text-chassis-text-muted transition-colors duration-150 ease-out hover:border-chassis-border-focus hover:text-chassis-text"
    onClick={onToggle}
    type="button"
  >
    {revealed ? AUTH_TEXT.fields.conceal : AUTH_TEXT.fields.reveal}
  </button>
);
