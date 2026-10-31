import { Card } from "@components/ui/Card";
import { TRAFFIC_TEXT } from "@text/traffic";
import { ShareList } from "./ShareList";

import type { SiteTraffic } from "@lib/interfaces/trafficTypes";

/** What visitors read the site with: browsers, systems, and phone or desktop. */
export const SetupPanel = ({ traffic }: SetupPanelProps) => (
  <Card title={`${TRAFFIC_TEXT.browsers} · ${TRAFFIC_TEXT.systems} · ${TRAFFIC_TEXT.devices}`}>
    <div className="flex flex-col gap-3">
      <ShareList
        title={TRAFFIC_TEXT.browsers}
        rows={traffic.browsers}
      />
      <ShareList
        title={TRAFFIC_TEXT.systems}
        rows={traffic.systems}
      />
      <ShareList
        title={TRAFFIC_TEXT.devices}
        rows={traffic.devices}
      />
    </div>
  </Card>
);

type SetupPanelProps = {
  traffic: SiteTraffic;
};
