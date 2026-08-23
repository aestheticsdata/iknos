import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { parseRowId } from "./log-query";

describe("parseRowId", () => {
  it("keeps every digit of an id past 2^53", () => {
    // The whole reason the id crosses the wire as a string. Through `Number` this one comes back
    // as ...992, and the route would answer confidently with the wrong line.
    expect(parseRowId("9007199254740993")).toBe(9_007_199_254_740_993n);
  });

  it("refuses anything that is not a bare decimal id", () => {
    for (const raw of ["", "12a", "1.0", "-1", "0x10", " 12", "1e3", "٣"]) {
      expect(() => parseRowId(raw)).toThrow(BadRequestException);
    }
  });

  it("refuses an id larger than the column can hold", () => {
    // A 400 rather than a bind error surfacing as a 500 on a crafted URL.
    expect(parseRowId("18446744073709551615")).toBe(18_446_744_073_709_551_615n);
    expect(() => parseRowId("18446744073709551616")).toThrow(BadRequestException);
    expect(() => parseRowId("99999999999999999999999")).toThrow(BadRequestException);
  });
});
