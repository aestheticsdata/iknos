import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AllExceptionsFilter } from "./all-exceptions.filter";

function mockHost() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return {
    host: {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: "/api/logs", method: "GET" }),
      }),
    },
    status,
    json,
  };
}

describe("AllExceptionsFilter", () => {
  // This is the spec's "errors never leak internal detail" constraint made executable. It fails
  // loudly the day someone puts the exception message in the response body while debugging.
  it("never leaks internal detail from an unknown error", () => {
    const { host, status, json } = mockHost();
    const logger = { error: vi.fn() };

    new AllExceptionsFilter(logger as never).catch(new Error("Table 'iknos.secret' doesn't exist"), host as never);

    expect(status).toHaveBeenCalledWith(500);
    const body = JSON.stringify(json.mock.calls[0][0]);
    expect(body).not.toContain("secret");
    expect(body).toContain("internal error");
    // The detail must still reach the logs, or the outage is undebuggable.
    expect(logger.error).toHaveBeenCalled();
  });

  it("keeps the message of a deliberate client error", () => {
    const { host, status, json } = mockHost();

    new AllExceptionsFilter({ error: vi.fn() } as never).catch(
      new BadRequestException("both 'from' and 'to' are required"),
      host as never,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(JSON.stringify(json.mock.calls[0][0])).toContain("from");
  });

  it("leaks nothing through a file path or a hostname either", () => {
    const { host, json } = mockHost();

    new AllExceptionsFilter({ error: vi.fn() } as never).catch(
      new Error("ENOENT: /var/www/iknos/shared/.env on ks-b"),
      host as never,
    );

    const body = JSON.stringify(json.mock.calls[0][0]);
    expect(body).not.toContain("/var/www");
    expect(body).not.toContain("ks-b");
  });

  it("does not log a deliberate client error as an unhandled exception", () => {
    const { host } = mockHost();
    const logger = { error: vi.fn() };

    new AllExceptionsFilter(logger as never).catch(new BadRequestException("bad range"), host as never);

    // A 400 is the API working. Logging it at error level buries the 500s that matter.
    expect(logger.error).not.toHaveBeenCalled();
  });
});
