import { Badge } from "@components/ui/Badge";
import { CHECKS_TONE, REVIEW_TONE, TELEMETRY_TONE } from "@lib/aiRunFormat";
import { CHECKS } from "@lib/interfaces/aiRunTypes";
import { TRACES_TEXT } from "@text/traces";

import type { AiRunSummary, Review, Telemetry } from "@lib/interfaces/aiRunTypes";

/**
 * A run's three verdicts as badges (IKN-91): its checks, the human review, the telemetry level.
 * The word carries the state; the tone only repeats it.
 */

export const ChecksBadge = ({ run }: RunBadgeProps) => (
  <Badge
    tone={CHECKS_TONE[run.checks]}
    data-testid="run-checks"
  >
    {run.checks === CHECKS.failed ? TRACES_TEXT.failedGates(run.failedGates) : TRACES_TEXT.checks[run.checks]}
  </Badge>
);

export const ReviewBadge = ({ review }: ReviewBadgeProps) => (
  <Badge
    tone={REVIEW_TONE[review]}
    data-testid="run-review"
  >
    {TRACES_TEXT.review[review]}
  </Badge>
);

export const TelemetryBadge = ({ telemetry }: TelemetryBadgeProps) => (
  <Badge
    tone={TELEMETRY_TONE[telemetry]}
    data-testid="run-telemetry"
  >
    {TRACES_TEXT.telemetry[telemetry]}
  </Badge>
);

type RunBadgeProps = {
  run: AiRunSummary;
};

type ReviewBadgeProps = {
  review: Review;
};

type TelemetryBadgeProps = {
  telemetry: Telemetry;
};
