import { Pending } from "@components/ui/Pending";
import { TRAFFIC_TEXT } from "@text/traffic";

/** Reading, or the error with a retry — the two states before a traffic payload exists. */
export const LoadState = ({ error, onRetry }: LoadStateProps) => (
  <div className="flex h-full items-center justify-center bg-work-ground px-3 text-row text-work-text-muted">
    {error !== null ? (
      <p>
        {error}{" "}
        <button
          type="button"
          onClick={onRetry}
          className="underline underline-offset-2 transition-colors duration-150 ease-out hover:text-work-text"
          data-testid="traffic-retry"
        >
          {TRAFFIC_TEXT.retry}
        </button>
      </p>
    ) : (
      <Pending>{TRAFFIC_TEXT.loading}</Pending>
    )}
  </div>
);

type LoadStateProps = {
  error: string | null;
  onRetry: () => void;
};
