import { describe, expect, it } from "vitest";
import * as diff from "./index";

describe("diff public exports", () => {
  it("keeps the legacy entry points without exposing retired portal helpers", () => {
    expect(diff.createJsonDiff).toBeTypeOf("function");
    expect(diff.buildContentWithJsonChanges).toBeTypeOf("function");

    expect(Object.keys(diff)).not.toEqual(
      expect.arrayContaining([
        "processJsonDiffDelta",
        "handleValueDelta",
        "applyJsonDelta",
        "handleArrayDelta",
        "convertMetadataToVisualChanges",
        "createChangeNode",
      ]),
    );
  });
});
