import { Controller, Get, Param } from "@nestjs/common";
import { WhoisService } from "./whois.service";

import type { IpWhois } from "@contracts/whois";

/**
 * Whois and geolocation for one address, on demand (IKN-73). Behind the global session guard like
 * every read route — an open endpoint that spends the provider's rate limit on anyone's behalf is
 * exactly what the click-only design exists to prevent.
 *
 * The lookup leaves from here and never from the browser, so the cache serves every viewer and no
 * provider detail ships in the front bundle.
 */
@Controller("api/whois")
export class WhoisController {
  constructor(private readonly whois: WhoisService) {}

  @Get(":ip")
  lookup(@Param("ip") ip: string): Promise<IpWhois> {
    return this.whois.lookup(ip);
  }
}
