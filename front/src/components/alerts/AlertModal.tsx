"use client";

import { Button } from "@components/ui/Button";
import { Modal } from "@components/ui/Modal";
import { Pending } from "@components/ui/Pending";
import { TONE_TEXT } from "@components/ui/surface";
import { formatDuration, formatValue, openFor, SEVERITY_TONE } from "@lib/alertFormat";
import { useTimeRange } from "@lib/chassisState";
import { logsHref } from "@lib/logsHref";
import { useAlertActions, useAlertDetail, useAlertHistory } from "@lib/useAlerts";
import { cn } from "@lib/utils";
import { ALERTS_TEXT } from "@text/alerts";
import Link from "next/link";
import { StateBand } from "./StateBand";

import type { AlertRow } from "@lib/alertTypes";

/**
 * One alert in full (IKN-15 §2).
 *
 * **No `closeOnBackdropClick`.** `Modal.tsx` turned that default off for exactly these callers:
 * this pane carries three real actions, and a stray click beside the card should not be one of
 * them. Derived-open rather than `{open && <Modal/>}`, or the 200 ms exit never plays.
 *
 * The hint line carries the truth of the product — nothing is pushed anywhere, you come and look —
 * and the cadence beside it comes **from the payload**, never from a constant in this bundle. The
 * mockup says 15 s where the engine evaluates every 60 s, and that is precisely the kind of number
 * that lies for two years once it is copied.
 */
export const AlertModal = ({
  id,
  evalIntervalMs,
  onClose,
}: {
  id: number | null;
  evalIntervalMs: number | null;
  onClose: () => void;
}) => {
  const detail = useAlertDetail(id);
  const history = useAlertHistory(id);
  const act = useAlertActions();
  const [range] = useTimeRange();

  const alert = detail.data;

  return (
    <Modal
      open={id !== null}
      onClose={onClose}
      tag={ALERTS_TEXT.tag}
      title={alert?.title ?? ALERTS_TEXT.title}
      hint={
        evalIntervalMs === null
          ? ALERTS_TEXT.hint
          : `${ALERTS_TEXT.hint} ${ALERTS_TEXT.cadence(Math.round(evalIntervalMs / 1000))}`
      }
      actions={
        alert && alert.resolvedAt === null ? (
          <>
            <Button
              variant="quiet"
              onClick={() => act(alert.id, "silence")}
            >
              {ALERTS_TEXT.silence}
            </Button>
            <Button
              variant="quiet"
              onClick={() => act(alert.id, "ack")}
            >
              {ALERTS_TEXT.ack}
            </Button>
            <Button onClick={() => act(alert.id, "resolve")}>{ALERTS_TEXT.resolve}</Button>
          </>
        ) : undefined
      }
    >
      {detail.loading ? (
        <p className="text-row text-chassis-text-dim">
          <Pending>{ALERTS_TEXT.loading}</Pending>
        </p>
      ) : detail.error !== null || alert === null ? (
        <p className={cn("text-row", TONE_TEXT.chassis.error)}>{detail.error ?? ALERTS_TEXT.failed}</p>
      ) : (
        <Body
          alert={alert}
          range={range}
          band={history.data}
        />
      )}
    </Modal>
  );
};

const Body = ({
  alert,
  range,
  band,
}: {
  alert: AlertRow;
  range: Parameters<typeof logsHref>[0]["range"];
  band: { from: string; to: string; transitions: Parameters<typeof StateBand>[0]["transitions"] } | null;
}) => {
  const tone = SEVERITY_TONE[alert.severity];
  const now = Date.now();

  return (
    <div className="flex flex-col gap-3">
      {/* The expression, given the room the panel could not give it. */}
      <div>
        <p className="text-kicker tracking-kicker text-chassis-text-dim uppercase">{ALERTS_TEXT.ruleLabel}</p>
        <p className="mt-0.5 text-ui break-all text-chassis-text-bright">{alert.expr}</p>
      </div>

      <dl className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Tile label={ALERTS_TEXT.tileState}>
          <span className={TONE_TEXT.chassis[tone]}>{ALERTS_TEXT.states[alert.state]}</span>{" "}
          <span className="text-chassis-text-dim">{formatDuration(openFor(alert, now))}</span>
        </Tile>
        <Tile label={ALERTS_TEXT.tileService}>{alert.service}</Tile>
        <Tile label={ALERTS_TEXT.tileValue}>{formatValue(alert.value, alert.unit)}</Tile>
        <Tile label={ALERTS_TEXT.tileThreshold}>{formatValue(alert.threshold, alert.unit)}</Tile>
      </dl>

      <div>
        <p className="mb-1 text-kicker tracking-kicker text-chassis-text-dim uppercase">{ALERTS_TEXT.historyTitle}</p>
        {band === null ? (
          <p className="text-micro text-chassis-text-dim">
            <Pending>{ALERTS_TEXT.loading}</Pending>
          </p>
        ) : (
          <StateBand
            transitions={band.transitions}
            from={band.from}
            to={band.to}
          />
        )}
      </div>

      {/*
       * The link out — what was happening when this fired.
       *
       * Bounded around the alert's own window rather than carrying the reader's range, because the
       * question is about *then*: the log API refuses an unbounded query (IKN-19), and an alert
       * that opened four hours ago is not answered by the last fifteen minutes.
       */}
      <Link
        href={logsHref({
          range,
          values: { service: alert.service, level: "error" },
          bounds: {
            from: new Date(Date.parse(alert.firedAt ?? alert.openedAt) - 5 * 60_000).toISOString(),
            to: new Date(Date.parse(alert.resolvedAt ?? alert.lastSeenAt) + 5 * 60_000).toISOString(),
          },
        })}
        className="text-row text-chassis-text-muted underline underline-offset-2 transition-colors duration-150 ease-out hover:text-chassis-text-bright"
      >
        {ALERTS_TEXT.openLogs}
      </Link>
    </div>
  );
};

const Tile = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="min-w-0 rounded-chip border border-chassis-border bg-chassis-inset px-2 py-1.5">
    <dt className="text-kicker tracking-kicker text-chassis-text-dim uppercase">{label}</dt>
    <dd className="truncate text-row text-chassis-text-bright">{children}</dd>
  </div>
);
