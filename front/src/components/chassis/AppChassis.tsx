import { AlertOverlay } from "@components/alerts/AlertOverlay";
import { IssueOverlay } from "@components/issues/IssueOverlay";
import { ToastProvider } from "@components/ui/Toast";
import { AlertClaimsProvider } from "@lib/alertClaims";
import { IssueClaimsProvider } from "@lib/issueClaims";
import { readServices } from "@lib/services";
import { AlertCountsProvider } from "@lib/useAlertCounts";
import { CollectorProvider } from "@lib/useCollector";
import { ZoneProvider } from "@lib/zoneState";
import { ChassisFrame } from "./ChassisFrame";
import { ChromeShell } from "./ChromeShell";
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
 * puts the status bar below the fold, which is the one thing it must never be. Since IKN-47 that
 * box is `ChassisFrame`, which is where the zone flash is played from — it has to read the
 * provider mounted here, and this component cannot read a provider it renders.
 */
export const AppChassis = async ({ children }: { children: React.ReactNode }) => {
  const services = await readServices();

  return (
    /*
     * The toast host lives above the whole chassis, not inside the work surface: a toast raised by
     * the rail or the top bar has to outlive the view it was raised from.
     */
    <ToastProvider>
      {/* Above the whole chassis for the same reason: the top bar's clock and the panel's table
          are two renders of one decision, and a provider that wrapped only the work surface would
          let them disagree — which is exactly the failure IKN-38 exists to end. */}
      <ZoneProvider>
        {/* One poll of `/api/collector/status` for the whole shell. The pastille in the top bar and
            the ingest card in the rail are two renderings of one snapshot — polled separately they
            would drift apart, and a dot saying the collector is dead above a card still drawing its
            throughput is not a disagreement anyone should have to arbitrate. */}
        <CollectorProvider>
          {/* One poll of `/api/alerts/counts` for the whole shell — the rail's badge and the status
              bar's counter are two renderings of one number, and IKN-15 requires them to agree.
              Two hooks on one URL would satisfy the letter of that and still drift across a tick. */}
          <AlertCountsProvider>
            {/* The keyboard, the palette and the status channel — IKN-22. Inside the providers above
              because the palette re-scopes the service and reads the same clock as everything
              else; outside the layout because it owns a native dialog. */}
            <ChromeShell>
              {/* The optimistic state of the issue mutations, above every list that shows one — the
                modal below is not a child of any of them. See `issueClaims.tsx`. */}
              <IssueClaimsProvider>
                <AlertClaimsProvider>
                  <ChassisFrame>
                    <TopBar />
                    <div className="flex min-h-0 flex-1">
                      <ServiceRail services={services} />
                      <main className="ik-scroll-work min-w-0 flex-1 overflow-auto bg-work-surface">{children}</main>
                    </div>
                    <StatusBar />
                    {/* One issue modal for the application, opened by `?issue=` from wherever — the
                    rail panel, the issues table, or `⌘I` on a log row (IKN-14). */}
                    <IssueOverlay />
                    {/* And one alert modal, opened by `?alert=` from the rail panel or the table. */}
                    <AlertOverlay />
                  </ChassisFrame>
                </AlertClaimsProvider>
              </IssueClaimsProvider>
            </ChromeShell>
          </AlertCountsProvider>
        </CollectorProvider>
      </ZoneProvider>
    </ToastProvider>
  );
};
