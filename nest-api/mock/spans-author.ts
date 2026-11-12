import type { CorpusAttr, CorpusEvent, CorpusRun, CorpusService, CorpusSpan } from "./interfaces/spanCorpusTypes";

/**
 * The AI pipeline runs of the mock corpus (IKN-90): fourteen days of runs for three fronts of the
 * invented fleet, shaped exactly as Officina's telemetry exports them (OPI-36, `genAiSpans` in
 * `packages/trace/src/telemetry/`): `buildTrace`'s tree — run › node › attempt › `chat <model>` |
 * `gate.verdict` | `execute_tool sandbox` | `human.review` — under the GenAI conventions, a gate's
 * verdict also sent as `gen_ai.evaluation.result` events (the overall one, then one per failed rule),
 * a person's decision as an `officina.human.feedback` event, and the prompts, answers, explanations
 * and notes only on the runs traced at the `full` level.
 *
 * Called by `author.ts` only; its own seeded PRNG, so adding it changed nothing in the rest of the
 * corpus. Fourteen days because that is the production retention: the parser refuses an older span.
 *
 * The story the data tells, so the screens have something true to show:
 * - `fathom-front`'s spec prompt goes from v13 to v14 — a 20 % canary nine days back, all traffic six
 *   days back. v14 fails the "testable criteria" gate more often, trips a new "local only" gate,
 *   and human approval falls from ~79 % to ~62 %. A handful of v14 runs try a bigger model.
 * - Its codegen model moves from the q4f32 to the q4f16 build eleven days back, with a pipeline
 *   version bump; the sandbox tests fail less after it.
 * - The newest flagship run is still going: its open spans end at the reference instant.
 * - About a quarter of the runs carry their prompts and responses (full telemetry).
 */

const DAY = 86_400_000;
const DAYS = 14;

/** mulberry32, as `author.ts` — seeded with this ticket's number. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(90);
const chance = (p: number): boolean => rand() < p;
const between = (lo: number, hi: number): number => lo + rand() * (hi - lo);
const int = (lo: number, hi: number): number => Math.floor(between(lo, hi + 1));

function gauss(): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

const lognormal = (median: number, sigma: number): number => median * Math.exp(sigma * gauss());

function hex(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += "0123456789abcdef"[Math.floor(rand() * 16)];
  return out;
}

/* ── Officina's vocabulary — `packages/trace/src/constants.ts` and `engine/src/kinds/constants.ts` ── */

const ATTR = {
  operation: "gen_ai.operation.name",
  agentName: "gen_ai.agent.name",
  model: "gen_ai.request.model",
  provider: "gen_ai.provider.name",
  inputTokens: "gen_ai.usage.input_tokens",
  outputTokens: "gen_ai.usage.output_tokens",
  timeToFirstChunk: "gen_ai.response.time_to_first_chunk",
  toolName: "gen_ai.tool.name",
  toolType: "gen_ai.tool.type",
  evaluationName: "gen_ai.evaluation.name",
  evaluationLabel: "gen_ai.evaluation.score.label",
  evaluationScore: "gen_ai.evaluation.score.value",
  /* Content: only on runs traced at `full`. */
  evaluationExplanation: "gen_ai.evaluation.explanation",
  inputMessages: "gen_ai.input.messages",
  outputMessages: "gen_ai.output.messages",
  systemInstructions: "gen_ai.system_instructions",
  humanNote: "officina.human.note",
  tokensPerSecond: "officina.tokens_per_second",
  firstTokenMs: "officina.first_token_ms",
  nodeId: "officina.node.id",
  nodeKind: "officina.node.kind",
  attempt: "officina.attempt",
  pipelineVersion: "officina.pipeline.version",
  promptVersion: "gen_ai.prompt.version",
  attempts: "officina.node.attempts",
  ruleIndex: "officina.gate.rule_index",
  modelLoadMs: "officina.model.load_ms",
  gpuVendor: "officina.gpu.vendor",
  gpuArchitecture: "officina.gpu.architecture",
  cacheHit: "officina.cache.hit",
  cacheKey: "officina.cache.key",
  verdictPass: "officina.gate.pass",
  verdictScore: "officina.gate.score",
  verdictReasons: "officina.gate.reasons",
  decision: "officina.human.decision",
  loopIteration: "officina.loop.iteration",
  loopTarget: "officina.loop.target",
  runStatus: "officina.run.status",
} as const;

