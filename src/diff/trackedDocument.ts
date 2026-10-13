import { Fragment, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import {
  collectChangeNodeSnapshots,
  countChangeDecisionGroups,
  createAtomicChangeDecisionTransaction,
  inspectChangeNodes,
  type ChangeDecision,
  type ChangeNodeSnapshot,
} from "../tiptap/changeOperations";
import { buildServerSchema } from "../tiptap/schema";

export type TrackedDocumentFailureCode =
  | "invalid_original"
  | "invalid_revised"
  | "invalid_tracked_change"
  | "limits_exceeded"
  | "overlapping_pending_change"
  | "unsupported_move"
  | "unrepresentable_change"
  | "verification_failed";

export type ProseMirrorJsonMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type ProseMirrorJsonNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorJsonNode[];
  marks?: ProseMirrorJsonMark[];
  text?: string;
};

export type TrackedDocumentFailure = {
  ok: false;
  code: TrackedDocumentFailureCode;
  message: string;
};

export type BuildTrackedDocumentSuccess = {
  ok: true;
  status: "unchanged" | "tracked";
  document: ProseMirrorJsonNode;
  changeIds: string[];
  changeCount: number;
};

export type BuildTrackedDocumentResult =
  | BuildTrackedDocumentSuccess
  | TrackedDocumentFailure;

export type ResolveTrackedDocumentSuccess = {
  ok: true;
  document: ProseMirrorJsonNode;
  changesResolved: number;
};

export type ResolveTrackedDocumentResult =
  | ResolveTrackedDocumentSuccess
  | TrackedDocumentFailure;

type Anchor = {
  originalIndex: number;
  revisedIndex: number;
};

type BuildContext = {
  schema: Schema;
  idPrefix: string;
  nextId: number;
  changeIds: string[];
};

const CHANGE_NODE_NAMES = new Set([
  "inlineChange",
  "blockChange",
  "lineBreakChange",
]);

const MAX_SERIALIZED_INPUT_BYTES = 500_000;
const MAX_DOCUMENT_NODES = 5_000;
const MAX_TRACKED_OUTPUT_BYTES = 1_000_000;
const MAX_TRACKED_OUTPUT_NODES = 9_000;
const UTF8_ENCODER = new TextEncoder();

let cachedSchema: Schema | null = null;

const getSchema = (): Schema => {
  if (!cachedSchema) {
    cachedSchema = buildServerSchema();
  }
  return cachedSchema;
};

const failure = (
  code: TrackedDocumentFailureCode,
  message: string,
): TrackedDocumentFailure => ({
  ok: false,
  code,
  message,
});

const parseDocument = (
  schema: Schema,
  value: unknown,
  code: "invalid_original" | "invalid_revised",
): ProseMirrorNode | TrackedDocumentFailure => {
  try {
    const document = schema.nodeFromJSON(value);
    document.check();
    if (document.type !== schema.topNodeType) {
      return failure(code, "The input is not a complete ProseMirror document.");
    }
    return document;
  } catch {
    return failure(code, "The input is not valid for the legal editor schema.");
  }
};

const isFailure = (value: unknown): value is TrackedDocumentFailure => {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    value.ok === false
  );
};

const childNodes = (node: ProseMirrorNode): ProseMirrorNode[] => {
  const children: ProseMirrorNode[] = [];
  node.forEach((child) => {
    children.push(child);
  });
  return children;
};

const countDocumentNodes = (document: ProseMirrorNode): number => {
  let count = 1;
  document.descendants(() => {
    count += 1;
  });
  return count;
};

const serializedByteLength = (value: string): number => {
  return UTF8_ENCODER.encode(value).byteLength;
};

const serializeBoundedInput = (
  value: unknown,
  invalidCode: "invalid_original" | "invalid_revised",
): string | TrackedDocumentFailure => {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      return failure(invalidCode, "The input is not a serializable document.");
    }
    if (serializedByteLength(serialized) > MAX_SERIALIZED_INPUT_BYTES) {
      return failure(
        "limits_exceeded",
        "The document exceeds the tracked-diff input size limit.",
      );
    }
    return serialized;
  } catch {
    return failure(invalidCode, "The input is not a serializable document.");
  }
};

