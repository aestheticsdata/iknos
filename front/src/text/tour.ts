import { TOUR_ANCHOR } from "@lib/tourState";

import type { TourAnchor, TourStepCopy } from "@lib/interfaces/tourTypes";

/**
 * The first-run tour — the card's own labels, and what each step says about the control it sits
 * beside. English, like the rest of the interface.
 */
export const TOUR_TEXT = {
  label: "Tour",
  progress: (step: number, total: number) => `Tour · ${step} of ${total}`,
  skip: "Skip tour",
  next: "Next",
  done: "Done",
  steps: {
    [TOUR_ANCHOR.services]: {
      title: "Pick a service",
      body: "Every app on the box, with its health and its log volume over the last hour. Selecting one scopes every view to it; all brings the fleet back.",
    },
    [TOUR_ANCHOR.views]: {
      title: "Then choose what to look at",
      body: "Logs, route metrics, site traffic, grouped issues and firing alerts — and the AI runs the other apps send over OTLP, with their quality and versions.",
    },
    [TOUR_ANCHOR.range]: {
      title: "One time range for everything",
      body: "Fifteen minutes to fourteen days. Every view, chart and count reads this window, and it travels in the URL with the service.",
    },
    [TOUR_ANCHOR.host]: {
      title: "The machine underneath",
      body: "The host all of it runs on. The colour is its level; click for CPU, memory, disk and load over the range.",
    },
    [TOUR_ANCHOR.ingest]: {
      title: "Iknos watching itself",
      body: "What the collector read in the last hour. Click for storage and retention: what is kept, for how long, and what it costs on disk.",
    },
  } satisfies Record<TourAnchor, TourStepCopy>,
};
