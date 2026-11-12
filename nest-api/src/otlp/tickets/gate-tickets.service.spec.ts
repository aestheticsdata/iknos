import { TICKETING_BLOCK } from "@contracts/ai-runs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GateTicketsService } from "./gate-tickets.service";

import type { FailurePattern } from "@contracts/ai-runs";
import type { PrismaService } from "@db/prisma.service";

/** The two tables the service touches, in memory. */
function fakePrisma(project: string | null) {
  const links: Array<{ service: string; gate: string; step: string | null; issue: string }> = [];
  return {
    links,
    prisma: {
      service: { findUnique: async () => ({ spiraProject: project }) },
      gateTicket: {
        findMany: async ({ where }: { where: { service: string } }) => links.filter((l) => l.service === where.service),
        findUnique: async ({ where }: { where: { service_gate: { service: string; gate: string } } }) =>
          links.find((l) => l.service === where.service_gate.service && l.gate === where.service_gate.gate) ?? null,
        create: async ({ data }: { data: (typeof links)[number] }) => {
          links.push(data);
          return data;
        },
      },
    } as unknown as PrismaService,
  };
}

const PATTERN: FailurePattern = {
  step: "spec",
  gate: "spec-testable",
  gateLabel: "Testable criteria",
  failures: 5,
  previous: 1,
  ticket: null,
};

const REQUEST = {
  service: "opifex-front",
  gate: "spec-testable",
  gateLabel: "Testable criteria",
  step: "spec",
  failures: 5,
  previous: 1,
  from: "2026-11-05T00:00:00.000Z",
  to: "2026-11-12T00:00:00.000Z",
};

const BASE_ENV = { ...process.env };

describe("GateTicketsService", () => {
  beforeEach(() => {
    process.env.IKNOS_SPIRA_URL = "https://spira.test";
  });
  afterEach(() => {
    process.env = { ...BASE_ENV };
    vi.unstubAllGlobals();
  });

  it("offers nothing to create without a token, and says why", async () => {
    delete process.env.IKNOS_SPIRA_TOKEN;
    const { prisma } = fakePrisma("OPI");
    const service = new GateTicketsService(prisma);

    expect(await service.ticketing("opifex-front")).toEqual({ project: "OPI", blocked: TICKETING_BLOCK.notConfigured });
    await expect(service.create(REQUEST)).rejects.toThrow(/not configured/);
  });

  it("files the pattern in the service's project once, and reads its state back", async () => {
    process.env.IKNOS_SPIRA_TOKEN = "spira_test_token_0123456789";
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ identifier: "OPI-42", state: { name: "Todo" } }), { status: 200 });
    });
    const { prisma, links } = fakePrisma("OPI");
    const service = new GateTicketsService(prisma);

    const ticket = await service.create(REQUEST);
    expect(ticket).toEqual({ issue: "OPI-42", state: "Todo", url: "https://spira.test/issue/OPI-42" });
    expect(calls[0].url).toBe("https://spira.test/api/issues");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ projectKey: "OPI" });
    expect(links).toHaveLength(1);

    await service.create(REQUEST);
    expect(links).toHaveLength(1);

    const [attached] = await service.attach("opifex-front", [PATTERN]);
    expect(attached.ticket?.issue).toBe("OPI-42");
  });

  it("keeps a link whose state Spira cannot give", async () => {
    process.env.IKNOS_SPIRA_TOKEN = "spira_test_token_0123456789";
    vi.stubGlobal("fetch", async () => new Response("down", { status: 502 }));
    const { prisma, links } = fakePrisma("OPI");
    links.push({ service: "opifex-front", gate: "spec-testable", step: "spec", issue: "OPI-7" });

    const [attached] = await new GateTicketsService(prisma).attach("opifex-front", [PATTERN]);
    expect(attached.ticket).toEqual({ issue: "OPI-7", state: null, url: "https://spira.test/issue/OPI-7" });
  });

  it("blocks a service with no project", async () => {
    process.env.IKNOS_SPIRA_TOKEN = "spira_test_token_0123456789";
    const { prisma } = fakePrisma(null);
    expect((await new GateTicketsService(prisma).ticketing("fathom-front")).blocked).toBe(TICKETING_BLOCK.noProject);
  });
});
