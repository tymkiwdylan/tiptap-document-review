import { Fragment, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import {
  EditorState,
  type Selection,
  type Transaction,
} from "@tiptap/pm/state";

export type ChangeNodeName = "inlineChange" | "blockChange" | "lineBreakChange";
export type ChangeDecision = "accept" | "reject";
export type ChangeType = "added" | "deleted";

export type ChangeNodeSnapshot = {
  pos: number;
  nodeType: ChangeNodeName;
  nodeSize: number;
  changeType: ChangeType;
  changeId: string | null;
  semanticType: string | null;
  textPreview: string | null;
};

export type ApplyChangeSnapshotsResult = {
  applied: number;
  skipped: number;
  errors: number;
};

export type ChangeDecisionGroup = {
  key: string;
  changeId: string | null;
  firstPosition: number;
  addedNodes: number;
  deletedNodes: number;
  snapshots: ChangeNodeSnapshot[];
};

export type ChangeNodeInspection = {
  snapshots: ChangeNodeSnapshot[];
  physicalNodes: number;
  invalidNodes: number;
};

export type AtomicChangeDecisionResult =
  | ({
      ok: true;
      transaction: Transaction;
    } & ApplyChangeSnapshotsResult)
  | ({
      ok: false;
    } & ApplyChangeSnapshotsResult);

type ChangeNode = ProseMirrorNode & {
  type: ProseMirrorNode["type"] & { name: ChangeNodeName };
};

const isKnownChangeType = (value: unknown): value is ChangeType => {
  return value === "added" || value === "deleted";
};

const isChangeNodeName = (value: unknown): value is ChangeNodeName => {
  return (
    value === "inlineChange" ||
    value === "blockChange" ||
    value === "lineBreakChange"
  );
};

const normalizePreviewText = (value: string): string | null => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  return normalized.length > 120
    ? `${normalized.slice(0, 117).trimEnd()}...`
    : normalized;
};

export const isChangeNode = (
  node: ProseMirrorNode | null | undefined,
): node is ChangeNode => {
  return !!node && isChangeNodeName(node.type?.name);
};

export const collectChangeNodeSnapshots = (
  doc: ProseMirrorNode,
  options?: { changeId?: string | null },
): ChangeNodeSnapshot[] => {
  return inspectChangeNodes(doc, options).snapshots;
};

export const inspectChangeNodes = (
  doc: ProseMirrorNode,
  options?: { changeId?: string | null },
): ChangeNodeInspection => {
  const snapshots: ChangeNodeSnapshot[] = [];
  let physicalNodes = 0;
  let invalidNodes = 0;

  doc.descendants((node, pos) => {
    if (!isChangeNode(node)) {
      return;
    }
    physicalNodes += 1;

    const nodeChangeType = node.attrs?.changeType;
    if (!isKnownChangeType(nodeChangeType)) {
      invalidNodes += 1;
      return;
    }

    const rawChangeId = node.attrs?.changeId;
    const changeIdIsValid =
      rawChangeId === null ||
      rawChangeId === undefined ||
      (typeof rawChangeId === "string" && rawChangeId.trim().length > 0);
    const rawSemanticType = node.attrs?.semanticType;
    const semanticTypeIsValid =
      rawSemanticType === null ||
      rawSemanticType === undefined ||
      typeof rawSemanticType === "string";
    if (!changeIdIsValid || !semanticTypeIsValid) {
      invalidNodes += 1;
      return;
    }

    const nodeChangeId =
      typeof rawChangeId === "string" ? rawChangeId : null;
    const semanticType =
      typeof rawSemanticType === "string" ? rawSemanticType : null;

    if (
      options &&
      Object.prototype.hasOwnProperty.call(options, "changeId") &&
      options.changeId !== nodeChangeId
    ) {
      return;
    }

    snapshots.push({
      pos,
      nodeType: node.type.name,
      nodeSize: node.nodeSize,
      changeType: nodeChangeType,
      changeId: nodeChangeId,
      semanticType,
      textPreview: normalizePreviewText(node.textContent ?? ""),
    });
  });

  return {
    snapshots: snapshots.sort((a, b) => b.pos - a.pos),
    physicalNodes,
    invalidNodes,
  };
};

