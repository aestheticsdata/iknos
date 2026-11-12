"use client";

import { readApiError } from "@lib/api";
import { mutateWithCsrf } from "@lib/csrf";
import { boundsFor } from "@lib/timeRange";
import { TRACES_TEXT } from "@text/traces";
import { useState } from "react";

import type {
  CreateTicketRequest,
  FailurePattern,
  FailureTicket,
  TicketContext,
  Ticketing,
} from "@lib/interfaces/aiRunTypes";

/**
 * A failure pattern's Spira ticket (IKN-96): the issue and its state as Spira says it now, or the
 * button that files it in the service's project. When filing is not possible the button stays,
 * disabled, and says why in its title — the column never looks broken.
 */
export const TicketCell = ({ pattern, ticketing, context }: TicketCellProps) => {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ticket = pattern.ticket;

  if (ticket !== null) {
    return (
      <span className="inline-flex items-center gap-2">
        <a
          href={ticket.url}
          target="_blank"
          rel="noreferrer"
          title={TRACES_TEXT.openTicket(ticket.issue)}
          className="font-medium text-work-text underline-offset-2 transition-colors duration-150 ease-out hover:text-work-accent hover:underline"
          data-testid="failure-ticket"
        >
          {ticket.issue}
        </a>
        <span className="text-micro text-work-text-dim">{ticket.state ?? TRACES_TEXT.ticketStateUnknown}</span>
      </span>
    );
  }

  const create = async () => {
    setCreating(true);
    setError(null);
    const bounds = boundsFor(context.range);
    const request: CreateTicketRequest = {
      service: context.service,
      gate: pattern.gate,
      gateLabel: pattern.gateLabel,
      step: pattern.step,
      failures: pattern.failures,
      previous: pattern.previous,
      from: bounds.from,
      to: bounds.to,
    };
    try {
      await mutateWithCsrf<FailureTicket>("/traces/quality/tickets", { data: request });
      context.onCreated();
    } catch (failure) {
      setError(readApiError(failure, TRACES_TEXT.ticketFailed));
    } finally {
      setCreating(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={ticketing.blocked !== null || creating}
        title={ticketing.blocked === null ? undefined : TRACES_TEXT.ticketBlocked[ticketing.blocked]}
        onClick={() => void create()}
        className="h-6 rounded-control border border-work-border-strong px-2 text-label text-work-text transition-[background-color,opacity] duration-150 ease-out hover:bg-work-inset disabled:opacity-50"
        data-testid="create-ticket"
      >
        {creating ? TRACES_TEXT.creatingTicket : `+ ${TRACES_TEXT.createTicket}`}
      </button>
      {error !== null && <span className="text-micro text-work-error">{error}</span>}
    </span>
  );
};

type TicketCellProps = {
  pattern: FailurePattern;
  ticketing: Ticketing;
  context: TicketContext;
};
