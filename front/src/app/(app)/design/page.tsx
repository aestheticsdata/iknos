"use client";

import { AreaSpark } from "@components/ui/AreaSpark";
import { Badge } from "@components/ui/Badge";
import { BarSpark } from "@components/ui/BarSpark";
import { Button } from "@components/ui/Button";
import { Card } from "@components/ui/Card";
import { Chip } from "@components/ui/Chip";
import { DenseTable } from "@components/ui/DenseTable";
import { Dot } from "@components/ui/Dot";
import { Field } from "@components/ui/Field";
import { MeterBar } from "@components/ui/MeterBar";
import { Modal } from "@components/ui/Modal";
import { Pending } from "@components/ui/Pending";
import { Select } from "@components/ui/Select";
import { Sparkline } from "@components/ui/Sparkline";
import { Spinner } from "@components/ui/Spinner";
import { SURFACE_SCROLL, SURFACE_TEXT_MUTED } from "@components/ui/surface";
import { useToast } from "@components/ui/Toast";
import { Tooltip, TooltipBlock } from "@components/ui/Tooltip";
import { cn } from "@lib/utils";
import { useState } from "react";

import type { Surface, Tone } from "@components/ui/surface";

/**
 * The internal primitive gallery — the checklist's internal demo page, rendering every primitive
 * **on both surfaces at once**.
 *
 * Side by side rather than behind a toggle, deliberately: the two ramps exist because both grounds
 * are on screen together, and a toggle would let a colour that only works on one of them ship
 * looking fine. Not in the rail's view list — it is a workshop, not a view.
 */

const TONES: Tone[] = ["ok", "warn", "error", "info", "neutral"];

type Row = { id: string; service: string; level: Tone; route: string; ms: number };

/** A plausible ingest curve — twenty points, the width the rail draws. */
const SERIES = [4, 6, 5, 9, 12, 8, 7, 11, 18, 24, 19, 13, 9, 7, 8, 6, 5, 9, 14, 11];

/**
 * The same curve with an interval nobody scraped in the middle of it — the case the whole dataviz
 * set exists to render honestly. A `null` is a hole, and a hole is not a zero.
 */
const GAPPED = [4, 6, 5, 9, 12, null, null, 11, 18, 24, 19, 13, 9, 7, 8, 6, 5, 9, 14, 11];

/**
 * Three states in one series: values, a **measured zero** (dimmed stub on the baseline), and an
 * interval that could not be quoted (nothing at all). Collapsing the last two is how "the collector
 * was down" becomes "no errors".
 */
const BARS = [0, 0, 0.4, 0, null, null, 1.8, 2.4, 0.9, 0, 0, 0];

/**
 * The demo axis for the charts below — the bubbles need something honest to name, and a gallery has
 * no server to be told one by. Minute `n` of a made-up hour, which is exactly what the real call
 * sites do with a real one: the chart is handed the numbers and the *caller* supplies the words.
 */
const demoTip = (values: (number | null)[], unit: string) => (index: number) =>
  values[index] === undefined ? null : (
    <TooltipBlock
      subject={`minute ${index + 1}`}
      rows={[{ label: unit, value: values[index] === null ? "—" : String(values[index]) }]}
    />
  );

/** Enough lines to overflow the box below and give the bar something to do. */
const SCROLL_LINES = Array.from(
  { length: 14 },
  (_, index) => `line ${String(index + 1).padStart(2, "0")} · the thumb is the surface's own border ink`,
);

const ROWS: Row[] = [
  { id: "1", service: "iknos-api", level: "info", route: "/api/logs", ms: 38 },
  { id: "2", service: "iknos-api", level: "warn", route: "/api/logs/histogram", ms: 412 },
  { id: "3", service: "pfa-api", level: "error", route: "/api/users/42", ms: 1204 },
];

const ToastTrigger = () => {
  const { show } = useToast();
  return (
    <>
      <Button
        variant="quiet"
        onClick={() => show("Copied the row as NDJSON.")}
      >
        Raise a toast
      </Button>
      <Button
        variant="quiet"
        onClick={() => show("Could not reach the API.", "error")}
      >
        Raise an error toast
      </Button>
    </>
  );
};

export default function DesignPage() {
  const [open, setOpen] = useState(false);

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      <SurfacePanel surface="work" />
      <SurfacePanel surface="chassis" />

      <div className="flex items-center gap-2 lg:col-span-2">
        <Button onClick={() => setOpen(true)}>Open the modal</Button>
        <ToastTrigger />
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          tag="issue"
          title="TypeError: cannot read properties of undefined"
          hint="⏎ open the trace · esc close"
          actions={
            <>
              <Button
                variant="quiet"
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
              <Button onClick={() => setOpen(false)}>Acknowledge</Button>
            </>
          }
        >
          <p className="text-chassis-text-muted">
            The modal chassis is always the dark surface, on every screen — elevation is reserved for what overhangs.
          </p>
        </Modal>
      </div>
    </div>
  );
}

