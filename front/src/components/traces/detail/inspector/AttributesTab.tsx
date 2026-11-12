import { attrText, sortedAttrs } from "@lib/traceFormat";
import { TRACES_TEXT } from "@text/traces";

import type { SpanRow } from "@lib/interfaces/traceSpanTypes";

/** Every attribute the span carried, sorted by key — IKN-87's list, one tab over. */
export const AttributesTab = ({ span }: AttributesTabProps) => {
  const attrs = sortedAttrs(span.attrs);
  if (attrs.length === 0) return <p className="py-4 text-row text-work-text-dim">{TRACES_TEXT.noAttributes}</p>;
  return (
    <dl
      className="flex flex-col gap-1 pt-2 text-row"
      data-testid="span-attributes"
    >
      {attrs.map(([key, value]) => (
        <div key={key}>
          <dt className="break-all text-work-text-dim">{key}</dt>
          <dd className="break-all whitespace-pre-wrap text-work-text">{attrText(value)}</dd>
        </div>
      ))}
    </dl>
  );
};

type AttributesTabProps = {
  span: SpanRow;
};
