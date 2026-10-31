import { describe, expect, it } from "vitest";
import { NginxSource, SHARED_SERVICE } from "./nginx-source";

import type { PrismaService } from "@db/prisma.service";

/** Only the one call `NginxSource` makes. Enough to be the client, nothing more. */
type Row = { name: string; logGlob: string | null; hosts?: string | null };

const prismaWith = (rows: Row[]) => ({ service: { findMany: async () => rows } }) as unknown as PrismaService;

const SHARED = "/var/log/nginx/access.log";
const PFA_LINE =
  '203.0.113.5 - - [31/Oct/2026:20:14:24 +0000] "GET /budget HTTP/2.0" 200 12 "-" "Mozilla/5.0" "-" "pfa.1991computer.com"';

describe("NginxSource", () => {
  it("turns registry rows into files, attributed to their service", async () => {
    const source = new NginxSource(
      prismaWith([
        { name: "landing-page", logGlob: "/var/log/nginx/1991computer.access.log" },
        { name: "iknos-front", logGlob: "/var/log/nginx/iknos.access.log" },
      ]),
      SHARED,
    );

    expect(await source.files()).toEqual([
      { file: "/var/log/nginx/1991computer.access.log", service: "landing-page", stream: "out" },
      { file: "/var/log/nginx/iknos.access.log", service: "iknos-front", stream: "out" },
    ]);
  });

  it("is empty when no row declares a log", async () => {
    // The state on the day this ships and before the landing page's row is seeded. An empty list
    // is a working configuration, not a failure.
    expect(await new NginxSource(prismaWith([]), SHARED).files()).toEqual([]);
  });

  it("parses through the combined parser", () => {
    const source = new NginxSource(prismaWith([]), SHARED);
    // Two arguments, not three: `parse` omits `stream` entirely — see the implementation's note.
    const r = source.parse(
      '203.0.113.5 - - [16/Sep/2026:14:02:31 +0200] "GET / HTTP/2.0" 200 12 "-" "-"',
      "landing-page",
    );

    expect(r?.clientIp).toBe("203.0.113.5");
    expect(r?.logger).toBe("nginx.access");
  });

  describe("the shared access log (IKN-84)", () => {
    const rows: Row[] = [
      { name: "pfa-front", logGlob: null, hosts: "pfa.1991computer.com" },
      { name: "worldweathr-front", logGlob: null, hosts: "worldweathr.com  www.worldweathr.com" },
      { name: "fiducia-front", logGlob: "/var/log/nginx/fiducia.access.log", hosts: null },
    ];

    it("adds the shared file once, after the sites' own files, when a row names a host", async () => {
      expect(await new NginxSource(prismaWith(rows), SHARED).files()).toEqual([
        { file: "/var/log/nginx/fiducia.access.log", service: "fiducia-front", stream: "out" },
        { file: SHARED, service: SHARED_SERVICE, stream: "out" },
      ]);
    });

    it("leaves the shared file alone when no row names a host, or when it is switched off", async () => {
      expect(await new NginxSource(prismaWith([rows[2]]), SHARED).files()).toHaveLength(1);
      expect(await new NginxSource(prismaWith(rows), null).files()).toHaveLength(1);
    });

    it("attributes each shared line to the site whose host it carries", async () => {
      const source = new NginxSource(prismaWith(rows), SHARED);
      await source.files();

      expect(source.parse(PFA_LINE, SHARED_SERVICE)?.service).toBe("pfa-front");
      const www = PFA_LINE.replace("pfa.1991computer.com", "www.worldweathr.com");
      expect(source.parse(www, SHARED_SERVICE)?.service).toBe("worldweathr-front");
    });

    it("drops a line whose host no row claims, or that carries none", async () => {
      const source = new NginxSource(prismaWith(rows), SHARED);
      await source.files();

      expect(source.parse(PFA_LINE.replace("pfa.1991computer.com", "unknown.example"), SHARED_SERVICE)).toBeNull();
      expect(source.parse(PFA_LINE.replace(' "pfa.1991computer.com"', ""), SHARED_SERVICE)).toBeNull();
      // A line the pattern cannot read has no site to be filed under, so it is not kept as degraded.
      expect(source.parse('garbage "pfa.1991computer.com"', SHARED_SERVICE)).toBeNull();
    });
  });
});
