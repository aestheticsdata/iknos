"use client";

import { Tooltip, TooltipBlock } from "@components/ui/Tooltip";
import { logsHref } from "@lib/logsHref";
import { ABSENT, formatUptime } from "@lib/serviceFormat";
import { cn } from "@lib/utils";
import { SERVICE_TEXT } from "@text/service";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { ProbeCheck, ProbeSummary, ProcessFacts, ServiceRuntime } from "@lib/serviceTypes";
import type { RangeKey } from "@lib/timeRange";
import type { ReactNode } from "react";

/**
 * The service view's header — design doc §5.2, first paragraph.
 *
 * Name, the emitter line, five identity chips, and the health pills. It answers "what is this and
 * what is it running" in one row, and it is the one part of the view whose geometry must not move:
 * the release chip renders `—` rather than disappearing, because the layout should not change on
 * the day a deploy first writes a marker (design doc §8.7).
 *
 * The chips are identity and are inert. Only one of them is a *symptom* — restarts — and it turns
 * red above zero, which is the whole of what §5.2 asks the row to say beyond the facts.
 *
 * The one control on the row is the signals toggle, at the far right. It lives here rather than in
 * the query bar below because this row is the part of the screen that is only ever on when a
 * service is selected, which is exactly when there are tiles to hide.
 */

/** How far either side of a failed probe its logs are worth reading. */
const PROBE_WINDOW_MS = 120_000;

export const ServiceHeader = ({
  runtime,
  range,
  signalsOpen,
  onToggleSignals,
}: {
  runtime: ServiceRuntime;
  range: RangeKey;
  signalsOpen: boolean;
  onToggleSignals: () => void;
}) => {
  // Not `process` — that name is a global, and a component that shadows it reads as one that
  // touches the environment.
  const facts = runtime.process;

  return (
    <header
      className="flex h-[52px] flex-none items-center gap-3 rounded-card border border-work-border bg-work-surface px-3.25"
      data-testid="service-header"
    >
      <h1
        className="flex-none font-mono text-signal font-semibold text-work-text"
        data-testid="service-name"
      >
        {runtime.service}
      </h1>
      {/*
       * The one thing on the row that gives way.
       *
       * Everything to its right is a *fact* — five chips, three pills, one control — and each of
       * them is either whole or misread: a restarts chip clipped to `rest` is worse than absent.
       * This line is the only thing here that is context rather than a reading, so it takes the
       * shrinking and truncates, and the row fits at 1440 with all of it legible.
       */}
      <span className="min-w-0 flex-1 truncate text-row text-work-text-muted">{SERVICE_TEXT.emitter}</span>

      {/* A list, because that is what it is: five facts of the same kind, named once so a reader
          is told what they are five of rather than hearing them as loose values. */}
      <ul
        aria-label={SERVICE_TEXT.chipsLabel}
        className="flex flex-none items-center gap-1.5"
        data-testid="service-chips"
      >
        <Chip
          chip="pm2"
          label={SERVICE_TEXT.chipPm2}
          value={facts?.pm2Id == null ? ABSENT : String(facts.pm2Id)}
        />
        <Chip
          chip="node"
          label={SERVICE_TEXT.chipNode}
          value={facts?.nodeVersion ?? ABSENT}
        />
        <Chip
          chip="release"
          label={SERVICE_TEXT.chipRelease}
          value={runtime.release ?? ABSENT}
          hint={runtime.release === null ? SERVICE_TEXT.releaseHint : null}
        />
        <Uptime process={facts} />
        <Chip
          chip="restarts"
          label={SERVICE_TEXT.chipRestarts}
          value={facts === null ? ABSENT : String(facts.restarts)}
          tone={facts !== null && facts.restarts > 0 ? "error" : "neutral"}
          hint={facts === null ? SERVICE_TEXT.processAbsent : SERVICE_TEXT.restartsHint(facts.restarts)}
        />
      </ul>

      <HealthPills
        service={runtime.service}
        probe={runtime.probe}
        probed={runtime.probed}
        range={range}
      />

      <SignalsToggle
        open={signalsOpen}
        onToggle={onToggleSignals}
      />
    </header>
  );
};

