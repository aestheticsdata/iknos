import type { CreateTicketRequest } from "@contracts/ai-runs";

/**
 * The Spira issue a failure pattern becomes (IKN-96), pure. English and technical, like every
 * ticket in the workspace: the title names the gate and the service, the body the counts and
 * where to look.
 */

/** Spira titles stay on one line in its lists; past this they are cut by the API anyway. */
const MAX_TITLE = 200;

export function ticketTitle(request: CreateTicketRequest): string {
  return `AI quality — ${request.gateLabel} gate fails on ${request.service}`.slice(0, MAX_TITLE);
}

const day = (iso: string): string => iso.slice(0, 10);

export function ticketDescription(request: CreateTicketRequest): string {
  const trend =
    request.previous === null
      ? "No run in the window before, so no trend."
      : `${request.previous} in the window of the same length before.`;
  return [
    `Filed from Iknos → ai quality, ${request.service}.`,
    "",
    `- Gate: \`${request.gate}\` (${request.gateLabel})`,
    `- Step it loops back to: ${request.step === null ? "none recorded" : `\`${request.step}\``}`,
    `- Failed verdicts from ${day(request.from)} to ${day(request.to)}: ${request.failures}. ${trend}`,
    "",
    "The failing runs are in Iknos's ai runs, filtered on this service with checks failed; a run traced at the full level shows each broken rule in its own words.",
  ].join("\n");
}
