import { Pending } from "@components/ui/Pending";
import { TRACES_TEXT } from "@text/traces";

import type { Polled } from "@lib/usePolledResource";

/**
 * What an AI traces panel shows before its data: the reading mark, or the error and a retry — the
 * same two states every view in Iknos has.
 */
export const LoadState = <T,>({ polled }: LoadStateProps<T>) => (
  <p className="px-3 py-4 text-row text-work-text-muted">
    {polled.error !== null ? (
      <>
        {polled.error}{" "}
        <button
          type="button"
          onClick={polled.reload}
          className="underline underline-offset-2 transition-colors duration-150 ease-out hover:text-work-text"
          data-testid="traces-retry"
        >
          {TRACES_TEXT.retry}
        </button>
      </>
    ) : (
      <Pending>{TRACES_TEXT.loading}</Pending>
    )}
  </p>
);

type LoadStateProps<T> = {
  polled: Polled<T>;
};