/**
 * The one control the work area's top row carries — IKN-13, after `/service` and `/logs` became one
 * screen.
 *
 * Exported because the header is only rendered once the runtime payload has arrived, and the
 * toggle has to exist in the second before that too: the placeholder row renders this same button,
 * so the control does not appear a beat after the row it sits in.
 *
 * Labelled with the *action*, not the state, and `aria-expanded` carries the state — a button that
 * reads `signals` when signals are showing is the one every reader clicks twice to work out.
 *
 * That label flips on every click, which is why the testid exists: `show signals` names nothing a
 * second later. One control, two possible parents — `service-header` or `service-notice`, never
 * both at once.
 */
export const SignalsToggle = ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
  <Tooltip
    mode="hover"
    content={SERVICE_TEXT.signalsHint}
    className="flex-none"
  >
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      data-testid="signals-toggle"
      className="rounded-chip border border-work-border-strong bg-work-inset px-1.75 py-0.5 text-row whitespace-nowrap text-work-text-muted transition-colors duration-150 ease-out hover:border-work-text-dim hover:text-work-text"
    >
      {open ? SERVICE_TEXT.hideSignals : SERVICE_TEXT.showSignals}
    </button>
  </Tooltip>
);

/**
 * How long the process has been up — and, when it is not, that it is not.
 *
 * **PM2's `status` is the gate, not `startedAt`.** A stopped process keeps the start time of its
 * last run, so computing an uptime from it alone produces a number that climbs all afternoon for
 * something that has not been running since lunch — the most confident possible statement of the
 * exact opposite of the truth. Anything but `online` shows the word PM2 used, in the red skin.
 *
 * No mount guard, unlike the top bar's clock: this component is only ever rendered once the
 * runtime payload has arrived, which is a client fetch — so there is no server render for
 * `Date.now()` to disagree with. Guarding it anyway would render `—` for one frame and then widen
 * the chip, shifting the one beside it.
 */
const Uptime = ({ process: facts }: { process: ProcessFacts | null | undefined }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // A minute: the chip's finest unit is a minute, so anything faster redraws the same string.
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const stopped = facts != null && facts.status !== "online";

  return (
    <Chip
      chip="uptime"
      label={SERVICE_TEXT.chipUptime}
      value={stopped ? facts.status : formatUptime(facts?.startedAt ?? null, now)}
      tone={stopped ? "error" : "neutral"}
      hint={stopped ? SERVICE_TEXT.stoppedHint(facts.status) : null}
      /* The one figure on the row that changes by itself — a minute later, or the word `stopped` —
         so the storyboard gets the value alone under a name of its own, beside the chip's. */
      valueTestId="uptime"
    />
  );
};

/**
 * One identity chip — a dimmed key and an undimmed value, the same shape the log query bar's tokens
 * use so that a row of them scans as a list of values with their fields attached.
 */
type ChipProps = {
  /** Which fact this is — `pm2`, `node`, `release`, `uptime`, `restarts` — as `data-chip`, so a
   *  storyboard names the member by its key and never by a label or a value (ZEU-78). */
  chip: string;
  label: string;
  value: string;
  tone?: "neutral" | "error";
  /** What the chip means beyond its value, or `null` when the value says it all. */
  hint?: ReactNode;
  suppressHydrationWarning?: boolean;
  /** A name for the value span alone, for the one chip whose figure ticks — see `Uptime`. */
  valueTestId?: string;
};

/*
 * The bubble wraps the chip's text rather than the `<li>`: a `<span>` around a list item is not a
 * list any more. `tabIndex` because a chip is otherwise inert, and a hint only the mouse can read is
 * the defect IKN-62 exists to remove — set only when there is a hint, so the row does not grow five
 * tab stops that say nothing.
 */
