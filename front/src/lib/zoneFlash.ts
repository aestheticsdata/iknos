/**
 * Which flash the chassis is wearing, from how many times the toggle has been pressed — IKN-47.
 *
 * One line, and it is here rather than inline in `ChassisFrame` because it is the only part of the
 * zone flash a test can reach. The rest of the gesture is CSS and a DOM class; `vitest.config.ts`
 * says in as many words that components are not covered and that a jsdom environment would only
 * invite pretending otherwise. So the two rules that are genuinely easy to get wrong are pulled
 * out to where they can be pinned:
 *
 * **Nothing at zero.** The count starts at `0` at mount, when the zone is restored from
 * `localStorage` and nobody has decided anything. A flash there would be the app reporting a
 * change that did not happen, on a page the reader has only just opened.
 *
 * **Never the same class twice running.** This is the whole restart mechanism, not a detail: a CSS
 * animation replays only when its `animation-name` changes, so pressing the toggle twice flashes
 * twice *only* if consecutive presses hand back different classes. Both keyframes are identical —
 * see `animations.css` — and the pair exists for no other reason.
 */
export const zoneFlashClass = (pulse: number): string | null =>
  pulse <= 0 ? null : pulse % 2 === 1 ? "animate-zone-flash-a" : "animate-zone-flash-b";
