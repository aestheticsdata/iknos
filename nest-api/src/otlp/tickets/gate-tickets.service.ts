import { parseEnv } from "@config/env.validation";
import { TICKETING_BLOCK } from "@contracts/ai-runs";
import { PrismaService } from "@db/prisma.service";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { SpiraClient } from "./spira-client";
import { ticketDescription, ticketTitle } from "./ticket-text";

import type { CreateTicketRequest, FailurePattern, FailureTicket, Ticketing } from "@contracts/ai-runs";

/**
 * The AI failure patterns' Spira tickets (IKN-96): which gate has one, what state it is in, and
 * filing a new one.
 *
 * The link is ours (`gate_ticket`); the state is Spira's and read back on every load, never
 * stored — a ticket closed in Spira is closed here on the next poll. Without a token, links still
 * show (their state unknown) and nothing can be filed: a laptop must not open real tickets.
 */
@Injectable()
export class GateTicketsService {
  private readonly spira: SpiraClient | null;
  private readonly spiraUrl: string;

  constructor(private readonly prisma: PrismaService) {
    const config = parseEnv({ ...process.env });
    this.spiraUrl = config.spiraUrl;
    this.spira =
      config.spiraToken === null ? null : new SpiraClient({ url: config.spiraUrl, token: config.spiraToken });
  }

  async ticketing(service: string): Promise<Ticketing> {
    const row = await this.prisma.service.findUnique({ where: { name: service }, select: { spiraProject: true } });
    const project = row?.spiraProject ?? null;
    if (this.spira === null) return { project, blocked: TICKETING_BLOCK.notConfigured };
    return { project, blocked: project === null ? TICKETING_BLOCK.noProject : null };
  }

  /** The patterns with their tickets, each ticket's state asked of Spira in parallel. */
  async attach(service: string, patterns: FailurePattern[]): Promise<FailurePattern[]> {
    const links = await this.prisma.gateTicket.findMany({ where: { service } });
    const byGate = new Map(links.map((link) => [link.gate, link.issue]));
    return Promise.all(
      patterns.map(async (pattern) => {
        const issue = byGate.get(pattern.gate);
        return issue === undefined ? pattern : { ...pattern, ticket: await this.ticketOf(issue) };
      }),
    );
  }

  /** Files the pattern, or returns the ticket it already has — one gate, one ticket. */
  async create(request: CreateTicketRequest): Promise<FailureTicket> {
    const existing = await this.prisma.gateTicket.findUnique({
      where: { service_gate: { service: request.service, gate: request.gate } },
    });
    if (existing) return this.ticketOf(existing.issue);

    const ticketing = await this.ticketing(request.service);
    if (this.spira === null || ticketing.project === null) {
      throw new ServiceUnavailableException(
        ticketing.blocked === TICKETING_BLOCK.notConfigured
          ? "Spira is not configured on this server (IKNOS_SPIRA_TOKEN)"
          : `no Spira project is set for ${request.service}`,
      );
    }

    const issue = await this.spira.create({
      projectKey: ticketing.project,
      title: ticketTitle(request),
      description: ticketDescription(request),
    });
    await this.prisma.gateTicket.create({
      data: { service: request.service, gate: request.gate, step: request.step, issue: issue.identifier },
    });
    return { issue: issue.identifier, state: issue.state?.name ?? null, url: this.urlOf(issue.identifier) };
  }

  private urlOf(issue: string): string {
    return this.spira?.issueUrl(issue) ?? `${this.spiraUrl}/issue/${encodeURIComponent(issue)}`;
  }

  private async ticketOf(issue: string): Promise<FailureTicket> {
    let state: string | null = null;
    if (this.spira !== null) {
      try {
        state = (await this.spira.get(issue)).state?.name ?? null;
      } catch {
        // Spira down or the issue deleted: the link stays, its state is unknown.
      }
    }
    return { issue, state, url: this.urlOf(issue) };
  }
}