const SurfacePanel = ({ surface }: { surface: Surface }) => (
  <div className={surface === "chassis" ? "rounded-card bg-chassis-deep p-3" : "rounded-card bg-work-inset p-3"}>
    <div className="flex flex-col gap-3">
      <Card
        surface={surface}
        title="Primitives"
        kicker={surface}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {TONES.map((tone) => (
              <Badge
                key={tone}
                tone={tone}
                surface={surface}
              >
                {tone}
              </Badge>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {TONES.map((tone) => (
              <span
                key={tone}
                className="flex items-center gap-1.5"
              >
                <Dot
                  tone={tone}
                  surface={surface}
                  label={tone}
                />
                <span className={surface === "chassis" ? "text-row text-chassis-text" : "text-row text-work-text"}>
                  {tone}
                </span>
              </span>
            ))}
          </div>

          {/* The pending mark — IKN-57. It is here because it is the only motion-carrying affordance
              in the app and the only one that cannot otherwise be looked at: seeing it anywhere else
              means inducing a fetch and catching it before the answer lands. It has no surface
              variant, so it paints in whichever ink this panel already sets. */}
          <div className="flex flex-wrap items-center gap-3">
            <span className={surface === "chassis" ? "text-row text-chassis-text-dim" : "text-row text-work-text-dim"}>
              <Pending>reading</Pending>
            </span>
            <span className={surface === "chassis" ? "text-row text-chassis-text-dim" : "text-row text-work-text-dim"}>
              <Pending />
            </span>
            {/* The tile-scale half of the same state — always beside the mark in the app, so beside
                it here. */}
            <span className={surface === "chassis" ? "text-chassis-text-dim" : "text-work-text-dim"}>
              <Spinner />
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Chip
              surface={surface}
              label="service"
              value="iknos-api"
              onRemove={() => {}}
            />
            <Chip
              surface={surface}
              label="level"
              value="≥warn"
              onRemove={() => {}}
            />
            <Chip
              surface={surface}
              label="route"
              value="/api/logs"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              surface={surface}
              label="query"
              placeholder="trace id or substring"
              hint="Bounded by the range."
            />
            <Field
              surface={surface}
              label="email"
              defaultValue="not-an-email"
              error="Enter a valid address."
            />
            <Select
              surface={surface}
              label="level"
              defaultValue="warn"
              options={[
                { value: "info", label: "info and above" },
                { value: "warn", label: "warn and above" },
                { value: "error", label: "error only" },
              ]}
            />
            <div className="flex items-end gap-3">
              {/* The two modes side by side: this one wraps a trigger and explains the whole chart,
                  and the three below let each mark speak for itself. */}
              <Tooltip
                mode="hover"
                content="Events per minute, last 20 minutes"
              >
                <Sparkline
                  values={SERIES}
                  surface={surface}
                  tone="ok"
                  label="Ingest rate, last 20 minutes"
                />
              </Tooltip>
              {/* The empty series renders nothing at all — the rule the service rail depends on. */}
              <Sparkline
                values={[]}
                surface={surface}
                label="No series yet"
              />
              {/* A hole in the middle stays a hole: two polylines, not one line walking across it. */}
              <Sparkline
                values={GAPPED}
                surface={surface}
                tone="warn"
                reference={12}
                label="A series with a gap, against a reference"
                tip={demoTip(GAPPED, "lines/min")}
              />
            </div>

            {/* The three dataviz primitives the signal tiles are built from — IKN-13. */}
            <div className="grid grid-cols-3 items-end gap-3">
              <span className="h-[26px]">
                <AreaSpark
                  values={GAPPED}
                  surface={surface}
                  tone="ok"
                  label="Throughput, with an interval nobody scraped"
                  tip={demoTip(GAPPED, "req/s")}
                />
              </span>
              <span className="h-[26px]">
                <BarSpark
                  values={BARS}
                  surface={surface}
                  tone="error"
                  max={1}
                  label="Error rate, with a measured zero and an unscraped interval"
                  tip={demoTip(BARS, "%")}
                />
              </span>
              <span className="flex items-center gap-1.5 text-micro">
                <MeterBar
                  share={0.3}
                  surface={surface}
                  tone="ok"
                />
                <MeterBar
                  share={1}
                  surface={surface}
                  tone="error"
                />
              </span>
            </div>
          </div>
        </div>
      </Card>

      <Card
        surface={surface}
        title="Dense table"
        kicker="rows"
      >
        <DenseTable
          surface={surface}
          rows={ROWS}
          rowKey={(row) => row.id}
          columns={[
            { key: "service", header: "service", render: (row) => row.service },
            {
              key: "level",
              header: "level",
              render: (row) => (
                <Badge
                  tone={row.level}
                  surface={surface}
                >
                  {row.level}
                </Badge>
              ),
            },
            { key: "route", header: "route", render: (row) => row.route },
            { key: "ms", header: "ms", numeric: true, render: (row) => row.ms },
          ]}
        />
      </Card>

      {/*
       * The scrollbar is the one primitive you cannot see in a screenshot of a box that fits, so
       * the box here is deliberately too short for its content. Both surfaces are on the page at
       * once for the usual reason: the thumb is the surface's own border ink, and the pair is only
       * judgeable side by side.
       */}
      <Card
        surface={surface}
        title="Scrollbar"
        kicker="3px"
      >
        <div className={cn(SURFACE_SCROLL[surface], "h-24 overflow-y-auto")}>
          {SCROLL_LINES.map((line) => (
            <p
              key={line}
              className={cn("py-0.5 text-row", SURFACE_TEXT_MUTED[surface])}
            >
              {line}
            </p>
          ))}
        </div>
      </Card>
    </div>
  </div>
);
