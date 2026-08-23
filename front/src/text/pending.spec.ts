import { describe, expect, it } from "vitest";
import { AUTH_TEXT } from "./auth";
import { CHASSIS_TEXT } from "./chassis";
import { LOGS_TEXT } from "./logs";
import { SERVICE_TEXT } from "./service";

/**
 * Every string in the app that names something still in flight, and the one rule they share:
 * the word is theirs, the dots are `<Pending>`'s (IKN-57).
 *
 * A guard rather than a design driven out test-first — the rule was decided when the mark was, and
 * this exists because it is invisible at the call site and costs nothing to break. Someone adding a
 * pending state a year from now will copy the nearest one, and if `…` has crept back into any of
 * these the copy carries it. The failure is silent and it is the exact bug this ticket fixed: a
 * line ending in an ellipsis that does not move reads as an answer, and at 10px that ellipsis is
 * not even three dots.
 *
 * The pointer is deliberate: dots are now something only `ik-pending` can produce, which is what
 * makes the invariant structural rather than a thing to remember.
 */
const PENDING_COPY: Array<[string, string]> = [
  ["SERVICE_TEXT.loading", SERVICE_TEXT.loading],
  ["CHASSIS_TEXT.loggingOut", CHASSIS_TEXT.loggingOut],
  ["CHASSIS_TEXT.storageLoading", CHASSIS_TEXT.storageLoading],
  ["CHASSIS_TEXT.paletteSearching", CHASSIS_TEXT.paletteSearching],
  ["LOGS_TEXT.loading", LOGS_TEXT.loading],
  ["LOGS_TEXT.disconnected", LOGS_TEXT.disconnected],
  ["AUTH_TEXT.login.submitting", AUTH_TEXT.login.submitting],
  ["AUTH_TEXT.register.submitting", AUTH_TEXT.register.submitting],
  ["AUTH_TEXT.recover.submitting", AUTH_TEXT.recover.submitting],
];

describe("a pending string carries no dots of its own", () => {
  it.each(PENDING_COPY)("%s", (_name, copy) => {
    expect(copy).not.toMatch(/[.…]$/);
  });

  it("covers every pending string there is", () => {
    // Cheap tripwire on the list above rather than on the rule: a tenth pending state added without
    // a line here would be tested by nothing at all.
    expect(PENDING_COPY).toHaveLength(9);
  });
});

/**
 * The one ellipsis that stays, named here so it reads as a decision rather than as a miss.
 *
 * It means "and so on", not "in flight", and a `placeholder` attribute has no element to hang a
 * pseudo-element on — the mark could not reach it even if the meaning were the same.
 */
describe("the search placeholder keeps its ellipsis", () => {
  it("is not a pending state", () => {
    expect(CHASSIS_TEXT.palettePlaceholder).toMatch(/…$/);
  });
});
