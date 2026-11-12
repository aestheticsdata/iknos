import { TicketCell } from "@components/traces/quality/TicketCell";
import { TICKETING_BLOCK } from "@lib/interfaces/aiRunTypes";
import { joinedMessages } from "@lib/runInsights";
import { numberedCalls } from "@lib/testSetFormat";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FailurePattern, TicketContext } from "@lib/interfaces/aiRunTypes";

const PATTERN: FailurePattern = {
  step: "spec",
  gate: "spec-testable",
  gateLabel: "Testable criteria",
  failures: 55,
  previous: 11,
  ticket: null,
};

const CONTEXT: TicketContext = { service: "opifex-front", range: "7d", onCreated: () => undefined };

describe("TicketCell (IKN-96)", () => {
  it("links a filed ticket and prints its state", () => {
    const html = renderToStaticMarkup(
      h(TicketCell, {
        pattern: { ...PATTERN, ticket: { issue: "OPI-42", state: "Todo", url: "https://spira.test/issue/OPI-42" } },
        ticketing: { project: "OPI", blocked: null },
        context: CONTEXT,
      }),
    );
    expect(html).toContain('href="https://spira.test/issue/OPI-42"');
    expect(html).toContain(">Todo<");
  });

  it("says the state is unknown when Spira could not be asked", () => {
    const html = renderToStaticMarkup(
      h(TicketCell, {
        pattern: { ...PATTERN, ticket: { issue: "OPI-42", state: null, url: "u" } },
        ticketing: { project: "OPI", blocked: TICKETING_BLOCK.notConfigured },
        context: CONTEXT,
      }),
    );
    expect(html).toContain("state unknown");
  });

  it("keeps the button, disabled, and says why it cannot file", () => {
    const html = renderToStaticMarkup(
      h(TicketCell, {
        pattern: PATTERN,
        ticketing: { project: null, blocked: TICKETING_BLOCK.noProject },
        context: CONTEXT,
      }),
    );
    expect(html).toMatch(
      /disabled=""[^>]*title="This service has no Spira project."|title="This service has no Spira project."[^>]*disabled=""/,
    );
    expect(html).toContain("create the ticket");
  });
});

describe("kept calls (IKN-95)", () => {
  it("joins system and input into one list, numbered afresh", () => {
    const system = [{ type: "text", content: "be brief" }];
    const input = [{ role: "user", parts: [{ type: "text", content: "go" }] }];
    expect(joinedMessages(system, input)).toEqual([
      { position: 0, role: "", text: "be brief" },
      { position: 1, role: "user", text: "go" },
    ]);
  });

  it("numbers a run's calls by their place", () => {
    const call = { step: "spec", promptVersion: 14, model: "m", system: null, input: null, output: null };
    expect(numberedCalls([call, call]).map((c) => c.position)).toEqual([0, 1]);
  });
});
