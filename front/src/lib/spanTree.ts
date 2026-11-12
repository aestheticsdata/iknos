import type { SpanNode, SpanRow, WaterfallLine } from "@lib/interfaces/traceSpanTypes";

/**
 * The span tree of one trace, from the flat list the API returns (IKN-87).
 *
 * The tree is rebuilt from `parentSpanId` alone. A span whose parent is not in the list — the
 * exporter dropped it, the API rejected it, the tab closed before it ended, or it started outside
 * the window — is **promoted to a root and marked**, never hidden: losing a child because its
 * parent is missing would make the run look shorter and calmer than it was.
 *
 * Siblings are ordered by start, then by span id, so the same trace always draws the same way.
 */

const byStart = (a: SpanNode, b: SpanNode): number =>
  a.span.startUs - b.span.startUs || a.span.spanId.localeCompare(b.span.spanId);

export const buildSpanTree = (spans: SpanRow[]): SpanNode[] => {
  const nodes = new Map<string, SpanNode>();
  for (const span of spans) {
    // A duplicate id keeps the first — the API never sends one, but a tree with a node in two
    // places would recurse forever.
    if (!nodes.has(span.spanId)) nodes.set(span.spanId, { span, children: [] });
  }

  const roots: SpanNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.span.parentSpanId;
    const parent = parentId === null || parentId === node.span.spanId ? undefined : nodes.get(parentId);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }

  // A cycle (a → b → a) leaves its members under no root at all. Rare and malformed, but every
  // span must be drawn, so the earliest member of each unreached group becomes a root.
  const reached = new Set<string>();
  // Iterative, like `flattenTree`: a chain two thousand spans deep must not overflow the stack.
  const mark = (start: SpanNode) => {
    const stack = [start];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === undefined || reached.has(node.span.spanId)) continue;
      reached.add(node.span.spanId);
      stack.push(...node.children);
    }
  };
  for (const root of roots) mark(root);
  const stranded = [...nodes.values()].filter((node) => !reached.has(node.span.spanId)).sort(byStart);
  for (const node of stranded) {
    if (reached.has(node.span.spanId)) continue;
    roots.push(node);
    mark(node);
  }

  roots.sort(byStart);
  for (const node of nodes.values()) node.children.sort(byStart);
  return roots;
};

/**
 * Depth-first, parents before children — the order the waterfall reads top to bottom. Iterative,
 * so a pathological chain of two thousand spans cannot overflow the stack.
 */
export const flattenTree = (roots: SpanNode[]): WaterfallLine[] => {
  const lines: WaterfallLine[] = [];
  const seen = new Set<string>();
  const stack = [...roots].reverse().map((node) => ({ node, depth: 0 }));

  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined) break;
    const { node, depth } = next;
    if (seen.has(node.span.spanId)) continue;
    seen.add(node.span.spanId);

    lines.push({ span: node.span, depth, orphan: depth === 0 && node.span.parentSpanId !== null });
    for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i], depth: depth + 1 });
  }
  return lines;
};

/** The waterfall's rows for a trace, in one call. */
export const waterfallLines = (spans: SpanRow[]): WaterfallLine[] => flattenTree(buildSpanTree(spans));