const NODE_KIND = {
  llm: "llm",
  ruleGate: "rule-gate",
  schemaGate: "schema-gate",
  humanGate: "human-gate",
  codeExec: "code-exec",
} as const;

const DECISION = { approve: "approve", edit: "edit", reject: "reject" } as const;
const OPERATION = { chat: "chat", invokeWorkflow: "invoke_workflow", executeTool: "execute_tool" } as const;
const EVENT_NAME = { evaluation: "gen_ai.evaluation.result", humanFeedback: "officina.human.feedback" } as const;
const EVALUATION_LABEL = { pass: "pass", fail: "fail" } as const;
const SANDBOX_TOOL = "sandbox";
const RUN_STATUS = { running: "running", completed: "completed" } as const;
const STATUS = { unset: 0, ok: 1, error: 2 } as const;

const PROVIDER = "webllm";

const MODEL = {
  coder16: "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC",
  coder32: "Qwen2.5-Coder-7B-Instruct-q4f32_1-MLC",
  small: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
  large: "Llama-3.1-8B-Instruct-q4f16_1-MLC",
  phi: "Phi-3.5-mini-instruct-q4f16_1-MLC",
} as const;

/** Generation speed per model, tokens per second — what the "tokens per second" row compares. */
const SPEED: Record<string, number> = {
  [MODEL.coder16]: 200,
  [MODEL.coder32]: 132,
  [MODEL.small]: 270,
  [MODEL.large]: 160,
  [MODEL.phi]: 230,
};

/* ── building one run ─────────────────────────────────────────────────────────────────────────── */

type Run = {
  traceId: string;
  spans: CorpusSpan[];
  /** Where the next span starts, epoch ms. */
  cursor: number;
  /** Full telemetry: model spans carry their messages. */
  capture: boolean;
  pipelineVersion: number;
  /** A run still going stops here; its open spans end at this instant. */
  stopAt: number;
  stopped: boolean;
};

type SpanDraft = {
  id: string;
  parent: string;
  name: string;
  start: number;
  end: number;
  status: number;
  attrs: Record<string, CorpusAttr>;
  events?: CorpusEvent[];
};

function push(run: Run, draft: SpanDraft): void {
  const end = Math.min(draft.end, run.stopAt);
  run.spans.push([
    draft.id,
    draft.parent,
    draft.name,
    Math.round(draft.start),
    Math.round(end),
    draft.status,
    draft.attrs,
    draft.events ?? [],
  ]);
}

/** Moves the run's clock, and stops it at `stopAt` — what makes the newest run an open one. */
function advance(run: Run, ms: number): number {
  run.cursor += ms;
  if (run.cursor >= run.stopAt) run.stopped = true;
  return run.cursor;
}

type ModelCall = {
  parent: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  messages: Conversation;
};

type Conversation = {
  system: string;
  user: string;
  answer: string;
};

/** The conventions' shapes, as `genAiSpans` writes them: system instructions apart, the rest as role + parts. */
function messagesJson(conversation: Conversation) {
  const part = (content: string) => [{ type: "text", content }];
  return {
    system: JSON.stringify(part(conversation.system)),
    input: JSON.stringify([{ role: "user", parts: part(conversation.user) }]),
    output: JSON.stringify([{ role: "assistant", parts: part(conversation.answer), finish_reason: "stop" }]),
  };
}

