import { describe, expect, it } from "vitest";
import { NginxSource } from "./nginx-source";

import type { PrismaService } from "@db/prisma.service";

/** Only the one call `NginxSource` makes. Enough to be the client, nothing more. */
const prismaWith = (rows: { name: string; logGlob: string | null }[]) =>
  ({ service: { findMany: async () => rows } }) as unknown as PrismaService;

describe("NginxSource", () => {
  it("turns registry rows into files, attributed to their service", async () => {
    const source = new NginxSource(
      prismaWith([
        { name: "landing-page", logGlob: "/var/log/nginx/1991computer.access.log" },
        { name: "iknos-front", logGlob: "/var/log/nginx/iknos.access.log" },
      ]),
    );

    expect(await source.files()).toEqual([
      { file: "/var/log/nginx/1991computer.access.log", service: "landing-page", stream: "out" },
      { file: "/var/log/nginx/iknos.access.log", service: "iknos-front", stream: "out" },
    ]);
  });

  it("is empty when no row declares a log", async () => {
    // The state on the day this ships and before the landing page's row is seeded. An empty list
    // is a working configuration, not a failure.
    expect(await new NginxSource(prismaWith([])).files()).toEqual([]);
  });

  it("parses through the combined parser", () => {
    const source = new NginxSource(prismaWith([]));
    // Two arguments, not three: `parse` omits `stream` entirely — see the implementation's note.
    const r = source.parse(
      '203.0.113.5 - - [16/Sep/2026:14:02:31 +0200] "GET / HTTP/2.0" 200 12 "-" "-"',
      "landing-page",
    );

    expect(r?.clientIp).toBe("203.0.113.5");
    expect(r?.logger).toBe("nginx.access");
  });
});
