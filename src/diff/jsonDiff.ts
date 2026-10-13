import { diff_match_patch } from "@dmsnell/diff-match-patch";
import * as jsondiffpatch from "jsondiffpatch";
import type { Delta } from "jsondiffpatch";
import { DIFF_CONFIG } from "./constants";
import {
  buildTrackedDocument,
  type ProseMirrorJsonNode,
} from "./trackedDocument";

/**
 * Compatibility adapter for callers that still need a generic JSON delta.
 *
 * Tracked escrito generation no longer interprets this delta. ProseMirror
 * semantics are owned by buildTrackedDocument instead.
 */
const legacyJsonDiffer = jsondiffpatch.create({
  textDiff: {
    diffMatchPatch: diff_match_patch,
    minLength: DIFF_CONFIG.JSON_DIFF_TEXT_MIN_LENGTH,
  },
  arrays: {
    detectMove: true,
    includeValueOnMove: true,
  },
});

export function createJsonDiff(oldDocument: unknown, newDocument: unknown): Delta {
  return legacyJsonDiffer.diff(oldDocument, newDocument);
}

export function applyJsonDiff(document: unknown, delta: Delta): unknown {
  return legacyJsonDiffer.patch(document, delta);
}

export function reverseJsonDiff(delta: Delta): Delta {
  return legacyJsonDiffer.reverse(delta);
}

export function documentsEqual(
  firstDocument: unknown,
  secondDocument: unknown,
): boolean {
  return legacyJsonDiffer.diff(firstDocument, secondDocument) === undefined;
}

/**
 * Legacy signature retained while callers migrate to buildTrackedDocument.
 * The generic delta is deliberately ignored so it cannot leak raw JSON
 * matching assumptions into the ProseMirror-aware implementation.
 */
export function buildContentWithJsonChanges(
  oldDocument: unknown,
  newDocument: unknown,
  _delta: Delta,
): ProseMirrorJsonNode {
  const result = buildTrackedDocument(oldDocument, newDocument);
  if (!result.ok) {
    throw new Error(
      `Tracked document build failed (${result.code}): ${result.message}`,
    );
  }
  return result.document;
}