function modelCall(run: Run, call: ModelCall): void {
  const start = advance(run, between(20, 120));
  const firstTokenMs = Math.round(lognormal(1150, 0.25));
  const speed = SPEED[call.model] * between(0.85, 1.12);
  const generationMs = (call.completionTokens / speed) * 1000;
  const end = advance(run, firstTokenMs + generationMs);
  const attrs: Record<string, CorpusAttr> = {
    [ATTR.operation]: OPERATION.chat,
    [ATTR.timeToFirstChunk]: firstTokenMs / 1000,
    [ATTR.model]: call.model,
    [ATTR.provider]: PROVIDER,
    [ATTR.inputTokens]: call.promptTokens,
    [ATTR.outputTokens]: call.completionTokens,
    [ATTR.firstTokenMs]: firstTokenMs,
    [ATTR.tokensPerSecond]: Math.round(speed * 10) / 10,
  };
  if (run.capture) {
    const json = messagesJson(call.messages);
    attrs[ATTR.systemInstructions] = json.system;
    attrs[ATTR.inputMessages] = json.input;
    attrs[ATTR.outputMessages] = json.output;
  }
  push(run, { id: hex(16), parent: call.parent, name: `chat ${call.model}`, start, end, status: STATUS.ok, attrs });
}

/* ── the pipelines ────────────────────────────────────────────────────────────────────────────── */

type LlmNode = {
  id: string;
  label: string;
  prompt: number;
  model: string;
  /** Median prompt and completion sizes. */
  promptTokens: number;
  completionTokens: number;
  conversation: Conversation;
  /** Code generation runs its output in the sandbox after the model call. */
  sandbox: boolean;
};

type GateNode = {
  id: string;
  label: string;
  kind: string;
  /** Chance one attempt passes. */
  pass: number;
  /** What a failing verdict says, one reason per broken rule — Officina's gates answer in free text. */
  reasons: string[];
};

/**
 * A verdict as `genAiSpans` sends it: the gate's overall `gen_ai.evaluation.result`, then — when it
 * failed — one per reason, carrying its rule index. The explanations are content: `full` runs only.
 */
function evaluationEvents(run: Run, verdict: Verdict): CorpusEvent[] {
  const overall: CorpusEvent = [
    verdict.at,
    EVENT_NAME.evaluation,
    {
      [ATTR.evaluationName]: verdict.gate.id,
      [ATTR.evaluationLabel]: verdict.ok ? EVALUATION_LABEL.pass : EVALUATION_LABEL.fail,
      [ATTR.evaluationScore]: verdict.score,
      ...(run.capture && verdict.reasons.length > 0
        ? { [ATTR.evaluationExplanation]: verdict.reasons.join("; ") }
        : {}),
    },
  ];
  const rules: CorpusEvent[] = verdict.ok
    ? []
    : verdict.reasons.map((reason, index) => [
        verdict.at,
        EVENT_NAME.evaluation,
        {
          [ATTR.evaluationName]: verdict.gate.id,
          [ATTR.evaluationLabel]: EVALUATION_LABEL.fail,
          [ATTR.evaluationScore]: 0,
          [ATTR.ruleIndex]: index,
          ...(run.capture ? { [ATTR.evaluationExplanation]: reason } : {}),
        },
      ]);
  return [overall, ...rules];
}

type Verdict = {
  gate: GateNode;
  at: number;
  ok: boolean;
  score: number;
  reasons: string[];
};

/** One to three of the gate's reasons, distinct, in the gate's own order. */
function pickReasons(gate: GateNode): string[] {
  const count = Math.min(gate.reasons.length, int(1, 3));
  const picked = new Set<number>();
  while (picked.size < count) picked.add(int(0, gate.reasons.length - 1));
  return [...picked].sort((a, b) => a - b).map((index) => gate.reasons[index]);
}

type GuardedStep = {
  node: LlmNode;
  gates: GateNode[];
  maxAttempts: number;
};

