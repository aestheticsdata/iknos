import { describe, expect, it } from "vitest";
import { isBackdropClick } from "./Modal";

describe("isBackdropClick — IKN-60", () => {
  it("is true when the click's target is the dialog element itself", () => {
    const dialog = new EventTarget();
    expect(isBackdropClick({ target: dialog }, dialog)).toBe(true);
  });

  it("is false when the click's target is a child of the dialog", () => {
    const dialog = new EventTarget();
    const child = new EventTarget();
    expect(isBackdropClick({ target: child }, dialog)).toBe(false);
  });

  it("is false when there is no dialog to compare against yet", () => {
    expect(isBackdropClick({ target: new EventTarget() }, null)).toBe(false);
  });
});