const validateDocumentNodeBound = (
  document: ProseMirrorNode,
): TrackedDocumentFailure | null => {
  if (countDocumentNodes(document) > MAX_DOCUMENT_NODES) {
    return failure(
      "limits_exceeded",
      "The document exceeds the tracked-diff node limit.",
    );
  }
  return null;
};

const nodeKey = (node: ProseMirrorNode): string => {
  return JSON.stringify(node.toJSON());
};

const containsTrackedChange = (node: ProseMirrorNode): boolean => {
  if (CHANGE_NODE_NAMES.has(node.type.name)) {
    return true;
  }

  let found = false;
  node.descendants((descendant) => {
    if (CHANGE_NODE_NAMES.has(descendant.type.name)) {
      found = true;
      return false;
    }
    return !found;
  });
  return found;
};

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const nextChangeId = (context: BuildContext): string => {
  const id = `tracked-${context.idPrefix}-${context.nextId}`;
  context.nextId += 1;
  context.changeIds.push(id);
  return id;
};

const firstAtOrAfter = (
  values: number[],
  minimum: number,
): number | undefined => {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < minimum) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return values[low];
};

const findExactAnchors = (
  original: ProseMirrorNode[],
  revised: ProseMirrorNode[],
): Anchor[] => {
  const revisedPositions = new Map<string, number[]>();

  revised.forEach((node, index) => {
    const key = nodeKey(node);
    const existing = revisedPositions.get(key);
    if (existing) {
      existing.push(index);
    } else {
      revisedPositions.set(key, [index]);
    }
  });

  const anchors: Anchor[] = [];
  let nextRevisedIndex = 0;

  original.forEach((node, originalIndex) => {
    const candidates = revisedPositions.get(nodeKey(node));
    if (!candidates) {
      return;
    }

    const revisedIndex = firstAtOrAfter(candidates, nextRevisedIndex);
    if (revisedIndex === undefined || !node.eq(revised[revisedIndex])) {
      return;
    }

    anchors.push({ originalIndex, revisedIndex });
    nextRevisedIndex = revisedIndex + 1;
  });

  return anchors;
};

const containsReorderedBlocks = (
  original: ProseMirrorNode[],
  revised: ProseMirrorNode[],
): boolean => {
  const originalCounts = new Map<string, number>();
  original.forEach((node) => {
    const key = nodeKey(node);
    originalCounts.set(key, (originalCounts.get(key) ?? 0) + 1);
  });
  const revisedPositions = new Map<string, number[]>();
  revised.forEach((node, index) => {
    const key = nodeKey(node);
    const positions = revisedPositions.get(key);
    if (positions) {
      positions.push(index);
    } else {
      revisedPositions.set(key, [index]);
    }
  });

  const hasEqualMultiset =
    original.length === revised.length &&
    originalCounts.size === revisedPositions.size &&
    Array.from(originalCounts.entries()).every(
      ([key, count]) => revisedPositions.get(key)?.length === count,
    );
  if (
    hasEqualMultiset &&
    original.some((node, index) => !node.eq(revised[index]))
  ) {
    return true;
  }

  const occurrences = new Map<string, number>();
  let previousRevisedIndex = -1;

  for (const node of original) {
    const key = nodeKey(node);
    if (
      originalCounts.get(key) !== 1 ||
      revisedPositions.get(key)?.length !== 1
    ) {
      continue;
    }
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    const revisedIndex = revisedPositions.get(key)?.[occurrence];
    if (revisedIndex === undefined) {
      continue;
    }
    if (revisedIndex < previousRevisedIndex) {
      return true;
    }
    previousRevisedIndex = revisedIndex;
  }

  return false;
};

const createChangeNode = (
  context: BuildContext,
  nodeName: "inlineChange" | "blockChange",
  changeType: "added" | "deleted",
  changeId: string,
  content: ProseMirrorNode[],
): ProseMirrorNode | null => {
  const nodeType = context.schema.nodes[nodeName];
  if (!nodeType) {
    return null;
  }

  try {
    return nodeType.create(
      {
        changeType,
        changeId,
        semanticType: nodeName === "inlineChange" ? "content" : "block_change",
      },
      Fragment.fromArray(content),
    );
  } catch {
    return null;
  }
};

