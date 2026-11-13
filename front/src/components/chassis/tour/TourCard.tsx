"use client";

import { Button } from "@components/ui/Button";
import { placeCard } from "@lib/tourPlacement";
import { advanceTour, endTour, TOUR_STEPS } from "@lib/tourState";
import { useAnchorBox } from "@lib/useAnchorBox";
import { useTour } from "@lib/useTour";
import { cn } from "@lib/utils";
import { TOUR_TEXT } from "@text/tour";
import { TourRing } from "./TourRing";

/** The card's size in px, for placing it — `w-tour-card` and `h-tour-card-height` give it the same. */
const CARD = { width: 320, height: 184 };

/**
 * The first-run tour: a small card beside the control each step is about, and a ring around it.
 *
 * Mounted by `ChromeShell`, so it exists only behind a session — never on an auth screen — and
 * ahead of the chassis in the document, which makes its two buttons the first tab stops while it
 * is open. It is not a modal: the app underneath stays usable, and the card simply follows.
 *
 * It wears the chassis palette, like the toasts and the menus, so it is the same card in both
 * themes — the theme belongs to the work surface, and this is chrome.
 */
export const TourCard = () => {
  const { step, leaving } = useTour();
  const current = step === null ? undefined : TOUR_STEPS[step];
  const anchor = useAnchorBox(current?.anchor);
  if (!current || step === null || !anchor) return null;

  const at = placeCard({
    anchor,
    card: CARD,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    prefer: current.side,
  });
  const copy = TOUR_TEXT.steps[current.anchor];
  const last = step === TOUR_STEPS.length - 1;

  return (
    <>
      <TourRing
        anchor={anchor}
        leaving={leaving}
      />
      <section
        aria-label={TOUR_TEXT.label}
        aria-live="polite"
        className={cn(
          "fixed z-48 flex h-tour-card-height w-tour-card flex-col rounded-overlay border border-chassis-border-strong",
          "bg-chassis-raised p-3.5 shadow-menu",
          // `z-48`: above the log table's sticky heading band (`z-45`), which it would otherwise
          // slide under, and below the toast stack (`z-50`) — a message that just arrived wins.
          // Fades in where it opens, glides to the next control, fades out when closed.
          "transition-[left,top,opacity] duration-200 ease-out starting:opacity-0",
          leaving && "opacity-0",
        )}
        style={{ left: at.x, top: at.y }}
        data-testid="tour-card"
        data-step={current.anchor}
      >
        <header className="flex items-center justify-between font-mono text-kicker tracking-kicker text-chassis-text-muted uppercase">
          <span data-testid="tour-progress">{TOUR_TEXT.progress(step + 1, TOUR_STEPS.length)}</span>
          <button
            type="button"
            onClick={endTour}
            className="uppercase transition-colors duration-150 ease-out hover:text-chassis-text-bright"
            data-testid="tour-skip"
          >
            {TOUR_TEXT.skip}
          </button>
        </header>
        <h2 className="mt-2.5 font-sans text-ui font-medium text-chassis-text-bright">{copy.title}</h2>
        <p className="mt-1.5 font-sans text-dense leading-hint text-chassis-text">{copy.body}</p>
        <footer className="mt-auto flex items-center justify-between">
          <span
            aria-hidden="true"
            className="flex gap-1"
          >
            {TOUR_STEPS.map((tourStep, index) => (
              <i
                key={tourStep.anchor}
                className={cn(
                  "h-0.5 w-3 rounded-chip transition-colors duration-200 ease-out",
                  index === step ? "bg-chassis-accent" : "bg-chassis-border-strong",
                )}
              />
            ))}
          </span>
          <Button
            onClick={advanceTour}
            className="h-7 px-3"
            data-testid="tour-next"
          >
            {last ? TOUR_TEXT.done : TOUR_TEXT.next}
          </Button>
        </footer>
      </section>
    </>
  );
};
