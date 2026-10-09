import { describe, expect, it } from "vitest";
import { isRouteTemplate, routeClause, routeMatches, templateSource } from "./route-template";

describe("isRouteTemplate", () => {
  it("is a pattern when a segment is a parameter", () => {
    expect(isRouteTemplate("/api/spendings/:id")).toBe(true);
    expect(isRouteTemplate("/api/:owner/files/:file")).toBe(true);
  });

  it("is not a pattern for a plain path, or a colon inside a segment", () => {
    expect(isRouteTemplate("/api/spendings")).toBe(false);
    expect(isRouteTemplate("/api/time:12")).toBe(false);
    expect(isRouteTemplate("unknown")).toBe(false);
  });
});

describe("routeMatches", () => {
  it("matches one segment per parameter, and no more", () => {
    expect(routeMatches("/api/spendings/:id", "/api/spendings/4182")).toBe(true);
    expect(routeMatches("/api/spendings/:id", "/api/spendings/4182/receipts")).toBe(false);
    expect(routeMatches("/api/spendings/:id", "/api/spendings/")).toBe(false);
    expect(routeMatches("/api/spendings/:id", "/api/spendings")).toBe(false);
  });

  it("treats the literal parts literally", () => {
    expect(routeMatches("/api/v1.0/:id", "/api/v1x0/7")).toBe(false);
    expect(routeMatches("/api/v1.0/:id", "/api/v1.0/7")).toBe(true);
  });

  it("compares a plain path exactly, as the filter always has", () => {
    expect(routeMatches("/api/spendings", "/api/spendings")).toBe(true);
    expect(routeMatches("/api/spendings", "/api/spendings/1")).toBe(false);
    expect(routeMatches("/api/spendings", null)).toBe(false);
  });
});

describe("routeClause", () => {
  it("keeps the equality for a plain path", () => {
    const sql = routeClause("/api/spendings");
    expect(sql.sql).toBe("route = ?");
    expect(sql.values).toEqual(["/api/spendings"]);
  });

  it("ranges on the literal prefix and settles the rest with the regex", () => {
    const sql = routeClause("/api/spend_ings/:id/files");
    expect(sql.sql).toBe("(route LIKE ? AND route REGEXP ?)");
    expect(sql.values).toEqual(["/api/spend\\_ings/%", templateSource("/api/spend_ings/:id/files")]);
  });
});
