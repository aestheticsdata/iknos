import { describe, expect, it } from "vitest";
import { boundsAtJump, boundsFor } from "./timeRange";

const AT = new Date("2026-08-24T10:00:00.000Z");

describe("boundsAtJump", () => {
  it("gives `to` ten minutes past the target rather than at it", () => {
    expect(boundsAtJump("1h", AT).to).toBe("2026-08-24T10:10:00.000Z");
  });

  it("keeps `from` exactly what the range buttons would give ending at the target", () => {
    expect(boundsAtJump("1h", AT).from).toBe(boundsFor("1h", AT).from);
  });

  it("scales `from` with the selected range, same as the range buttons do", () => {
    expect(boundsAtJump("15m", AT).from).toBe("2026-08-24T09:45:00.000Z");
    expect(boundsAtJump("24h", AT).from).toBe("2026-08-23T10:00:00.000Z");
  });
});
