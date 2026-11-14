import { describe, expect, it } from "vitest";
import { filterServices } from "./serviceFilter";

import type { Service } from "@lib/services";

/** The rail's search: a list that narrows to what was typed, and never to something that only resembles it. */

const service = (name: string, pm2Name: string = name): Service => ({
  name,
  pm2Name,
  enabled: true,
  site: false,
  health: null,
  sparkline: [],
});

const FLEET = [
  service("bkmk-front"),
  service("bots-front"),
  service("bots-nest-api"),
  service("pfa-api", "pfa-server"),
];
const names = (services: Service[]) => services.map((each) => each.name);

describe("filterServices", () => {
  it("keeps the whole list, as the same array, while nothing is typed", () => {
    expect(filterServices(FLEET, "")).toBe(FLEET);
    expect(filterServices(FLEET, "   ")).toBe(FLEET);
  });

  it("matches a fragment anywhere in the name, whatever its case", () => {
    expect(names(filterServices(FLEET, "FRONT"))).toEqual(["bkmk-front", "bots-front"]);
  });

  it("is a substring, not a fuzzy match — `bots` does not keep `bkmk-front`", () => {
    expect(names(filterServices(FLEET, "bots"))).toEqual(["bots-front", "bots-nest-api"]);
  });

  it("needs every word, in any order", () => {
    expect(names(filterServices(FLEET, "front bots"))).toEqual(["bots-front"]);
  });

  it("finds a service by its pm2 name when that is the one in the reader's head", () => {
    expect(names(filterServices(FLEET, "server"))).toEqual(["pfa-api"]);
  });

  it("keeps nothing when nothing matches", () => {
    expect(filterServices(FLEET, "zeus")).toEqual([]);
  });
});
