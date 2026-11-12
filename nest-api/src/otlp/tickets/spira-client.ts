import type { SpiraConfig, SpiraIssue, SpiraIssueDraft } from "../interfaces/ticket-types";

/**
 * Spira's REST API, the way its own MCP connector reaches it (IKN-96): the routes the browser uses,
 * with a bearer token instead of a session cookie. Never the database — identifiers, states and
 * project rules live behind these routes.
 *
 * Two calls only: file an issue, and read one back for its state. A slow Spira must not hold the
 * quality screen, so every call is bounded.
 */

/** Long enough for Spira on the same box, short enough not to stall a screen when it is down. */
const TIMEOUT_MS = 4000;

export class SpiraError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SpiraError";
  }
}

export class SpiraClient {
  constructor(private readonly config: SpiraConfig) {}

  /** The issue's page in Spira's web app. */
  issueUrl(identifier: string): string {
    return `${this.config.url}/issue/${encodeURIComponent(identifier)}`;
  }

  create(draft: SpiraIssueDraft): Promise<SpiraIssue> {
    return this.send<SpiraIssue>("/issues", { method: "POST", body: JSON.stringify(draft) });
  }

  get(identifier: string): Promise<SpiraIssue> {
    return this.send<SpiraIssue>(`/issues/${encodeURIComponent(identifier)}`, { method: "GET" });
  }

  private async send<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.config.url}/api${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.config.token}`,
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new SpiraError(
        response.status,
        `Spira answered ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      );
    }
    return (await response.json()) as T;
  }
}
