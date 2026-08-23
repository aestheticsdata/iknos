/**
 * The pending mark — IKN-57. One affordance, every in-flight state in the app.
 *
 * A word and three dots that count up: `reading.` `reading..` `reading...`, 400ms apart. The word
 * is the caller's and comes from `text/`; the dots are `ik-pending`'s and are drawn by CSS, which
 * is the whole of the fix rather than a detail of it.
 *
 * **Drawn, because typed did not survive the type size.** `…` is a single character cell carrying
 * all three marks, and at `text-micro` they stop being separable — the reader who reported counting
 * two dots was counting what was on screen. Three periods are three cells and resolve at every size
 * this renders at. Drawing them is also what lets the count exist at all: no string animates into
 * another string, but a `content` of three real dots can be uncovered one at a time.
 *
 * **Moving, because still was indistinguishable from an answer.** Six places rendered the pending
 * sentence through the same element, ink and geometry as the final one — `TileEmpty` was handed
 * "reading…" and "No samples in this range." and had no way to tell them apart, and the histogram's
 * two branches were identical but for the string. No `<p>` can fix that; the mark is what makes a
 * question look like a question. It is structural too: with `…` gone from every pending string in
 * `text/`, dots are now a thing only this component can produce.
 *
 * **No ink of its own, and no `surface` prop.** The mark paints in whatever colour it inherits, so
 * it is right on both ramps and inside a solid `Button` without being told which — the one
 * primitive here that does not consult `surface.ts`, because it has no colour to look up.
 * `className` is for the sites where the string was the only child of a bare `<span>`; everywhere
 * else this goes *inside* the element that already exists.
 *
 * ⚠️ **No `aria-busy` here, deliberately.** It belongs on the region whose contents are in flux, not
 * on the sentence announcing it: on a `<span>` that *is* the message, some screen readers take
 * `aria-busy` as an instruction to withhold that message — the one outcome this may not have. The
 * word is real text in the accessibility tree and always was; the dots are `aria-hidden` because
 * they are punctuation and motion, and neither is worth a syllable. Where a container genuinely
 * wants marking, the site does it — `SignalTile` and `LogTable`'s load-more button both do.
 */
export const Pending = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <span className={className}>
    {children}
    {/* Empty on purpose: the dots are `content` on `::after`, so they are one clipped box rather
        than three elements, and one `aria-hidden` covers all of them. With no children this is the
        mark alone — the collapsed rail's case. */}
    <span
      aria-hidden="true"
      className="ik-pending"
    />
  </span>
);