const Chip = ({
  chip,
  label,
  value,
  tone = "neutral",
  hint = null,
  suppressHydrationWarning,
  valueTestId,
}: ChipProps) => (
  <li
    data-testid="service-chip"
    data-chip={chip}
    className={cn(
      "flex-none rounded-chip border px-1.75 py-0.5 text-row whitespace-nowrap transition-colors duration-150 ease-out",
      /*
       * The red chip is a red *fill*, not red ink.
       *
       * `work-error` on `work-error-bg` measures 3.98:1 — below the 4.5 the project holds its own
       * state colours to, and a pairing `pnpm run contrast` did not cover until this shipped, since
       * the gate checks the four inks against the ramp's own backgrounds and nothing had put one on
       * a tint before. The tint is what says "red"; the text only has to be readable.
       */
      tone === "error"
        ? "border-work-border-strong bg-work-error-bg text-work-text"
        : "border-work-border-strong bg-work-inset text-work-text-muted",
    )}
  >
    <Tooltip
      mode="hover"
      content={hint}
      className="inline rounded-chip"
      tabIndex={0}
    >
      <span className="text-work-text-dim">{label} </span>
      <span
        className="text-work-text"
        suppressHydrationWarning={suppressHydrationWarning}
        data-testid={valueTestId}
      >
        {value}
      </span>
    </Tooltip>
  </li>
);

/**
 * The pills: one per dependency the service reported, then the endpoint itself.
 *
 * The dependency keys are the service's own words — PFA calls its database `db` and the mockup
 * draws `mysql`. Translating here would be Iknos asserting which engine sits behind a word only the
 * service knows the truth of, and the day one of them reports `postgres` the pill would still say
 * `mysql`.
 *
 * Order is stable regardless of state, so a pill never moves under the pointer; colour carries the
 * change. §5.2 wants a failing pill to open the matching alert — alerts arrive with IKN-15, so
 * until then it opens the service's error logs around the moment the probe failed, which is where
 * the answer actually is today. A healthy pill leads nowhere and carries its detail in a bubble:
 * the probe detail view it would open does not exist in any milestone.
 */
const HealthPills = ({
  service,
  probe,
  probed,
  range,
}: {
  service: string;
  probe: ProbeSummary | null;
  probed: boolean;
  range: RangeKey;
}) => {
  if (probe === null) {
    return (
      <span
        className="flex-none text-row text-work-text-dim"
        data-testid="health-absent"
      >
        {probed ? SERVICE_TEXT.probedNever : SERVICE_TEXT.probedNot}
      </span>
    );
  }

  const failing = probe.status !== "ok";
  const checkedAt = Date.parse(probe.checkedAt);
  const href =
    failing && !Number.isNaN(checkedAt)
      ? logsHref({
          range,
          values: { service, level: "error" },
          bounds: {
            from: new Date(checkedAt - PROBE_WINDOW_MS).toISOString(),
            to: new Date(checkedAt + PROBE_WINDOW_MS).toISOString(),
          },
        })
      : null;

  return (
    <div
      className="flex flex-none items-center gap-1.5"
      data-testid="health-pills"
    >
      {probe.checks.map((check) => (
        <Pill
          key={check.name}
          check={check.name}
          tone={check.status === "ok" ? "ok" : "error"}
          label={`${check.name} ${checkLabel(check)}`}
          hint={
            <TooltipBlock
              subject={check.name}
              rows={[
                { label: SERVICE_TEXT.hintRows.status, value: check.status },
                ...(check.latencyMs === null
                  ? []
                  : [{ label: SERVICE_TEXT.hintRows.latency, value: `${check.latencyMs}ms` }]),
              ]}
            />
          }
          /* A dependency that failed is exactly as worth chasing as the endpoint that reported it,
             and it leads to the same place: this service's error lines around the probe. */
          href={check.status === "ok" ? null : href}
          hrefHint={SERVICE_TEXT.toProbeLogs}
        />
      ))}
      <Pill
        check="endpoint"
        tone={probe.status}
        label={`${SERVICE_TEXT.endpoint} ${probe.httpStatus ?? SERVICE_TEXT.noAnswer}`}
        hint={
          <TooltipBlock
            subject={SERVICE_TEXT.endpoint}
            context={probe.error ?? undefined}
            rows={[
              { label: SERVICE_TEXT.hintRows.probe, value: SERVICE_TEXT.probeStatus[probe.status] ?? probe.status },
              { label: SERVICE_TEXT.hintRows.checked, value: probe.checkedAt },
              { label: SERVICE_TEXT.hintRows.cadence, value: SERVICE_TEXT.probeCadence },
            ]}
          />
        }
        href={href}
        hrefHint={SERVICE_TEXT.toProbeLogs}
      />
    </div>
  );
};