/** One step and the gates guarding it, retried until they pass or the attempts run out. */
function guardedStep(run: Run, parent: string, step: GuardedStep): boolean {
  const nodeId = hex(16);
  const gateIds = step.gates.map(() => hex(16));
  const nodeStart = run.cursor;
  const gateStarts: number[] = step.gates.map(() => Number.NaN);
  let passed = false;
  let attempts = 0;
  const failedLast = step.gates.map(() => false);

  for (let attempt = 1; attempt <= step.maxAttempts && !run.stopped; attempt++) {
    attempts = attempt;
    const attemptId = hex(16);
    const attemptStart = advance(run, between(5, 40));
    const promptTokens = Math.round(lognormal(step.node.promptTokens, 0.18) * (attempt > 1 ? 1.25 : 1));
    const completionTokens = Math.round(lognormal(step.node.completionTokens, 0.22));
    modelCall(run, {
      parent: attemptId,
      model: step.node.model,
      promptTokens,
      completionTokens,
      messages: step.node.conversation,
    });
    if (step.node.sandbox && !run.stopped) {
      const sandboxStart = advance(run, between(10, 60));
      const sandboxEnd = advance(run, lognormal(2400, 0.3));
      push(run, {
        id: hex(16),
        parent: attemptId,
        name: `${OPERATION.executeTool} ${SANDBOX_TOOL}`,
        start: sandboxStart,
        end: sandboxEnd,
        status: STATUS.ok,
        attrs: { [ATTR.operation]: OPERATION.executeTool, [ATTR.toolName]: SANDBOX_TOOL, [ATTR.toolType]: "function" },
      });
    }
    push(run, {
      id: attemptId,
      parent: nodeId,
      name: `${step.node.id} #${attempt}`,
      start: attemptStart,
      end: run.cursor,
      status: STATUS.ok,
      attrs: {
        [ATTR.attempt]: attempt,
        [ATTR.pipelineVersion]: run.pipelineVersion,
        [ATTR.cacheKey]: hex(12),
        [ATTR.model]: step.node.model,
        [ATTR.provider]: PROVIDER,
        [ATTR.promptVersion]: step.node.prompt,
        [ATTR.inputTokens]: promptTokens,
        [ATTR.outputTokens]: completionTokens,
        [ATTR.cacheHit]: false,
        ...(attempt > 1 ? { [ATTR.loopIteration]: attempt - 1 } : {}),
      },
    });

    let allPassed = true;
    step.gates.forEach((gate, index) => {
      if (run.stopped) {
        allPassed = false;
        return;
      }
      const ok = chance(gate.pass);
      failedLast[index] = !ok;
      if (!ok) allPassed = false;
      const gateAttemptId = hex(16);
      const start = advance(run, between(5, 30));
      if (Number.isNaN(gateStarts[index])) gateStarts[index] = start;
      const verdictEnd = advance(run, lognormal(gate.kind === NODE_KIND.schemaGate ? 60 : 280, 0.3));
      const status = ok ? STATUS.ok : STATUS.error;
      const reasons = ok ? [] : pickReasons(gate);
      const score = Math.round((ok ? between(0.82, 0.99) : between(0.3, 0.7)) * 100) / 100;
      push(run, {
        id: hex(16),
        parent: gateAttemptId,
        name: "gate.verdict",
        start: start + 2,
        end: verdictEnd,
        status,
        attrs: {
          [ATTR.verdictPass]: ok,
          [ATTR.verdictReasons]: reasons.length,
          [ATTR.verdictScore]: score,
        },
        events: evaluationEvents(run, { gate, at: start + 2, ok, score, reasons }),
      });
      push(run, {
        id: gateAttemptId,
        parent: gateIds[index],
        name: `${gate.id} #${attempt}`,
        start,
        end: verdictEnd + 1,
        status,
        attrs: {
          [ATTR.attempt]: attempt,
          [ATTR.pipelineVersion]: run.pipelineVersion,
          [ATTR.verdictPass]: ok,
          ...(ok ? {} : { [ATTR.loopTarget]: step.node.id }),
        },
      });
    });
    if (allPassed && !run.stopped) {
      passed = true;
      break;
    }
  }

  push(run, {
    id: nodeId,
    parent,
    name: step.node.label,
    start: nodeStart,
    end: run.cursor,
    status: STATUS.ok,
    attrs: { [ATTR.nodeId]: step.node.id, [ATTR.nodeKind]: NODE_KIND.llm, [ATTR.attempts]: attempts },
  });
  step.gates.forEach((gate, index) => {
    if (Number.isNaN(gateStarts[index])) return;
    push(run, {
      id: gateIds[index],
      parent,
      name: gate.label,
      start: gateStarts[index],
      end: run.cursor,
      status: failedLast[index] ? STATUS.error : STATUS.ok,
      attrs: { [ATTR.nodeId]: gate.id, [ATTR.nodeKind]: gate.kind, [ATTR.attempts]: attempts },
    });
  });
  return passed && attempts > 0;
}

