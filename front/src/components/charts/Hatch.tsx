/**
 * The hatching of a bucket still in progress (IKN-86): stripes at 135°, 1.5px of ink then 1.5px
 * of nothing, the SVG form of `repeating-linear-gradient(135deg, c 0 1.5px, transparent 1.5px 3px)`.
 *
 * The ink is the class on the `<defs>`. A pattern's `currentColor` is resolved where the pattern
 * is defined, not where it is used, so each ink needs its own pattern.
 */
export const Hatch = ({ id, ink }: HatchProps) => (
  <defs className={ink}>
    <pattern
      id={id}
      width={3}
      height={3}
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(45)"
    >
      <rect
        width={1.5}
        height={3}
        fill="currentColor"
      />
    </pattern>
  </defs>
);

/**
 * A hatched rectangle with its 1px inner outline, the in-progress bucket. The outline is what keeps
 * a short partial bar readable as a bar rather than as a few loose stripes.
 */
export const HatchedRect = ({ x, y, width, height, patternId }: HatchedRectProps) => (
  <>
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={`url(#${patternId})`}
    />
    {width > 1 && height > 1 && (
      <rect
        x={x + 0.5}
        y={y + 0.5}
        width={width - 1}
        height={height - 1}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
      />
    )}
  </>
);

type HatchProps = {
  id: string;
  /** A `text-*` class: the stripes' colour. */
  ink: string;
};

type HatchedRectProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  patternId: string;
};