export const collectChangeDecisionGroups = (
  doc: ProseMirrorNode,
): ChangeDecisionGroup[] => {
  const groups = new Map<string, ChangeDecisionGroup>();

  for (const snapshot of collectChangeNodeSnapshots(doc)) {
    const key = getChangeDecisionKey(snapshot);
    const existing = groups.get(key);

    if (existing) {
      existing.firstPosition = Math.min(existing.firstPosition, snapshot.pos);
      existing.addedNodes += snapshot.changeType === "added" ? 1 : 0;
      existing.deletedNodes += snapshot.changeType === "deleted" ? 1 : 0;
      existing.snapshots.push(snapshot);
      continue;
    }

    groups.set(key, {
      key,
      changeId: snapshot.changeId,
      firstPosition: snapshot.pos,
      addedNodes: snapshot.changeType === "added" ? 1 : 0,
      deletedNodes: snapshot.changeType === "deleted" ? 1 : 0,
      snapshots: [snapshot],
    });
  }

  return Array.from(groups.values()).sort(
    (left, right) => left.firstPosition - right.firstPosition,
  );
};

export const countChangeDecisionGroups = (
  snapshots: ChangeNodeSnapshot[],
): number => {
  return new Set(snapshots.map(getChangeDecisionKey)).size;
};

const getChangeDecisionKey = (snapshot: ChangeNodeSnapshot): string => {
  return snapshot.changeId ?? `position:${snapshot.pos}`;
};

const getPreservationKey = (snapshot: ChangeNodeSnapshot): string => {
  return JSON.stringify([
    snapshot.nodeType,
    snapshot.changeType,
    snapshot.changeId,
    snapshot.semanticType,
  ]);
};

const preservesSnapshots = (
  required: ChangeNodeSnapshot[],
  actual: ChangeNodeSnapshot[],
): boolean => {
  const actualCounts = new Map<string, number>();
  for (const snapshot of actual) {
    const key = getPreservationKey(snapshot);
    actualCounts.set(key, (actualCounts.get(key) ?? 0) + 1);
  }

  const requiredCounts = new Map<string, number>();
  for (const snapshot of required) {
    const key = getPreservationKey(snapshot);
    requiredCounts.set(key, (requiredCounts.get(key) ?? 0) + 1);
  }

  return Array.from(requiredCounts).every(
    ([key, count]) => (actualCounts.get(key) ?? 0) >= count,
  );
};

const getMappedLiveNode = (
  tr: Transaction,
  snapshot: ChangeNodeSnapshot,
): { pos: number; node: ProseMirrorNode } | null => {
  const mappedPos = tr.mapping.map(snapshot.pos, -1);

  if (mappedPos < 0 || mappedPos >= tr.doc.content.size) {
    return null;
  }

  const currentNode = tr.doc.nodeAt(mappedPos);
  if (!currentNode || !isChangeNode(currentNode)) {
    return null;
  }

  if (currentNode.type.name !== snapshot.nodeType) {
    return null;
  }

  const liveChangeType = currentNode.attrs?.changeType;
  if (!isKnownChangeType(liveChangeType) || liveChangeType !== snapshot.changeType) {
    return null;
  }

  const liveChangeId =
    typeof currentNode.attrs?.changeId === "string" ? currentNode.attrs.changeId : null;

  if (snapshot.changeId !== liveChangeId) {
    return null;
  }

  return { pos: mappedPos, node: currentNode };
};

const canReplaceNodeAt = (
  tr: Transaction,
  from: number,
  replacement: Fragment,
): boolean => {
  try {
    const $from = tr.doc.resolve(from);
    const index = $from.index();
    return $from.parent.canReplace(index, index + 1, replacement);
  } catch {
    return false;
  }
};

const shouldRestoreOriginalForDecision = (
  changeType: ChangeType,
  decision: ChangeDecision,
): boolean => {
  return (
    (decision === "accept" && changeType === "added") ||
    (decision === "reject" && changeType === "deleted")
  );
};

const isListItemStructuralMarker = (node: ProseMirrorNode): boolean => {
  const semanticType = node.attrs?.semanticType;
  return (
    node.type.name === "inlineChange" &&
    typeof semanticType === "string" &&
    semanticType === "list_item_change_structural"
  );
};

const getListItemRemovalRange = (
  tr: Transaction,
  pos: number,
): { from: number; to: number } | null => {
  try {
    const $pos = tr.doc.resolve(pos);

    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      const nodeAtDepth = $pos.node(depth);
      if (nodeAtDepth.type.name !== "listItem") {
        continue;
      }

      // If this is the only item in a list, remove the list container too.
      const listDepth = depth - 1;
      if (listDepth > 0) {
        const listNode = $pos.node(listDepth);
        if (
          (listNode.type.name === "bulletList" ||
            listNode.type.name === "orderedList") &&
          listNode.childCount === 1
        ) {
          const from = $pos.before(listDepth);
          return { from, to: from + listNode.nodeSize };
        }
      }

      const from = $pos.before(depth);
      return { from, to: from + nodeAtDepth.nodeSize };
    }
  } catch {
    return null;
  }

  return null;
};

