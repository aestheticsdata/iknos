import type { ReactNode } from "react";

/** A whole-view sentence in place of a screen that cannot answer yet — pick a service, mostly. */
export const Notice = ({ children }: NoticeProps) => (
  <div className="flex h-full items-center justify-center bg-work-ground px-3 text-row text-work-text-muted">
    <p data-testid="traces-notice">{children}</p>
  </div>
);

type NoticeProps = {
  children: ReactNode;
};
