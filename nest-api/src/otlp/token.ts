import { createHash, randomBytes } from "node:crypto";

import type { IssuedToken } from "./interfaces/otlp-types";

/**
 * The OTLP write token (IKN-87): how it is made, how it is stored, and what an origin is.
 *
 * `ikt_` then 32 random bytes in base64url — 256 bits, so it cannot be guessed and does not need a
 * slow hash to resist a dictionary. The prefix is there for people and scanners: a token pasted in
 * the wrong place is recognisable as an Iknos token at a glance, and secret scanners match on it.
 */
export const TOKEN_PREFIX = "ikt_";

const TOKEN_BYTES = 32;

/** Hex SHA-256 — what `ingest_token.token_hash` holds, and the only form the database ever sees. */
export function hashToken(clear: string): string {
  return createHash("sha256").update(clear, "utf8").digest("hex");
}

/** A fresh token: the clear value to print once, and its hash to store. */
export function issueToken(): IssuedToken {
  const clear = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  return { clear, hash: hashToken(clear) };
}

/**
 * A presented token worth a database lookup: our prefix, then base64url, at a sane length.
 *
 * A shape check, not a security one — the lookup is by hash either way. It keeps a header holding
 * a megabyte of junk from being hashed, and makes "you sent the wrong kind of thing" cheap.
 */
const TOKEN_SHAPE = /^ikt_[A-Za-z0-9_-]{20,128}$/;
export const looksLikeToken = (value: string): boolean => TOKEN_SHAPE.test(value);

/**
 * An `Origin` header value as a browser sends it: scheme, host, optional port — no path, no
 * trailing slash. Anything else would never match a real request, so the CLI refuses it at
 * creation rather than storing an allowance that silently allows nothing.
 */
const ORIGIN_SHAPE = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/;

/** The origin in its canonical form, or `null` when it is not one. */
export function normalizeOrigin(raw: string): string | null {
  const origin = raw.trim().toLowerCase();
  return ORIGIN_SHAPE.test(origin) ? origin : null;
}

/**
 * `ingest_token.allowed_origins` read back. A JSON column is whatever was written to it, so only
 * well-formed origins survive — a hand-edited row cannot widen what a token allows.
 */
export function readOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map(normalizeOrigin)
    .filter((origin): origin is string => origin !== null);
}

/**
 * Whether a request from `origin` may write with a token allowing `allowed`.
 *
 * No `Origin` at all is a server-side caller — curl, a collector, a test — and it is let through
 * on the token alone; demanding one would lock out every non-browser. A browser always sends one
 * on a cross-origin POST, so this does not open anything a page could use.
 */
export function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (origin === undefined) return true;
  const normalized = normalizeOrigin(origin);
  return normalized !== null && allowed.includes(normalized);
}
