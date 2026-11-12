import { describe, expect, it } from "vitest";
import { ticketDescription, ticketTitle } from "./ticket-text";

import type { CreateTicketRequest } from "@contracts/ai-runs";

const request: CreateTicketRequest = {
  service: "opifex-front",
  gate: "spec-testable",
  gateLabel: "Testable criteria",
  step: "spec",
  failures: 55,
  previous: 11,
  from: "2026-11-05T12:00:00.000Z",
  to: "2026-11-12T12:00:00.000Z",
};

describe("ticket text", () => {
  it("names the gate and the service in the title", () => {
    expect(ticketTitle(request)).toBe("AI quality — Testable criteria gate fails on opifex-front");
  });

  it("states the gate, its step and the counts against the window before", () => {
    const body = ticketDescription(request);
    expect(body).toContain("`spec-testable`");
    expect(body).toContain("`spec`");
    expect(body).toContain("from 2026-11-05 to 2026-11-12: 55. 11 in the window");
  });

  it("says so when there is no step or no window before", () => {
    const body = ticketDescription({ ...request, step: null, previous: null });
    expect(body).toContain("none recorded");
    expect(body).toContain("no trend");
  });
});