const getReplacementForDecision = (
  node: ProseMirrorNode,
  decision: ChangeDecision,
  schema: Schema,
): Fragment | null => {
  const changeType = node.attrs?.changeType;

  if (!isKnownChangeType(changeType)) {
    return null;
  }

  const shouldRestoreOriginal = shouldRestoreOriginalForDecision(
    changeType,
    decision,
  );

  if (node.type.name === "lineBreakChange") {
    if (!shouldRestoreOriginal) {
      return null;
    }

    const hardBreak = schema.nodes.hardBreak?.create();
    return hardBreak ? Fragment.from(hardBreak) : null;
  }

  if (!shouldRestoreOriginal) {
    return null;
  }

  return node.content.size > 0 ? node.content : null;
};

type NodeRange = { from: number; to: number };

const getAncestorNodeRange = (
  doc: ProseMirrorNode,
  pos: number,
  nodeName: string,
): NodeRange | null => {
  try {
    const $pos = doc.resolve(pos);
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      const ancestor = $pos.node(depth);
      if (ancestor.type.name === nodeName) {
        const from = $pos.before(depth);
        return { from, to: from + ancestor.nodeSize };
      }
    }
  } catch {
    return null;
  }
  return null;
};

const flattenEmptyNestedListArtifacts = (
  tr: Transaction,
  affectedRanges: NodeRange[],
): void => {
  const candidates: Array<{ from: number; to: number; replacement: ProseMirrorNode[] }> = [];

  tr.doc.descendants((node, pos) => {
    if (node.type.name !== "listItem" || node.childCount !== 2) {
      return;
    }

    const firstChild = node.child(0);
    const secondChild = node.child(1);

    const firstIsEmptyParagraph =
      firstChild.type.name === "paragraph" &&
      (firstChild.textContent ?? "").trim().length === 0;
    const secondIsList =
      secondChild.type.name === "bulletList" || secondChild.type.name === "orderedList";

    if (!firstIsEmptyParagraph || !secondIsList) {
      return;
    }

    try {
      const $pos = tr.doc.resolve(pos);
      const parentList = $pos.parent;
      const parentIsList =
        parentList.type.name === "bulletList" || parentList.type.name === "orderedList";

      if (!parentIsList || parentList.type.name !== secondChild.type.name) {
        return;
      }

      const replacement: ProseMirrorNode[] = [];
      secondChild.forEach((child) => {
        replacement.push(child);
      });

      if (replacement.length === 0) {
        return;
      }

      const to = pos + node.nodeSize;
      if (
        !affectedRanges.some(
          (affectedRange) =>
            affectedRange.from < affectedRange.to &&
            pos >= affectedRange.from &&
            to <= affectedRange.to,
        )
      ) {
        return;
      }

      candidates.push({
        from: pos,
        to,
        replacement,
      });
    } catch {
      return;
    }
  });

  candidates
    .sort((a, b) => b.from - a.from)
    .forEach((candidate) => {
      try {
        tr.replaceWith(candidate.from, candidate.to, candidate.replacement);
      } catch {
        // Ignore local flattening failures; they should not block change decisions.
      }
    });
};