const sameTextBlockShell = (
  original: ProseMirrorNode,
  revised: ProseMirrorNode,
): boolean => {
  return (
    original.isTextblock &&
    revised.isTextblock &&
    original.type === revised.type &&
    original.sameMarkup(revised)
  );
};

const buildInlineChange = (
  original: ProseMirrorNode,
  revised: ProseMirrorNode,
  context: BuildContext,
): ProseMirrorNode | TrackedDocumentFailure => {
  const originalContent = childNodes(original);
  const revisedContent = childNodes(revised);

  let prefixLength = 0;
  while (
    prefixLength < originalContent.length &&
    prefixLength < revisedContent.length &&
    originalContent[prefixLength].eq(revisedContent[prefixLength])
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < originalContent.length - prefixLength &&
    suffixLength < revisedContent.length - prefixLength &&
    originalContent[originalContent.length - suffixLength - 1].eq(
      revisedContent[revisedContent.length - suffixLength - 1],
    )
  ) {
    suffixLength += 1;
  }

  const originalChanged = originalContent.slice(
    prefixLength,
    originalContent.length - suffixLength,
  );
  const revisedChanged = revisedContent.slice(
    prefixLength,
    revisedContent.length - suffixLength,
  );

  if (
    originalChanged.some(containsTrackedChange) ||
    revisedChanged.some(containsTrackedChange)
  ) {
    return failure(
      "overlapping_pending_change",
      "The proposed edit overlaps an unresolved tracked change.",
    );
  }

  const changeId = nextChangeId(context);
  const output = originalContent.slice(0, prefixLength);

  if (originalChanged.length > 0) {
    const deleted = createChangeNode(
      context,
      "inlineChange",
      "deleted",
      changeId,
      originalChanged,
    );
    if (!deleted) {
      return failure(
        "unrepresentable_change",
        "The original inline content cannot be represented as a tracked change.",
      );
    }
    output.push(deleted);
  }

  if (revisedChanged.length > 0) {
    const added = createChangeNode(
      context,
      "inlineChange",
      "added",
      changeId,
      revisedChanged,
    );
    if (!added) {
      return failure(
        "unrepresentable_change",
        "The revised inline content cannot be represented as a tracked change.",
      );
    }
    output.push(added);
  }

  output.push(...originalContent.slice(originalContent.length - suffixLength));

  try {
    return revised.type.create(revised.attrs, Fragment.fromArray(output), revised.marks);
  } catch {
    return failure(
      "unrepresentable_change",
      "The tracked inline content is not valid in its parent node.",
    );
  }
};

const buildChangedSegment = (
  original: ProseMirrorNode[],
  revised: ProseMirrorNode[],
  context: BuildContext,
): ProseMirrorNode[] | TrackedDocumentFailure => {
  if (original.length === 0 && revised.length === 0) {
    return [];
  }

  const revisedKeys = new Set(revised.map(nodeKey));
  if (
    original.some(
      (originalNode) =>
        revisedKeys.has(nodeKey(originalNode)) &&
        revised.some((revisedNode) => originalNode.eq(revisedNode)),
    )
  ) {
    return failure(
      "unsupported_move",
      "Reordered blocks must be reviewed separately before tracked changes are generated.",
    );
  }

  if (
    original.length === 1 &&
    revised.length === 1 &&
    sameTextBlockShell(original[0], revised[0])
  ) {
    const inline = buildInlineChange(original[0], revised[0], context);
    return isFailure(inline) ? inline : [inline];
  }

  if (
    original.some(containsTrackedChange) ||
    revised.some(containsTrackedChange)
  ) {
    return failure(
      "overlapping_pending_change",
      "The proposed edit overlaps an unresolved tracked change.",
    );
  }

  const changeId = nextChangeId(context);
  const output: ProseMirrorNode[] = [];

  if (original.length > 0) {
    const deleted = createChangeNode(
      context,
      "blockChange",
      "deleted",
      changeId,
      original,
    );
    if (!deleted) {
      return failure(
        "unrepresentable_change",
        "The original block content cannot be represented as a tracked change.",
      );
    }
    output.push(deleted);
  }

  if (revised.length > 0) {
    const added = createChangeNode(
      context,
      "blockChange",
      "added",
      changeId,
      revised,
    );
    if (!added) {
      return failure(
        "unrepresentable_change",
        "The revised block content cannot be represented as a tracked change.",
      );
    }
    output.push(added);
  }

  return output;
};

