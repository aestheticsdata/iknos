"use client";

import { Tooltip } from "@components/ui/Tooltip";
import { useDelegatedHint } from "@components/ui/useDelegatedHint";

import type { RefObject } from "react";

/** A message is the one hint here that can run to a paragraph — wider than the 240 default. */
const MAX_WIDTH = 480;

type DelegatedTooltipProps = {
  /** The container whose `data-hint` descendants the bubble speaks for. */
  root: RefObject<HTMLElement | null>;
};

/**
 * The bubble for every `data-hint` inside `root` — see `useDelegatedHint` for why a dense table
 * gets one of these instead of a `<Tooltip>` per cell.
 *
 * Its own component so the pointer-rate state re-renders this and its portal, never the container.
 */
export const DelegatedTooltip = ({ root }: DelegatedTooltipProps) => {
  const hint = useDelegatedHint(root);

  return (
    <Tooltip
      mode="cursor"
      point={hint}
      maxWidth={MAX_WIDTH}
    >
      {hint?.data}
    </Tooltip>
  );
};
