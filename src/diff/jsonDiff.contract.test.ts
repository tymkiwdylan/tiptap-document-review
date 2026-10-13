import { describe, expect, it } from "vitest";
import { buildServerSchema } from "../tiptap/schema";
import {
  buildContentWithJsonChanges,
  createJsonDiff,
} from "./jsonDiff";
import { buildTrackedDocument } from "./trackedDocument";

type JsonMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

type JsonNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  marks?: JsonMark[];
  text?: string;
};

type Decision = "accept" | "reject";

const schema = buildServerSchema();

const text = (value: string): JsonNode => ({ type: "text", text: value });

const paragraph = (...content: JsonNode[]): JsonNode => ({
  type: "paragraph",
  ...(content.length > 0 ? { content } : {}),
});

const doc = (...content: JsonNode[]): JsonNode => ({
  type: "doc",
  content,
});

const hardBreak = (): JsonNode => ({ type: "hardBreak" });

const image = (width: number): JsonNode => ({
  type: "image",
  attrs: {
    src: "https://example.test/evidence.png",
    alt: "Evidencia",
    title: null,
    assetId: "asset-1",
    width,
    height: 80,
  },
});

const tableCell = (value: string): JsonNode => ({
  type: "tableCell",
  content: [paragraph(text(value))],
});

const tableRow = (left: string, right: string): JsonNode => ({
  type: "tableRow",
  content: [tableCell(left), tableCell(right)],
});

const table = (...rows: JsonNode[]): JsonNode => ({
  type: "table",
  content: rows,
});

/**
 * Test-only semantic projection of the public tracked-document format.
 *
 * The helper deliberately knows only the three review node types and their
 * documented added/deleted meaning. It does not call portal internals.
 */
const projectNode = (node: JsonNode, decision: Decision): JsonNode[] => {
  const changeType = node.attrs?.changeType;
  const isAdded = changeType === "added";
  const isDeleted = changeType === "deleted";
  const shouldKeep =
    (decision === "accept" && isAdded) ||
    (decision === "reject" && isDeleted);

  if (node.type === "lineBreakChange") {
    return shouldKeep ? [hardBreak()] : [];
  }

  if (node.type === "inlineChange" || node.type === "blockChange") {
    if (!shouldKeep) {
      return [];
    }

    return (node.content ?? []).flatMap((child) =>
      projectNode(child, decision),
    );
  }

  if (!node.content) {
    return [{ ...node }];
  }

  return [
    {
      ...node,
      content: node.content.flatMap((child) => projectNode(child, decision)),
    },
  ];
};

const materialize = (tracked: JsonNode, decision: Decision): JsonNode => {
  const projected = projectNode(tracked, decision);
  expect(projected).toHaveLength(1);
  return projected[0];
};

const collectDecisionGroupIds = (node: JsonNode): Set<string> => {
  const ids = new Set<string>();

  if (
    (node.type === "inlineChange" ||
      node.type === "blockChange" ||
      node.type === "lineBreakChange") &&
    typeof node.attrs?.changeId === "string"
  ) {
    ids.add(node.attrs.changeId);
  }

  for (const child of node.content ?? []) {
    for (const id of collectDecisionGroupIds(child)) {
      ids.add(id);
    }
  }

  return ids;
};

const canonicalizeAndValidate = (value: JsonNode): unknown => {
  const parsed = schema.nodeFromJSON(value);
  parsed.check();
  return parsed.toJSON();
};

const countTrackedNodes = (value: unknown): number => {
  if (typeof value !== "object" || value === null) {
    return 0;
  }

  const ownCount =
    "type" in value &&
    (value.type === "inlineChange" ||
      value.type === "blockChange" ||
      value.type === "lineBreakChange")
      ? 1
      : 0;

  if (!("content" in value) || !Array.isArray(value.content)) {
    return ownCount;
  }

  return (
    ownCount +
    value.content.reduce(
      (total, child) => total + countTrackedNodes(child),
      0,
    )
  );
};

const largeDocument = (
  paragraphCount: number,
  contentForIndex: (index: number) => string,
): JsonNode =>
  doc(
    ...Array.from({ length: paragraphCount }, (_, index) =>
      paragraph(text(contentForIndex(index))),
    ),
  );

const expectReversibleTrackedDiff = (
  original: JsonNode,
  revised: JsonNode,
): JsonNode => {
  const delta = createJsonDiff(original, revised);
  expect(delta, "a semantic edit must produce a delta").toBeDefined();

  const tracked = buildContentWithJsonChanges(original, revised, delta);
  canonicalizeAndValidate(tracked);

  expect(canonicalizeAndValidate(materialize(tracked, "accept"))).toEqual(
    canonicalizeAndValidate(revised),
  );
  expect(canonicalizeAndValidate(materialize(tracked, "reject"))).toEqual(
    canonicalizeAndValidate(original),
  );

  return tracked;
};