const generatedSnapshots = (
  document: ProseMirrorNode,
  changeIds: string[],
): ChangeNodeSnapshot[] => {
  const snapshots = changeIds.flatMap((changeId) =>
    collectChangeNodeSnapshots(document, { changeId }),
  );
  return snapshots.sort((left, right) => right.pos - left.pos);
};

const resolveNode = (
  document: ProseMirrorNode,
  decision: ChangeDecision,
  snapshots: ChangeNodeSnapshot[],
  schema: Schema,
): ProseMirrorNode | TrackedDocumentFailure => {
  const result = createAtomicChangeDecisionTransaction(
    document,
    snapshots,
    decision,
    schema,
  );

  if (!result.ok) {
    return failure(
      "verification_failed",
      "One or more tracked changes could not be resolved safely.",
    );
  }

  try {
    result.transaction.doc.check();
    return result.transaction.doc;
  } catch {
    return failure(
      "verification_failed",
      "Resolving the tracked changes produced an invalid document.",
    );
  }
};

const validateTrackedMetadata = (
  document: ProseMirrorNode,
): TrackedDocumentFailure | null => {
  const inspection = inspectChangeNodes(document);
  if (
    inspection.invalidNodes > 0 ||
    inspection.physicalNodes !== inspection.snapshots.length
  ) {
    return failure(
      "invalid_tracked_change",
      "The document contains a tracked change with invalid decision metadata.",
    );
  }
  return null;
};

export const resolveTrackedDocument = (
  value: unknown,
  decision: ChangeDecision,
): ResolveTrackedDocumentResult => {
  const serialized = serializeBoundedInput(value, "invalid_original");
  if (isFailure(serialized)) {
    return serialized;
  }

  const schema = getSchema();
  const parsed = parseDocument(schema, value, "invalid_original");
  if (isFailure(parsed)) {
    return parsed;
  }
  const boundsFailure = validateDocumentNodeBound(parsed);
  if (boundsFailure) {
    return boundsFailure;
  }

  const metadataFailure = validateTrackedMetadata(parsed);
  if (metadataFailure) {
    return metadataFailure;
  }

  const inspection = inspectChangeNodes(parsed);
  const snapshots = inspection.snapshots;
  if (snapshots.length === 0) {
    return {
      ok: true,
      document: parsed.toJSON(),
      changesResolved: 0,
    };
  }

  const resolved = resolveNode(parsed, decision, snapshots, schema);
  if (isFailure(resolved)) {
    return resolved;
  }

  if (inspectChangeNodes(resolved).physicalNodes > 0) {
    return failure(
      "verification_failed",
      "Resolving the document left unresolved tracked changes.",
    );
  }

  return {
    ok: true,
    document: resolved.toJSON(),
    changesResolved: countChangeDecisionGroups(snapshots),
  };
};