/**
 * `db 1ms` while it is well, `db error` once it is not.
 *
 * A failing dependency that still answered quickly would otherwise read `db 3ms` in a red pill —
 * the number says everything is fine and only the colour says otherwise, which is the one
 * combination a reader who cannot separate red from green gets nothing from. The latency is in the
 * bubble, where it is context rather than the headline.
 */
const checkLabel = (check: ProbeCheck): string =>
  check.status !== "ok" ? check.status : check.latencyMs === null ? check.status : `${check.latencyMs}ms`;

/**
 * A dot and a word. Never the dot alone: colour is the whole of what a state pill conveys and
 * roughly one man in twelve cannot separate the red from the green, which is why `Dot` takes a
 * label and why the bubble below spells the state out in words as well.
 */
type PillProps = {
  /**
   * The check's own name — `db`, `redis` — verbatim, or `endpoint` for the probe itself, as
   * `data-check`. The label is `db 4ms` while it is well and `db error` once it is not, so the
   * label names nothing a storyboard can hold on to; this does (ZEU-78).
   */
  check: string;
  tone: "ok" | "error" | "stale";
  label: string;
  /** What the pill stands for, as `TooltipBlock` rows — a pill is several facts, not a sentence. */
  hint: ReactNode;
  href?: string | null;
  /** Where the link goes — said under the facts, and only when the pill is a link. */
  hrefHint?: string;
};

const Pill = ({ check, tone, label, hint, href, hrefHint }: PillProps) => {
  const skin = cn(
    "inline-flex flex-none items-center gap-1.5 rounded-control border px-2 py-[3px] text-row font-medium whitespace-nowrap transition-colors duration-150 ease-out",
    tone === "ok" && "border-work-border-strong bg-work-ok-bg text-work-text",
    // `work-text` rather than `work-error`: see the chip above — the ink on this tint measures
    // 3.98:1, and the dot beside it is what carries the hue.
    tone === "error" && "border-work-border-strong bg-work-error-bg text-work-text",
    tone === "stale" && "border-work-border-strong bg-work-inset text-work-warn",
  );

  const dot = (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-1.5 flex-none rounded-full transition-colors duration-150 ease-out",
        tone === "ok" && "bg-work-accent",
        tone === "error" && "bg-work-error",
        tone === "stale" && "bg-work-warn",
      )}
    />
  );

  if (!href) {
    // Focusable for the same reason as a chip: the latency and the probe's timing live only here.
    return (
      <Tooltip
        mode="hover"
        content={hint}
        className={skin}
        tabIndex={0}
        data-testid="health-pill"
        data-check={check}
      >
        {dot}
        {label}
      </Tooltip>
    );
  }

  /* Same family as the inert pill above — a member turns into an `<a>` the moment it fails, and the
     storyboard finds it under the same name either way. It navigates; it posts nothing. */
  return (
    <Tooltip
      mode="hover"
      content={
        <>
          {hint}
          <div className="mt-1 text-chassis-text-dim">{hrefHint}</div>
        </>
      }
      className="flex-none"
    >
      <Link
        href={href}
        className={cn(skin, "transition-[filter] duration-150 ease-out hover:brightness-[1.06]")}
        data-testid="health-pill"
        data-check={check}
      >
        {dot}
        {label}
      </Link>
    </Tooltip>
  );
};
