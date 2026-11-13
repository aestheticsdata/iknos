import { browserStorage, rememberTourDone, TOUR_SIDE, tourDone } from "@lib/tourPlacement";

import type { TourState, TourStep } from "@lib/interfaces/tourTypes";

/**
 * The controls the first-run tour points at, as the value of their `data-tour` attribute.
 *
 * All five belong to the chassis — the rail and the top bar — which every view is rendered into.
 * So the tour never navigates and never waits for a page: it explains the frame, wherever the
 * reader landed after signing in, and the views stay theirs to open.
 */
export const TOUR_ANCHOR = {
  services: "services",
  views: "views",
  range: "range",
  host: "host",
  ingest: "ingest",
} as const;

/** In the order they are shown. The side is where the card goes when there is room for it. */
export const TOUR_STEPS: TourStep[] = [
  { anchor: TOUR_ANCHOR.services, side: TOUR_SIDE.right },
  { anchor: TOUR_ANCHOR.views, side: TOUR_SIDE.right },
  { anchor: TOUR_ANCHOR.range, side: TOUR_SIDE.below },
  { anchor: TOUR_ANCHOR.host, side: TOUR_SIDE.below },
  { anchor: TOUR_ANCHOR.ingest, side: TOUR_SIDE.right },
];

/** How long the card takes to fade out — the `duration-200` it wears. */
const LEAVE_MS = 200;

const CLOSED: TourState = { step: null, leaving: false };

/** The step after this one, or `null` past the last: the tour is over. */
export const nextTourStep = (step: number, total: number) => (step + 1 < total ? step + 1 : null);

/**
 * The tour's state, kept the way the theme is (`lib/theme.ts`): a module-level value read through
 * `useSyncExternalStore`, because the server cannot know it — whether the tour was already closed
 * is in `localStorage`. It is read once, on the first client render that asks.
 */
let state: TourState | undefined;
const listeners = new Set<() => void>();

const publish = (next: TourState) => {
  state = next;
  for (const listener of listeners) listener();
};

export const currentTour = () => {
  state ??= tourDone(browserStorage()) ? CLOSED : { step: 0, leaving: false };
  return state;
};

/** What the server and the hydrating render see: no tour. */
export const closedTour = () => CLOSED;

export const subscribeTour = (onChange: () => void) => {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
};

/**
 * Closes the tour for good: the flag is written first, so a reload during the fade does not bring
 * the card back, then the card fades out on its last step and is removed.
 */
export const endTour = () => {
  const { step, leaving } = currentTour();
  if (step === null || leaving) return;
  rememberTourDone(browserStorage());
  publish({ step, leaving: true });
  setTimeout(() => publish(CLOSED), LEAVE_MS);
};

/** Next, or Done on the last step. */
export const advanceTour = () => {
  const { step, leaving } = currentTour();
  if (step === null || leaving) return;
  const next = nextTourStep(step, TOUR_STEPS.length);
  if (next === null) endTour();
  else publish({ step: next, leaving: false });
};