describe("escritos diff engine reversible tracked-document contract", () => {
  it("projects a simple text replacement to the revised or original document", () => {
    expectReversibleTrackedDiff(
      doc(paragraph(text("La demanda fue presentada."))),
      doc(paragraph(text("La demanda fue contestada."))),
    );
  });

  it("tracks a hard break insertion without silently accepting it", () => {
    expectReversibleTrackedDiff(
      doc(paragraph(text("Primera líneaSegunda línea"))),
      doc(
        paragraph(
          text("Primera línea"),
          hardBreak(),
          text("Segunda línea"),
        ),
      ),
    );
  });

  it("tracks a hard break deletion without silently accepting it", () => {
    expectReversibleTrackedDiff(
      doc(
        paragraph(
          text("Primera línea"),
          hardBreak(),
          text("Segunda línea"),
        ),
      ),
      doc(paragraph(text("Primera líneaSegunda línea"))),
    );
  });

  it("tracks insertion of an empty paragraph", () => {
    expectReversibleTrackedDiff(
      doc(paragraph(text("Uno")), paragraph(text("Dos"))),
      doc(paragraph(text("Uno")), paragraph(), paragraph(text("Dos"))),
    );
  });

  it("tracks deletion of an empty paragraph", () => {
    expectReversibleTrackedDiff(
      doc(paragraph(text("Uno")), paragraph(), paragraph(text("Dos"))),
      doc(paragraph(text("Uno")), paragraph(text("Dos"))),
    );
  });

  it("tracks an image attribute edit as one reversible semantic change", () => {
    const tracked = expectReversibleTrackedDiff(
      doc(paragraph(image(120))),
      doc(paragraph(image(240))),
    );

    expect(collectDecisionGroupIds(tracked).size).toBe(1);
  });

  it("does not duplicate a colliding table row when a repeated row is inserted", () => {
    expectReversibleTrackedDiff(
      doc(
        table(
          tableRow("Hecho primero", "Sin observaciones"),
          tableRow("Hecho primero", "Observado"),
        ),
      ),
      doc(
        table(
          tableRow("Hecho primero", "Sin observaciones"),
          tableRow("Hecho primero", "Sin observaciones"),
          tableRow("Hecho primero", "Observado"),
        ),
      ),
    );
  });

  it("preserves whitespace and Unicode edits exactly", () => {
    expectReversibleTrackedDiff(
      doc(paragraph(text("Artículo 1: accion"))),
      doc(paragraph(text("Artículo\u00a01: acción"))),
    );
  });

  it("produces deterministic tracked JSON for the same inputs", () => {
    const original = doc(paragraph(text("Texto original")));
    const revised = doc(paragraph(text("Texto revisado")));
    const delta = createJsonDiff(original, revised);

    expect(delta).toBeDefined();
    expect(buildContentWithJsonChanges(original, revised, delta)).toEqual(
      buildContentWithJsonChanges(original, revised, delta),
    );
  });
});

describe("escritos tracked-document performance contract", () => {
  it("builds a sparse edit across 2,000 paragraphs in under 500ms", () => {
    const paragraphCount = 2_000;
    const changedIndex = 1_000;
    const original = largeDocument(
      paragraphCount,
      (index) => `Párrafo legal ${index}: contenido estable.`,
    );
    const revised = largeDocument(paragraphCount, (index) =>
      index === changedIndex
        ? `Párrafo legal ${index}: contenido revisado.`
        : `Párrafo legal ${index}: contenido estable.`,
    );

    const startedAt = performance.now();
    const result = buildTrackedDocument(original, revised);
    const elapsedMs = performance.now() - startedAt;

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.status).toBe("tracked");
    expect(result.changeIds).toHaveLength(1);
    expect(result.changeCount).toBe(1);
    expect(elapsedMs).toBeLessThan(500);
  });

  it("keeps a dense 2,000-paragraph rewrite fast and bounded", () => {
    const paragraphCount = 2_000;
    const original = largeDocument(
      paragraphCount,
      (index) => `Versión original del párrafo legal ${index}.`,
    );
    const revised = largeDocument(
      paragraphCount,
      (index) => `Versión íntegramente revisada del párrafo legal ${index}.`,
    );
    const sourceBytes =
      JSON.stringify(canonicalizeAndValidate(original)).length +
      JSON.stringify(canonicalizeAndValidate(revised)).length;

    const startedAt = performance.now();
    const result = buildTrackedDocument(original, revised);
    const elapsedMs = performance.now() - startedAt;

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const trackedBytes = JSON.stringify(result.document).length;
    expect(result.status).toBe("tracked");
    expect(result.changeIds.length).toBeLessThanOrEqual(1);
    expect(result.changeCount).toBeLessThanOrEqual(2);
    expect(countTrackedNodes(result.document)).toBeLessThanOrEqual(2);
    expect(trackedBytes).toBeLessThanOrEqual(sourceBytes + 10_000);
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it("bounds an alternating workload with hundreds of decision groups", () => {
    const paragraphCount = 1_000;
    const original = largeDocument(
      paragraphCount,
      (index) => `Párrafo estable ${index}.`,
    );
    const revised = largeDocument(paragraphCount, (index) =>
      index % 2 === 0
        ? `Párrafo estable ${index}.`
        : `Párrafo revisado ${index}.`,
    );

    const startedAt = performance.now();
    const result = buildTrackedDocument(original, revised);
    const elapsedMs = performance.now() - startedAt;

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.changeCount).toBe(500);
    expect(result.changeIds).toHaveLength(500);
    expect(elapsedMs).toBeLessThan(1_500);
  });
});
