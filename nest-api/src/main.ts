import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

/**
 * Task 7 replaces this with the real bootstrap: validated config, the global exception
 * filter, ECS logging, `enableShutdownHooks`, and BigInt serialisation.
 *
 * Two things are already true here and must stay true. It binds to `127.0.0.1`, never
 * `0.0.0.0` — nginx is the only thing that should reach this port. And the port comes from
 * `IKNOS_PORT`, which is `4310` in local development and `6900` on ks-b.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(Number(process.env.IKNOS_PORT ?? 4310), "127.0.0.1");
}

void bootstrap();
