import { parseEnv } from "@config/env.validation";
import { PrismaService } from "@db/prisma.service";
import { Module } from "@nestjs/common";
import { TrafficController } from "./traffic.controller";
import { TrafficService } from "./traffic.service";

/**
 * Visitors per site, read from the nginx access logs (IKN-83).
 *
 * `TrafficService` is built by a factory for the reason `SignalsService` is: its second parameter
 * is a plain number out of the validated environment. It is the **log** retention — the payload
 * carries it so the view can say why the oldest days of a long range are empty.
 */
@Module({
  controllers: [TrafficController],
  providers: [
    {
      provide: TrafficService,
      useFactory: (prisma: PrismaService) => new TrafficService(prisma, parseEnv({ ...process.env }).retentionDays),
      inject: [PrismaService],
    },
  ],
})
export class TrafficModule {}
