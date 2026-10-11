"use client";

import { Pending } from "@components/ui/Pending";
import { SURFACE_TEXT, SURFACE_TEXT_DIM, SURFACE_TEXT_MUTED, TONE_TEXT } from "@components/ui/surface";
import { WHOIS_STATUS } from "@lib/interfaces/whoisTypes";
import { cn } from "@lib/utils";
import { whoisNetwork, whoisPlace, whoisUnknown } from "@lib/whoisFormat";
import { LOGS_TEXT } from "@text/logs";

import type { IpWhois, WhoisLookup } from "@lib/interfaces/whoisTypes";

type WhoisAnswerProps = {
  whois: WhoisLookup;
  className?: string;
};

/**
 * What a lookup said, where it was asked (IKN-73). Nothing at all until it has been asked.
 *
 * Every outcome is a sentence: the place and the network when the provider knew, a stated
 * `unknown` with its reason when it did not, and the same when the API itself could not be
 * reached — never a spinner left running, never a blank.
 *
 * `aria-live` so the answer is read out where it lands: the button that asked stays focused and the
 * reader is not moved to find it.
 */
export const WhoisAnswer = ({ whois, className }: WhoisAnswerProps) => {
  if (!whois.requested) return null;

  return (
    <div
      aria-live="polite"
      data-testid="whois-answer"
      className={cn("animate-in text-row", className)}
    >
      <WhoisBody whois={whois} />
    </div>
  );
};

const WhoisBody = ({ whois }: WhoisAnswerProps) => {
  if (whois.loading) {
    return (
      <span className={SURFACE_TEXT_DIM.chassis}>
        <Pending>{LOGS_TEXT.whoisLoading}</Pending>
      </span>
    );
  }

  if (whois.error !== null) {
    return <span className={TONE_TEXT.chassis.warn}>{whois.error}</span>;
  }

  return whois.answer === null ? null : <WhoisFacts answer={whois.answer} />;
};

type WhoisFactsProps = { answer: IpWhois };

const WhoisFacts = ({ answer }: WhoisFactsProps) => {
  if (answer.status !== WHOIS_STATUS.found) {
    return (
      <span
        data-whois-status={answer.status}
        className={SURFACE_TEXT_DIM.chassis}
      >
        {whoisUnknown(answer.reason)}
      </span>
    );
  }

  const place = whoisPlace(answer);
  const network = whoisNetwork(answer);

  return (
    <span
      data-whois-status={answer.status}
      data-whois-cached={answer.cached}
      title={answer.cached ? LOGS_TEXT.whoisCached : LOGS_TEXT.whoisFresh}
      className="flex flex-col"
    >
      {place !== null && <span className={SURFACE_TEXT.chassis}>{place}</span>}
      {network !== null && <span className={SURFACE_TEXT_MUTED.chassis}>{network}</span>}
      {place === null && network === null && (
        <span className={SURFACE_TEXT_DIM.chassis}>{whoisUnknown(answer.reason)}</span>
      )}
    </span>
  );
};
