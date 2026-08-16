import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module";

/**
 * One Nest app hosts both the HTTP API and the collector — one PM2 process, one Prisma client,
 * and a live tail served from an in-process event bus rather than by polling MySQL.
 *
 * The rest arrives with its task: config and the exception filter (Tasks 4–5), auth
 * (Tasks 8–11), ingest (Tasks 12–16), logs (Tasks 17–19).
 */
@Module({
  imports: [PrismaModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