type Review = {
  /** Probabilities of approve and edit; reject takes the rest. */
  approve: number;
  edit: number;
  /** Chance nobody reviewed it at all. */
  skipped: number;
};

function humanReview(run: Run, parent: string, review: Review): void {
  if (run.stopped || chance(review.skipped)) return;
  const nodeId = hex(16);
  const attemptId = hex(16);
  const start = advance(run, between(50, 200));
  const waitEnd = advance(run, lognormal(240_000, 0.6));
  const roll = rand();
  const decision =
    roll < review.approve ? DECISION.approve : roll < review.approve + review.edit ? DECISION.edit : DECISION.reject;
  const status = decision === DECISION.reject ? STATUS.error : STATUS.ok;
  push(run, {
    id: hex(16),
    parent: attemptId,
    name: "human.review",
    start: start + 5,
    end: waitEnd,
    status,
    attrs: { [ATTR.decision]: decision },
    events: [
      [
        waitEnd,
        EVENT_NAME.humanFeedback,
        {
          [ATTR.decision]: decision,
          [ATTR.nodeId]: "review",
          ...(run.capture && decision !== DECISION.approve ? { [ATTR.humanNote]: REVIEW_NOTES[decision] } : {}),
        },
      ],
    ],
  });
  push(run, {
    id: attemptId,
    parent: nodeId,
    name: "review #1",
    start,
    end: waitEnd + 3,
    status,
    attrs: { [ATTR.attempt]: 1, [ATTR.pipelineVersion]: run.pipelineVersion },
  });
  push(run, {
    id: nodeId,
    parent,
    name: "Human review",
    start,
    end: waitEnd + 4,
    status,
    attrs: { [ATTR.nodeId]: "review", [ATTR.nodeKind]: NODE_KIND.humanGate },
  });
}

/** What a reviewer writes when they do not simply approve — content, `full` runs only. */
const REVIEW_NOTES: Record<string, string> = {
  [DECISION.edit]: "Tightened two acceptance criteria so a test can check them.",
  [DECISION.reject]: "The spec keeps a fallback to a hosted model and its criteria are still vague.",
};

/** Each gate's rules, as the free-text reasons a failing verdict gives. */
const REASONS = {
  planSchema: ["missing field: tasks[2].depends_on", "tasks is longer than 8"],
  specTestable: [
    '3 of 9 acceptance criteria are not checkable ("should", "if possible")',
    "criterion 4 names no observable outcome",
    "no criterion covers the empty filter",
  ],
  specLocal: ["§4.2 falls back to a hosted model API", "a dependency fetches a remote model at runtime"],
  codeTests: ["2 of 24 tests fail: export.spec.ts", "tsc --strict: 1 error (TS2322)"],
  triageSchema: ["severity is not one of minor, major, critical"],
  recordSchema: ["lines[].total is not a number", "supplier is missing"],
  totals: ["line totals add up to 1 248.00, the document says 1 284.00"],
} as const;

