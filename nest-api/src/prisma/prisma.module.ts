import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/**
 * Global so that no feature module has to import it to inject `PrismaService`. There is exactly
 * one client in the process and every module wants it; making each one declare the dependency
 * would be ceremony that never varies.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
