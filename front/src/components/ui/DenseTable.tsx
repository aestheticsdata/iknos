import { cn } from "@lib/utils";
import {
  SURFACE_BORDER,
  SURFACE_HEAD_BAND,
  SURFACE_INSET_BG,
  SURFACE_SCROLL_X,
  SURFACE_TEXT,
  SURFACE_TEXT_DIM,
} from "./surface";

import type { Surface } from "./surface";

export type Column<Row> = {
  key: string;
  header: string;
  /** Right-aligned for anything counted or measured — a column of numbers is read down its units. */
  numeric?: boolean;
  render: (row: Row) => React.ReactNode;
};

/**
 * The dense table — log rows, route lists, issue lists.
 *
 * `text-row` (10.5px) and a fixed row height, because the whole point is how many lines fit. The
 * header sticks: scrolling a hundred rows and losing which column is which is the failure this
 * table exists to avoid.
 *
 * Horizontal overflow scrolls **inside** the table rather than widening the page — the chassis is
 * `h-dvh` with no page scrollbar, and a table that grows past the viewport would break that.
 */
export const DenseTable = <Row,>({
  columns,
  rows,
  rowKey,
  surface = "work",
  empty = "Nothing to show.",
  className,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  surface?: Surface;
  empty?: string;
  className?: string;
}) => (
  /* `ik-scroll-head` because this box scrolls in both axes — `overflow-x: auto` computes the other
     one to `auto` as well — and the heading band above sticks inside it. Without it the vertical
     bar starts level with the column titles and its thumb sits across them, and the band itself
     stops 9px short of the edge in a notch. `SURFACE_HEAD_BAND` is the ink it paints that last
     9px with; below the band the rail stays transparent and shows the card underneath, which is
     the same ground the rows are on. */
  <div
    className={cn(SURFACE_SCROLL_X[surface], SURFACE_HEAD_BAND[surface], "ik-scroll-head overflow-x-auto", className)}
  >
    <table className="w-full border-collapse text-row tabular-nums">
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={cn(
                /* The band's height is pinned rather than left to `py-1` and a 9px line box,
                   because `ik-scroll-head` holds exactly `--spacing-head-band` of rail clear of
                   it. Two numbers that have to agree, written once — and `whitespace-nowrap` so a
                   heading cannot wrap to two lines and put the band back past the clearance. */
                "sticky top-0 h-head-band border-b px-2 text-left text-kicker tracking-kicker whitespace-nowrap uppercase",
                SURFACE_INSET_BG[surface],
                SURFACE_BORDER[surface],
                SURFACE_TEXT_DIM[surface],
                column.numeric && "text-right",
              )}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={rowKey(row)}
            className={cn("border-b last:border-0", SURFACE_BORDER[surface])}
          >
            {columns.map((column) => (
              <td
                key={column.key}
                className={cn("px-2 py-1 align-top", SURFACE_TEXT[surface], column.numeric && "text-right")}
              >
                {column.render(row)}
              </td>
            ))}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td
              colSpan={columns.length}
              className={cn("px-2 py-4 text-center", SURFACE_TEXT_DIM[surface])}
            >
              {empty}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);