/* ── per pipeline: which prompt, which model, how likely each gate passes, on a given day ──────── */

/** Days before the reference instant, as a fraction: 0 is the newest moment. */
type Moment = {
  daysAgo: number;
};

const CONVERSATIONS = {
  intake: {
    system: "Classify the request and extract the objective. Answer in JSON.",
    user: "Add a CSV export of the filtered invoices.",
    answer: '{ "type": "feature", "objective": "CSV export of filtered invoices", "language": "en" }',
  },
  plan: {
    system: "Split the objective into ordered tasks, plan@2 schema.",
    user: "Objective: CSV export of the filtered invoices.",
    answer: '{ "tasks": ["export route", "CSV service", "spec", "UI button", "e2e tests"] }',
  },
  spec: {
    system:
      "You write the functional specification, spec@3 JSON. Every acceptance criterion must be checkable by an automated test. Local models only.",
    user: "Task 3/5 of the plan: CSV export of the filtered invoices. Context: invoices table, 12 columns, server pagination, date and status filters.",
    answer:
      '{\n  "title": "CSV export of filtered invoices",\n  "acceptance": [\n    "GET /invoices/export answers text/csv",\n    "The date and status filters apply",\n    "The export should stay fast on large volumes"\n  ]\n}',
  },
  codegen: {
    system: "Implement the specification in strict TypeScript.",
    user: "<spec spec@3>",
    answer:
      "@Get('export')\n@Header('Content-Type', 'text/csv')\nasync export(@Query() q: InvoiceFilterDto) {\n  const rows = await this.invoices.find(q);\n  return toCsv(rows, INVOICE_COLUMNS);\n}",
  },
  triage: {
    system: "Triage the incoming ticket: severity, component, duplicate of.",
    user: "The dashboard shows yesterday's totals after midnight.",
    answer: '{ "severity": "minor", "component": "dashboard", "duplicateOf": null }',
  },
  extract: {
    system: "Extract the structured record from the document, record@2 schema.",
    user: "<scanned delivery note, 2 pages>",
    answer: '{ "supplier": "…", "lines": 14, "total": "1 284.00" }',
  },
} satisfies Record<string, Conversation>;

function specVersion(at: Moment): number {
  if (at.daysAgo > 9) return 13;
  if (at.daysAgo > 6) return chance(0.2) ? 14 : 13;
  return 14;
}

