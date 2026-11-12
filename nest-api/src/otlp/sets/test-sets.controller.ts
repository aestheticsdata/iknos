import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { parseOptionalService } from "../runs/run-query";
import { parseTraceId } from "../trace-rows";
import { TestSetsService } from "./test-sets.service";

import type { TestSetDetail, TestSetList, TestSetRun, TestSetSummary } from "@contracts/test-sets";

class ListQueryDto {
  @IsOptional() @IsString() @MaxLength(64) service?: string;
}

class CreateSetDto {
  @IsString() @MinLength(1) @MaxLength(64) service!: string;
  /** Printable, no leading or trailing space — a name is read in a list and typed in a select. */
  @IsString() @MinLength(1) @MaxLength(128) @Matches(/^\S(.*\S)?$/) name!: string;
}

class AddRunDto {
  @IsString() @MaxLength(32) traceId!: string;
}

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw new BadRequestException("an id is a whole number");
  return id;
}

const elapsed = (startedAt: number): number => Math.round(performance.now() - startedAt);

/**
 * Test sets of AI runs (IKN-95), behind the session guard and its CSRF check like every route that
 * writes. There is no replay route: see `contracts/test-sets.ts`.
 */
@Controller("api/test-sets")
export class TestSetsController {
  constructor(private readonly sets: TestSetsService) {}

  @Get()
  async list(@Query() q: ListQueryDto): Promise<TestSetList> {
    const startedAt = performance.now();
    const sets = await this.sets.list(parseOptionalService(q.service));
    return { sets, meta: { tookMs: elapsed(startedAt) } };
  }

  @Post()
  create(@Body() body: CreateSetDto): Promise<TestSetSummary> {
    return this.sets.create(body.service.trim(), body.name);
  }

  @Get(":id")
  async detail(@Param("id") id: string): Promise<TestSetDetail> {
    const startedAt = performance.now();
    const detail = await this.sets.detail(parseId(id));
    return { ...detail, meta: { tookMs: elapsed(startedAt) } };
  }

  @Delete(":id")
  async remove(@Param("id") id: string): Promise<{ ok: true }> {
    await this.sets.remove(parseId(id));
    return { ok: true };
  }

  @Post(":id/runs")
  addRun(@Param("id") id: string, @Body() body: AddRunDto): Promise<TestSetRun> {
    return this.sets.addRun(parseId(id), parseTraceId(body.traceId));
  }

  @Delete(":id/runs/:runId")
  async removeRun(@Param("id") id: string, @Param("runId") runId: string): Promise<{ ok: true }> {
    await this.sets.removeRun(parseId(id), parseId(runId));
    return { ok: true };
  }
}