export const applyChangeDecisionToSnapshots = (
  tr: Transaction,
  snapshots: ChangeNodeSnapshot[],
  decision: ChangeDecision,
  schema: Schema,
): ApplyChangeSnapshotsResult => {
  const result: ApplyChangeSnapshotsResult = {
    applied: 0,
    skipped: 0,
    errors: 0,
  };
  const sourceListItemRanges = snapshots.flatMap((snapshot) => {
    const range = getAncestorNodeRange(tr.before, snapshot.pos, "listItem");
    return range ? [range] : [];
  });

  for (const snapshot of snapshots) {
    const mapped = getMappedLiveNode(tr, snapshot);
    if (!mapped) {
      result.skipped += 1;
      continue;
    }

    const { pos, node } = mapped;

    try {
      const changeType = node.attrs?.changeType;
      if (!isKnownChangeType(changeType)) {
        result.skipped += 1;
        continue;
      }
      if (
        isListItemStructuralMarker(node) &&
        !shouldRestoreOriginalForDecision(changeType, decision)
      ) {
        const range = getListItemRemovalRange(tr, pos);
        if (
          !range ||
          range.from < 0 ||
          range.to > tr.doc.content.size ||
          range.from >= range.to
        ) {
          result.skipped += 1;
          continue;
        }

        tr.delete(range.from, range.to);
        result.applied += 1;
        continue;
      }

      const replacement = getReplacementForDecision(node, decision, schema);

      if (!replacement || replacement.size === 0) {
        const to = pos + node.nodeSize;
        if (to > tr.doc.content.size) {
          result.skipped += 1;
          continue;
        }

        tr.delete(pos, to);
        result.applied += 1;
        continue;
      }

      if (!canReplaceNodeAt(tr, pos, replacement)) {
        result.skipped += 1;
        continue;
      }

      tr.replaceWith(pos, pos + node.nodeSize, replacement);
      result.applied += 1;
    } catch {
      result.errors += 1;
    }
  }

  if (result.applied > 0) {
    flattenEmptyNestedListArtifacts(
      tr,
      sourceListItemRanges.map((range) => ({
        from: tr.mapping.map(range.from, 1),
        to: tr.mapping.map(range.to, -1),
      })),
    );
  }

  return result;
};

/**
 * Builds a decision transaction on an isolated state and returns it only when
 * every requested wrapper was resolved. Callers can therefore dispatch the
 * transaction without ever publishing a partially applied decision group.
 */
export const createAtomicChangeDecisionTransaction = (
  doc: ProseMirrorNode,
  snapshots: ChangeNodeSnapshot[],
  decision: ChangeDecision,
  schema: Schema,
  selection?: Selection,
): AtomicChangeDecisionResult => {
  const sourceInspection = inspectChangeNodes(doc);
  if (sourceInspection.invalidNodes > 0) {
    return { ok: false, applied: 0, skipped: 1, errors: 0 };
  }

  const targetKeys = new Set(snapshots.map(getChangeDecisionKey));
  const nonTargetSnapshots = sourceInspection.snapshots.filter(
    (snapshot) => !targetKeys.has(getChangeDecisionKey(snapshot)),
  );
  const transaction = EditorState.create({ schema, doc, selection }).tr;
  const result = applyChangeDecisionToSnapshots(
    transaction,
    snapshots,
    decision,
    schema,
  );

  if (
    snapshots.length === 0 ||
    result.applied !== snapshots.length ||
    result.skipped > 0 ||
    result.errors > 0
  ) {
    return { ok: false, ...result };
  }

  try {
    transaction.doc.check();
  } catch {
    return { ok: false, ...result, errors: result.errors + 1 };
  }

  const resolvedChangeIds = new Set(
    snapshots.flatMap((snapshot) =>
      snapshot.changeId === null ? [] : [snapshot.changeId],
    ),
  );
  const unresolved = collectChangeNodeSnapshots(transaction.doc).some(
    (snapshot) =>
      snapshot.changeId !== null &&
      resolvedChangeIds.has(snapshot.changeId),
  );

  if (unresolved) {
    return { ok: false, ...result, skipped: result.skipped + 1 };
  }

  if (
    !preservesSnapshots(
      nonTargetSnapshots,
      collectChangeNodeSnapshots(transaction.doc),
    )
  ) {
    return { ok: false, ...result, skipped: result.skipped + 1 };
  }

  return { ok: true, transaction, ...result };
};

export const applyChangeDecisionAtPosition = (
  tr: Transaction,
  pos: number,
  decision: ChangeDecision,
  schema: Schema,
): ApplyChangeSnapshotsResult => {
  const node = tr.doc.nodeAt(pos);
  if (!isChangeNode(node)) {
    return { applied: 0, skipped: 1, errors: 0 };
  }

  const nodeChangeType = node.attrs?.changeType;
  if (!isKnownChangeType(nodeChangeType)) {
    return { applied: 0, skipped: 1, errors: 0 };
  }

  const snapshot: ChangeNodeSnapshot = {
    pos,
    nodeType: node.type.name,
    nodeSize: node.nodeSize,
    changeType: nodeChangeType,
    changeId: typeof node.attrs?.changeId === "string" ? node.attrs.changeId : null,
    semanticType:
      typeof node.attrs?.semanticType === "string" ? node.attrs.semanticType : null,
    textPreview: normalizePreviewText(node.textContent ?? ""),
  };

  return applyChangeDecisionToSnapshots(tr, [snapshot], decision, schema);
};
