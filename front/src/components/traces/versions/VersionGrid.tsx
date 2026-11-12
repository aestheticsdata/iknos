import { Badge } from "@components/ui/Badge";
import { shortModel } from "@lib/aiRunFormat";
import { VERSION_ROW } from "@lib/interfaces/aiRunTypes";
import { cn } from "@lib/utils";
import { columnKey, defaultReference, versionCell } from "@lib/versionGrid";
import { TRACES_TEXT } from "@text/traces";

import type { VersionCell, VersionColumn } from "@lib/interfaces/aiRunTypes";

/** A significant cell is tinted; the label under the value carries the verdict in words. */
function cellTint(cell: VersionCell): string | false {
  if (cell.verdict === null || !cell.verdict.significant || cell.verdict.better === null) return false;
  return cell.verdict.better ? "bg-work-accent/12" : "bg-work-error/12";
}

/**
 * The comparison grid (IKN-94): measures down, versions across, oldest first. Real table semantics
 * — the grid is read by row and by column, and a screen reader should be able to do both. Wider
 * than the screen, it scrolls inside its card.
 */
export const VersionGrid = ({ columns, reference, onReference }: VersionGridProps) => {
  const refKey = columns.some((column) => columnKey(column) === reference) ? reference : defaultReference(columns);
  const ref = columns.find((column) => columnKey(column) === refKey) ?? null;

  return (
    <section
      className="flex flex-none flex-col overflow-hidden rounded-card border border-work-border bg-work-surface"
      data-testid="version-grid"
    >
      <div className="ik-scroll-work-x overflow-x-auto">
        <table className="w-full border-collapse text-row">
          <thead>
            <tr>
              <th
                scope="col"
                className="w-version-measure border-b border-work-border bg-work-inset px-3 py-2 text-left align-bottom text-kicker tracking-kicker text-work-text-dim uppercase"
              >
                {TRACES_TEXT.measure}
              </th>
              {columns.map((column) => {
                const isRef = columnKey(column) === refKey;
                return (
                  <th
                    key={columnKey(column)}
                    scope="col"
                    className="min-w-version-col border-b border-l border-work-border bg-work-inset px-3 py-2 text-left align-top font-normal"
                    data-testid="version-column"
                  >
                    <span className="block text-ui font-semibold text-work-text">{column.version}</span>
                    <span className="block text-label text-work-text-muted">{shortModel(column.model)}</span>
                    <span className="flex pt-1">
                      {isRef ? (
                        <Badge tone="info">{TRACES_TEXT.reference}</Badge>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onReference(columnKey(column))}
                          className="rounded-control border border-work-border-strong px-1.75 text-micro text-work-text transition-colors duration-150 ease-out hover:bg-work-surface"
                          data-testid="make-reference"
                        >
                          {TRACES_TEXT.makeReference}
                        </button>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Object.values(VERSION_ROW).map((row) => (
              <tr key={row}>
                <th
                  scope="row"
                  className="border-b border-work-border px-3 py-2 text-left align-top font-normal"
                >
                  <span className="block text-dense font-semibold text-work-text">{TRACES_TEXT.rows[row].label}</span>
                  <span className="block text-label text-work-text-dim">{TRACES_TEXT.rows[row].hint}</span>
                </th>
                {columns.map((column) => {
                  const isRef = columnKey(column) === refKey;
                  const cell = versionCell(row, column, isRef ? null : ref);
                  return (
                    <td
                      key={columnKey(column)}
                      className={cn(
                        "border-b border-l border-work-border px-3 py-2 align-top transition-colors duration-150 ease-out",
                        isRef && "bg-work-inset",
                        cellTint(cell),
                      )}
                    >
                      <span className="block text-ui font-medium tabular-nums text-work-text">{cell.value}</span>
                      {isRef && row !== VERSION_ROW.runs && (
                        <span className="block text-label text-work-text-dim">{TRACES_TEXT.reference}</span>
                      )}
                      {cell.delta !== null && (
                        <span className="block text-label tabular-nums text-work-text-muted">{cell.delta}</span>
                      )}
                      {cell.verdict !== null && <Verdict cell={cell} />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="flex flex-wrap gap-x-4.5 gap-y-2 px-3 py-2.5 text-label text-work-text-dim">
        <span>{TRACES_TEXT.ruleRates}</span>
        <span>{TRACES_TEXT.ruleMeasures}</span>
      </footer>
    </section>
  );
};

const Verdict = ({ cell }: VerdictProps) => {
  const verdict = cell.verdict;
  if (verdict === null) return null;
  if (!verdict.significant || verdict.better === null) {
    return <span className="block text-micro text-work-text-dim">{TRACES_TEXT.notSignificant}</span>;
  }
  return (
    <span className="block pt-1">
      <Badge tone={verdict.better ? "ok" : "error"}>
        {verdict.better ? TRACES_TEXT.significantBetter : TRACES_TEXT.significantWorse}
      </Badge>
    </span>
  );
};

type VersionGridProps = {
  columns: VersionColumn[];
  reference: string | null;
  onReference: (key: string) => void;
};

type VerdictProps = {
  cell: VersionCell;
};
