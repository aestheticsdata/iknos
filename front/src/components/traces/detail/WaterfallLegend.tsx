import { TONE_FILL } from "@components/ui/surface";
import { SPAN_KIND } from "@lib/interfaces/spanKindTypes";
import { KIND_TONE } from "@lib/spanKind";
import { cn } from "@lib/utils";
import { TRACES_TEXT } from "@text/traces";

import type { Tone } from "@components/ui/surface";

/** What the bar inks mean, under the waterfall (IKN-92). Failed spans are labelled, not only red. */
const ENTRIES: { label: string; tone: Tone }[] = [
  { label: TRACES_TEXT.legend.step, tone: KIND_TONE[SPAN_KIND.step] },
  { label: TRACES_TEXT.legend.model, tone: KIND_TONE[SPAN_KIND.model] },
  { label: TRACES_TEXT.legend.tool, tone: KIND_TONE[SPAN_KIND.tool] },
  { label: TRACES_TEXT.legend.gate, tone: KIND_TONE[SPAN_KIND.gate] },
  { label: TRACES_TEXT.legend.failed, tone: "error" },
];

export const WaterfallLegend = () => (
  <ul className="flex flex-none flex-wrap gap-3.5 border-t border-work-border px-3 py-2 text-micro text-work-text-dim">
    {ENTRIES.map((entry) => (
      <li
        key={entry.label}
        className="flex items-center gap-1.25"
      >
        <span
          aria-hidden="true"
          className={cn("h-1.75 w-3 rounded-chip", TONE_FILL.work[entry.tone])}
        />
        {entry.label}
      </li>
    ))}
  </ul>
);
