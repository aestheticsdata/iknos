"use client";

import { Badge } from "@components/ui/Badge";
import { Button } from "@components/ui/Button";
import { Card } from "@components/ui/Card";
import { Chip } from "@components/ui/Chip";
import { DenseTable } from "@components/ui/DenseTable";
import { Dot } from "@components/ui/Dot";
import { Field } from "@components/ui/Field";
import { Modal } from "@components/ui/Modal";
import { useState } from "react";

import type { Surface, Tone } from "@components/ui/surface";

/**
 * The internal primitive gallery — the checklist's "page de démo interne", rendering every
 * primitive **on both surfaces at once**.
 *
 * Side by side rather than behind a toggle, deliberately: the two ramps exist because both grounds
 * are on screen together, and a toggle would let a colour that only works on one of them ship
 * looking fine. Not in the rail's view list — it is a workshop, not a view.
 */

const TONES: Tone[] = ["ok", "warn", "error", "info", "neutral"];

type Row = { id: string; service: string; level: Tone; route: string; ms: number };

const ROWS: Row[] = [
  { id: "1", service: "iknos-api", level: "info", route: "/api/logs", ms: 38 },
  { id: "2", service: "iknos-api", level: "warn", route: "/api/logs/histogram", ms: 412 },
  { id: "3", service: "pfa-api", level: "error", route: "/api/users/42", ms: 1204 },
];

export default function DesignPage() {
  const [open, setOpen] = useState(false);

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      <SurfacePanel surface="work" />
      <SurfacePanel surface="chassis" />

      <div className="lg:col-span-2">
        <Button onClick={() => setOpen(true)}>Open the modal</Button>
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
    </div>
  </div>
);