function fathomRun(run: Run, at: Moment): void {
  const rootId = hex(16);
  const rootStart = run.cursor;
  const spec = specVersion(at);
  const specModel = spec === 14 && chance(0.06) ? MODEL.large : MODEL.coder16;
  const codegenModel = at.daysAgo > 11 ? MODEL.coder32 : MODEL.coder16;

  guardedStep(run, rootId, {
    node: {
      id: "intake",
      label: "Intake",
      prompt: 3,
      model: MODEL.small,
      promptTokens: 410,
      completionTokens: 180,
      conversation: CONVERSATIONS.intake,
      sandbox: false,
    },
    gates: [],
    maxAttempts: 1,
  });
  guardedStep(run, rootId, {
    node: {
      id: "plan",
      label: "Plan",
      prompt: 8,
      model: MODEL.coder16,
      promptTokens: 1840,
      completionTokens: 1020,
      conversation: CONVERSATIONS.plan,
      sandbox: false,
    },
    gates: [
      {
        id: "plan-schema",
        label: "Plan schema",
        kind: NODE_KIND.schemaGate,
        pass: 0.985,
        reasons: [...REASONS.planSchema],
      },
    ],
    maxAttempts: 2,
  });
  guardedStep(run, rootId, {
    node: {
      id: "spec",
      label: "Spec",
      prompt: spec,
      model: specModel,
      promptTokens: spec === 14 ? 2600 : 2300,
      completionTokens: spec === 14 ? 900 : 800,
      conversation: CONVERSATIONS.spec,
      sandbox: false,
    },
    gates: [
      {
        id: "spec-testable",
        label: "Testable criteria",
        kind: NODE_KIND.ruleGate,
        pass: spec === 14 ? (specModel === MODEL.large ? 0.82 : 0.74) : 0.93,
        reasons: [...REASONS.specTestable],
      },
      {
        id: "spec-local-only",
        label: "Local models only",
        kind: NODE_KIND.ruleGate,
        pass: spec === 14 ? 0.9 : 0.995,
        reasons: [...REASONS.specLocal],
      },
    ],
    maxAttempts: 2,
  });
  guardedStep(run, rootId, {
    node: {
      id: "codegen",
      label: "Codegen",
      prompt: 11,
      model: codegenModel,
      promptTokens: 3400,
      completionTokens: 2600,
      conversation: CONVERSATIONS.codegen,
      sandbox: true,
    },
    gates: [
      {
        id: "code-tests",
        label: "Tests pass",
        kind: NODE_KIND.ruleGate,
        pass: codegenModel === MODEL.coder32 ? 0.9 : 0.95,
        reasons: [...REASONS.codeTests],
      },
    ],
    maxAttempts: 2,
  });

  /* A gate node ends in error only when its last attempt failed — the run's checks failed. */
  const GATE_KINDS: string[] = [NODE_KIND.ruleGate, NODE_KIND.schemaGate];
  const lastGatesFailed = run.spans.some(
    (span) => GATE_KINDS.includes(String(span[6][ATTR.nodeKind])) && span[5] === STATUS.error,
  );
  const v14 = spec === 14;
  humanReview(
    run,
    rootId,
    lastGatesFailed
      ? { approve: 0.3, edit: 0.25, skipped: 0.15 }
      : v14
        ? { approve: 0.64, edit: 0.2, skipped: 0.15 }
        : { approve: 0.8, edit: 0.12, skipped: 0.15 },
  );
  closeRun(run, { rootId, rootStart, name: "spec-to-code" });
}

function galeRun(run: Run, at: Moment): void {
  const rootId = hex(16);
  const rootStart = run.cursor;
  guardedStep(run, rootId, {
    node: {
      id: "triage",
      label: "Triage",
      prompt: 6,
      model: MODEL.small,
      promptTokens: 980,
      completionTokens: 260,
      conversation: CONVERSATIONS.triage,
      sandbox: false,
    },
    gates: [
      {
        id: "triage-schema",
        label: "Triage schema",
        kind: NODE_KIND.schemaGate,
        pass: 0.97,
        reasons: [...REASONS.triageSchema],
      },
    ],
    maxAttempts: 2,
  });
  guardedStep(run, rootId, {
    node: {
      id: "dedupe",
      label: "Duplicate check",
      prompt: at.daysAgo > 4 ? 2 : 3,
      model: MODEL.small,
      promptTokens: 1500,
      completionTokens: 120,
      conversation: CONVERSATIONS.triage,
      sandbox: false,
    },
    gates: [],
    maxAttempts: 1,
  });
  humanReview(run, rootId, { approve: 0.84, edit: 0.1, skipped: 0.3 });
  closeRun(run, { rootId, rootStart, name: "ticket-triage" });
}

function dovetailRun(run: Run, at: Moment): void {
  const rootId = hex(16);
  const rootStart = run.cursor;
  guardedStep(run, rootId, {
    node: {
      id: "extract",
      label: "Extract",
      prompt: 9,
      model: MODEL.phi,
      promptTokens: 3100,
      completionTokens: 640,
      conversation: CONVERSATIONS.extract,
      sandbox: false,
    },
    gates: [
      {
        id: "record-schema",
        label: "Record schema",
        kind: NODE_KIND.schemaGate,
        pass: 0.96,
        reasons: [...REASONS.recordSchema],
      },
      {
        id: "totals-consistent",
        label: "Totals add up",
        kind: NODE_KIND.ruleGate,
        pass: at.daysAgo < 2 ? 0.8 : 0.92,
        reasons: [...REASONS.totals],
      },
    ],
    maxAttempts: 3,
  });
  humanReview(run, rootId, { approve: 0.77, edit: 0.17, skipped: 0.2 });
  closeRun(run, { rootId, rootStart, name: "document-extract" });
}

