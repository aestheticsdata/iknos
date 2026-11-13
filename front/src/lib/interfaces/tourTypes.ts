import type { TOUR_SIDE } from "@lib/tourPlacement";
import type { TOUR_ANCHOR } from "@lib/tourState";

/** A corner on screen, in CSS pixels from the viewport's top-left. */
export type Point = { x: number; y: number };

export type Size = { width: number; height: number };

/** An element's box on screen. */
export type Box = Point & Size;

/** The side of its anchor a tour card is placed on. */
export type TourSide = (typeof TOUR_SIDE)[keyof typeof TOUR_SIDE];

/** The control a tour step is about — the value of its `data-tour` attribute. */
export type TourAnchor = (typeof TOUR_ANCHOR)[keyof typeof TOUR_ANCHOR];

/** One step: the control it points at, and the side the card takes when there is room. */
export type TourStep = { anchor: TourAnchor; side: TourSide };

/** What a step says. */
export type TourStepCopy = { title: string; body: string };

/** Everything `placeCard` needs to know. */
export type CardPlacement = { anchor: Box; card: Size; viewport: Size; prefer: TourSide };

/** The two calls the tour makes on `localStorage`, so a test can hand it a `Map`. */
export type TourStorage = Pick<Storage, "getItem" | "setItem">;

/** The tour as the card reads it: `step` is `null` once closed, `leaving` while it fades out. */
export type TourState = { step: number | null; leaving: boolean };
