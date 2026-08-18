import { ToastProvider } from "@components/ui/Toast";
import { readServices } from "@lib/services";
import { ServiceRail } from "./ServiceRail";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";

/**
 * The shell every view is rendered into — §4.
 *
 * A server component: the registry is read here, once, with the caller's cookie, so the rail is
 * populated in the first byte of HTML rather than after a round trip the browser has to make on
 * its own. Only the three bars are client components, and only because they own URL state, a
 * ticking clock, and a button.
 *
 * `h-dvh` with `overflow-hidden` is the layout rule from the design doc: the screen fits 1440×900
 * without a page scrollbar and only the lists inside it scroll. A page that scrolls as a whole
 * puts the status bar below the fold, which is the one thing it must never be.
 */
export const AppChassis = async ({ children }: { children: React.ReactNode }) => {
  const services = await readServices();

  return (
    /*
     * The toast host lives above the whole chassis, not inside the work surface: a toast raised by
     * the rail or the top bar has to outlive the view it was raised from.
     */
    <ToastProvider>
      <div className="flex h-dvh flex-col overflow-hidden bg-chassis-deep font-mono">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <ServiceRail services={services} />
          <main className="min-w-0 flex-1 overflow-auto bg-work-surface">{children}</main>
        </div>
        <StatusBar />
      </div>
    </ToastProvider>
  );
};