type RunRoot = {
  rootId: string;
  rootStart: number;
  name: string;
};

function closeRun(run: Run, root: RunRoot): void {
  const end = run.stopped ? run.stopAt : advance(run, between(5, 30));
  push(run, {
    id: root.rootId,
    parent: "",
    name: `${OPERATION.invokeWorkflow} ${root.name}`,
    start: root.rootStart,
    end,
    status: STATUS.ok,
    attrs: {
      [ATTR.operation]: OPERATION.invokeWorkflow,
      [ATTR.agentName]: root.name,
      [ATTR.pipelineVersion]: run.pipelineVersion,
      [ATTR.runStatus]: run.stopped ? RUN_STATUS.running : RUN_STATUS.completed,
      /* What going live learnt, on the root: the model's load time and the GPU. */
      [ATTR.modelLoadMs]: Math.round(lognormal(3800, 0.4)),
      [ATTR.gpuVendor]: GPU[0],
      [ATTR.gpuArchitecture]: GPU[1],
    },
  });
}

/** The one GPU the mock fleet's browsers report. */
const GPU = ["apple", "metal-3"] as const;

/* ── the schedule ─────────────────────────────────────────────────────────────────────────────── */

type Pipeline = {
  service: string;
  perDay: number;
  pipelineVersion: (at: Moment) => number;
  build: (run: Run, at: Moment) => void;
};

const PIPELINES: Pipeline[] = [
  { service: "fathom-front", perDay: 30, pipelineVersion: (at) => (at.daysAgo > 11 ? 7 : 8), build: fathomRun },
  { service: "gale-front", perDay: 11, pipelineVersion: () => 4, build: galeRun },
  { service: "dovetail-front", perDay: 8, pipelineVersion: (at) => (at.daysAgo > 4 ? 2 : 3), build: dovetailRun },
];

/** Working hours carry most runs: 07:00–23:00 UTC, nothing at night. */
function startOfRun(dayStart: number): number {
  return dayStart + between(7, 23) * 3_600_000;
}

export function authorSpans(referenceMs: number): CorpusService[] {
  return PIPELINES.map((pipeline, index) => {
    const starts: number[] = [];
    for (let day = DAYS; day >= 1; day--) {
      const dayStart = Math.floor((referenceMs - day * DAY) / DAY) * DAY + DAY;
      const count = Math.max(1, Math.round(pipeline.perDay * between(0.75, 1.25)));
      for (let i = 0; i < count; i++) {
        const start = startOfRun(dayStart);
        if (start < referenceMs - 5 * 60_000 && start > referenceMs - DAYS * DAY) starts.push(start);
      }
    }
    /* The flagship's newest run is the one still going. */
    if (index === 0) starts.push(referenceMs - 34_000);
    starts.sort((a, b) => a - b);

    const runs: CorpusRun[] = starts.map((start) => {
      const at: Moment = { daysAgo: (referenceMs - start) / DAY };
      const run: Run = {
        traceId: hex(32),
        spans: [],
        cursor: start,
        capture: chance(0.27),
        pipelineVersion: pipeline.pipelineVersion(at),
        stopAt: referenceMs,
        stopped: false,
      };
      pipeline.build(run, at);
      run.spans.sort((a, b) => a[3] - b[3]);
      return { traceId: run.traceId, spans: run.spans };
    });
    return { service: pipeline.service, runs };
  });
}