export const buildTrackedDocument = (
  originalValue: unknown,
  revisedValue: unknown,
): BuildTrackedDocumentResult => {
  const originalSerialized = serializeBoundedInput(
    originalValue,
    "invalid_original",
  );
  if (isFailure(originalSerialized)) {
    return originalSerialized;
  }
  const revisedSerialized = serializeBoundedInput(
    revisedValue,
    "invalid_revised",
  );
  if (isFailure(revisedSerialized)) {
    return revisedSerialized;
  }

  const schema = getSchema();
  const original = parseDocument(schema, originalValue, "invalid_original");
  if (isFailure(original)) {
    return original;
  }

  const revised = parseDocument(schema, revisedValue, "invalid_revised");
  if (isFailure(revised)) {
    return revised;
  }
  const originalBoundsFailure = validateDocumentNodeBound(original);
  if (originalBoundsFailure) {
    return originalBoundsFailure;
  }
  const revisedBoundsFailure = validateDocumentNodeBound(revised);
  if (revisedBoundsFailure) {
    return revisedBoundsFailure;
  }
  const originalMetadataFailure = validateTrackedMetadata(original);
  if (originalMetadataFailure) {
    return originalMetadataFailure;
  }
  const revisedMetadataFailure = validateTrackedMetadata(revised);
  if (revisedMetadataFailure) {
    return revisedMetadataFailure;
  }

  if (original.eq(revised)) {
    const unchangedDocument = revised.toJSON();
    if (
      serializedByteLength(JSON.stringify(unchangedDocument)) >
      MAX_TRACKED_OUTPUT_BYTES
    ) {
      return failure(
        "limits_exceeded",
        "The canonical document exceeds the safe output limit.",
      );
    }
    return {
      ok: true,
      status: "unchanged",
      document: unchangedDocument,
      changeIds: [],
      changeCount: 0,
    };
  }

  const originalChildren = childNodes(original);
  const revisedChildren = childNodes(revised);
  if (containsReorderedBlocks(originalChildren, revisedChildren)) {
    return failure(
      "unsupported_move",
      "Reordered blocks must be reviewed separately before tracked changes are generated.",
    );
  }

  const context: BuildContext = {
    schema,
    idPrefix: stableHash(
      `${originalSerialized}\u0000${revisedSerialized}`,
    ),
    nextId: 0,
    changeIds: [],
  };
  const anchors = findExactAnchors(originalChildren, revisedChildren);
  const output: ProseMirrorNode[] = [];
  let originalStart = 0;
  let revisedStart = 0;

  for (const anchor of anchors) {
    const changed = buildChangedSegment(
      originalChildren.slice(originalStart, anchor.originalIndex),
      revisedChildren.slice(revisedStart, anchor.revisedIndex),
      context,
    );
    if (isFailure(changed)) {
      return changed;
    }

    output.push(...changed, originalChildren[anchor.originalIndex]);
    originalStart = anchor.originalIndex + 1;
    revisedStart = anchor.revisedIndex + 1;
  }

  const tail = buildChangedSegment(
    originalChildren.slice(originalStart),
    revisedChildren.slice(revisedStart),
    context,
  );
  if (isFailure(tail)) {
    return tail;
  }
  output.push(...tail);

  let tracked: ProseMirrorNode;
  try {
    tracked = revised.type.create(
      revised.attrs,
      Fragment.fromArray(output),
      revised.marks,
    );
    tracked.check();
  } catch {
    return failure(
      "unrepresentable_change",
      "The tracked document is not valid for the legal editor schema.",
    );
  }

  if (countDocumentNodes(tracked) > MAX_TRACKED_OUTPUT_NODES) {
    return failure(
      "limits_exceeded",
      "The tracked result exceeds the safe output node limit.",
    );
  }
  if (
    serializedByteLength(JSON.stringify(tracked.toJSON())) >
    MAX_TRACKED_OUTPUT_BYTES
  ) {
    return failure(
      "limits_exceeded",
      "The tracked result exceeds the safe output size limit.",
    );
  }

  const snapshots = generatedSnapshots(tracked, context.changeIds);
  if (snapshots.length === 0) {
    return failure(
      "verification_failed",
      "The changed document did not produce any reviewable changes.",
    );
  }

  const accepted = resolveNode(tracked, "accept", snapshots, schema);
  if (isFailure(accepted) || !accepted.eq(revised)) {
    return failure(
      "verification_failed",
      "Accepting the tracked changes does not reproduce the revised document.",
    );
  }

  const rejected = resolveNode(tracked, "reject", snapshots, schema);
  if (isFailure(rejected) || !rejected.eq(original)) {
    return failure(
      "verification_failed",
      "Rejecting the tracked changes does not reproduce the original document.",
    );
  }

  return {
    ok: true,
    status: "tracked",
    document: tracked.toJSON(),
    changeIds: context.changeIds,
    changeCount: countChangeDecisionGroups(snapshots),
  };
};
