import { Node, mergeAttributes } from "@tiptap/core";
import {
  countChangeDecisionGroups,
  createAtomicChangeDecisionTransaction,
  type ChangeDecision,
  type ChangeNodeSnapshot,
  collectChangeNodeSnapshots,
} from "./changeOperations";

export interface ChangeOptions {
  HTMLAttributes: Record<string, any>;
}

export const EDITOR_SUGGESTION_DECISION_EVENT =
  "ialex:editorSuggestionDecision";

export interface EditorSuggestionDecisionDetail {
  editorId: string | null;
  decision: ChangeDecision;
  snapshots: ChangeNodeSnapshot[];
  changesCount: number;
}

// Inline change node - for text and inline elements
export const InlineChange = Node.create({
  name: "inlineChange",

  group: "inline",
  content: "inline*",
  inline: true,

  addAttributes() {
    return {
      changeType: {
        default: "added",
      },
      changeId: {
        default: null,
      },
      semanticType: {
        default: "content",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-change]",
        getAttrs: (dom) => ({
          changeType: (dom as HTMLElement).getAttribute("data-change"),
          changeId: (dom as HTMLElement).getAttribute("data-change-id"),
          semanticType:
            (dom as HTMLElement).getAttribute("data-semantic-type") ||
            "content",
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-change": HTMLAttributes.changeType,
        "data-change-id": HTMLAttributes.changeId,
        "data-semantic-type": HTMLAttributes.semanticType,
      }),
      0,
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("span");
      dom.style.position = "relative";
      dom.setAttribute("data-change", node.attrs.changeType);
      dom.setAttribute("data-semantic-type", node.attrs.semanticType);

      if (node.attrs.changeType === "added") {
        dom.style.backgroundColor = "#d4f7d4";
        dom.style.color = "#000";
      } else {
        dom.style.backgroundColor = "#f8d4d4";
        dom.style.color = "#000";
        dom.style.textDecoration = "line-through";
      }

      const contentDOM = document.createElement("span");
      dom.appendChild(contentDOM);

      // Check if this node should show buttons (only the last node with same changeId)
      const shouldShowButtons = isLastNodeWithChangeId(node, editor);

      if (shouldShowButtons) {
        // Create button container
        const buttonContainer = document.createElement("div");
        buttonContainer.className = "change-buttons";

        // Create and add accept/reject buttons
        const accept = document.createElement("button");
        accept.textContent = "✓";
        accept.className = "change-button accept";
        accept.setAttribute("aria-label", "Aceptar sugerencia");
        accept.setAttribute("data-tooltip", "Accept (⌘Y)");
        accept.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleChangeNodeAction(editor, getPos, node, "accept");
        };

        const reject = document.createElement("button");
        reject.textContent = "✕";
        reject.className = "change-button reject";
        reject.setAttribute("aria-label", "Rechazar sugerencia");
        reject.setAttribute("data-tooltip", "Reject (⌘N)");
        reject.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleChangeNodeAction(editor, getPos, node, "reject");
        };

        buttonContainer.appendChild(accept);
        buttonContainer.appendChild(reject);
        dom.appendChild(buttonContainer);
      } else {
        // Add visual indicator for grouped nodes without buttons
        const groupIndicator = document.createElement("span");
        groupIndicator.className = "change-group-indicator";
        groupIndicator.title = "Part of grouped change - buttons on last item";
        dom.appendChild(groupIndicator);
      }

      return {
        dom,
        contentDOM,
      };
    };
  },
});

// Block change node - for paragraphs and block elements
export const BlockChange = Node.create({
  name: "blockChange",

  group: "block",
  content: "block*",

  addAttributes() {
    return {
      changeType: {
        default: "added",
      },
      changeId: {
        default: null,
      },
      semanticType: {
        default: "block_change",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-change]",
        getAttrs: (dom) => ({
          changeType: (dom as HTMLElement).getAttribute("data-change"),
          changeId: (dom as HTMLElement).getAttribute("data-change-id"),
          semanticType:
            (dom as HTMLElement).getAttribute("data-semantic-type") ||
            "block_change",
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs: Record<string, any> = {
      "data-change": HTMLAttributes.changeType,
      "data-change-id": HTMLAttributes.changeId,
      "data-change-type": HTMLAttributes.changeType,
      "data-change-user": HTMLAttributes.user,
      "data-change-time": HTMLAttributes.time,
      "data-semantic-type": "block_change",
    };

    return ["div", attrs, 0];
  },

  addNodeView() {
    return ({ editor, getPos, node }) => {
      const dom = document.createElement("div");
      dom.setAttribute("data-change", node.attrs.changeType);
      dom.setAttribute("data-semantic-type", node.attrs.semanticType);

      const contentDOM = document.createElement("div");
      dom.appendChild(contentDOM);

      // Check if this node should show buttons (only the last node with same changeId)
      const shouldShowButtons = isLastNodeWithChangeId(node, editor);

      if (shouldShowButtons) {
        // Create button container
        const buttonContainer = document.createElement("div");
        buttonContainer.className = "change-buttons";

        // Create and add accept/reject buttons (same style as inline)
        const accept = document.createElement("button");
        accept.textContent = "✓";
        accept.className = "change-button accept";
        accept.setAttribute("aria-label", "Aceptar sugerencia");
        accept.setAttribute("data-tooltip", "Accept (⌘Y)");
        accept.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleChangeNodeAction(editor, getPos, node, "accept");
        };

        const reject = document.createElement("button");
        reject.textContent = "✕";
        reject.className = "change-button reject";
        reject.setAttribute("aria-label", "Rechazar sugerencia");
        reject.setAttribute("data-tooltip", "Reject (⌘N)");
        reject.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleChangeNodeAction(editor, getPos, node, "reject");
        };

        buttonContainer.appendChild(accept);
        buttonContainer.appendChild(reject);
        dom.appendChild(buttonContainer);
      } else {
        // Add visual indicator for grouped nodes without buttons
        const groupIndicator = document.createElement("span");
        groupIndicator.className = "change-group-indicator";
        groupIndicator.title = "Part of grouped change - buttons on last item";
        dom.appendChild(groupIndicator);
      }

      return {
        dom,
        contentDOM,
      };
    };
  },
});

// LineBreak change node - for tracking line break insertions/deletions
export const LineBreakChange = Node.create({
  name: "lineBreakChange",

  group: "inline",
  inline: true,
  atom: true, // LineBreak nodes are atomic

  addAttributes() {
    return {
      changeType: {
        default: "added",
      },
      changeId: {
        default: null,
      },
      semanticType: {
        default: "line_break",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "br[data-change]",
        getAttrs: (dom) => ({
          changeType: (dom as HTMLElement).getAttribute("data-change"),
          changeId: (dom as HTMLElement).getAttribute("data-change-id"),
          semanticType:
            (dom as HTMLElement).getAttribute("data-semantic-type") ||
            "line_break",
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "br",
      mergeAttributes(HTMLAttributes, {
        "data-change": HTMLAttributes.changeType,
        "data-change-id": HTMLAttributes.changeId,
        "data-semantic-type": HTMLAttributes.semanticType,
      }),
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("span");
      dom.style.position = "relative";
      dom.style.display = "inline-block";
      dom.setAttribute("data-change", node.attrs.changeType);
      dom.setAttribute("data-semantic-type", node.attrs.semanticType);

      // Visual styling for line break changes
      if (node.attrs.changeType === "added") {
        dom.style.backgroundColor = "#d4f7d4";
        dom.style.border = "2px solid #10b981";
        dom.style.borderRadius = "4px";
        dom.style.padding = "2px 8px";
        dom.style.margin = "0 2px";
        dom.style.fontSize = "11px";
        dom.style.fontWeight = "bold";
        dom.style.color = "#047857";
        dom.textContent = "↵";
      } else if (node.attrs.changeType === "deleted") {
        dom.style.backgroundColor = "#f8d4d4";
        dom.style.border = "2px solid #ef4444";
        dom.style.borderRadius = "4px";
        dom.style.padding = "2px 8px";
        dom.style.margin = "0 2px";
        dom.style.fontSize = "11px";
        dom.style.fontWeight = "bold";
        dom.style.color = "#dc2626";
        dom.style.textDecoration = "line-through";
        dom.textContent = "↵";
      }

      // Check if this node should show buttons (only the last node with same changeId)
      const shouldShowButtons = isLastNodeWithChangeId(node, editor);

      if (shouldShowButtons) {
        // Create button container
        const buttonContainer = document.createElement("div");
        buttonContainer.className = "change-buttons";

        // Create and add accept/reject buttons
        const accept = document.createElement("button");
        accept.textContent = "✓";
        accept.className = "change-button accept";
        accept.setAttribute("aria-label", "Aceptar sugerencia");
        accept.setAttribute("data-tooltip", "Accept (⌘Y)");
        accept.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleChangeNodeAction(editor, getPos, node, "accept");
        };

        const reject = document.createElement("button");
        reject.textContent = "✕";
        reject.className = "change-button reject";
        reject.setAttribute("aria-label", "Rechazar sugerencia");
        reject.setAttribute("data-tooltip", "Reject (⌘N)");
        reject.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleChangeNodeAction(editor, getPos, node, "reject");
        };

        buttonContainer.appendChild(accept);
        buttonContainer.appendChild(reject);
        dom.appendChild(buttonContainer);
      } else {
        // Add visual indicator for grouped nodes without buttons
        const groupIndicator = document.createElement("span");
        groupIndicator.className = "change-group-indicator";
        groupIndicator.title = "Part of grouped change - buttons on last item";
        dom.appendChild(groupIndicator);
      }

      return { dom };
    };
  },
});

// Legacy compatibility - keep the old name as an alias to inline change
export const Change = InlineChange;

/**
 * Helper function to determine if this node is the last one with the same changeId
 * @param node - The current change node
 * @param editor - The editor instance
 * @returns true if this is the last node with the same changeId, false otherwise
 */
function isLastNodeWithChangeId(node: any, editor: any): boolean {
  const changeId = node.attrs.changeId;

  // If no changeId, always show buttons (fallback behavior)
  if (!changeId) {
    return true;
  }

  let lastNodePos = -1;
  let currentNodePos = -1;

  // Find all nodes with the same changeId and track their positions
  editor.state.doc.descendants((descNode: any, pos: number) => {
    if (
      (descNode.type.name === "inlineChange" ||
        descNode.type.name === "blockChange" ||
        descNode.type.name === "lineBreakChange" ||
        descNode.type.name === "change") &&
      descNode.attrs.changeId === changeId
    ) {
      if (descNode === node) {
        currentNodePos = pos;
      }
      if (pos > lastNodePos) {
        lastNodePos = pos;
      }
    }
  });

  // This node should show buttons if it's at the last position
  return currentNodePos === lastNodePos;
}

function handleChangeNodeAction(
  editor: any,
  getPos: () => number | undefined,
  node: any,
  decision: "accept" | "reject",
): void {
  try {
    const changeId =
      typeof node?.attrs?.changeId === "string" ? node.attrs.changeId : null;
    const snapshots = changeId
      ? collectChangeNodeSnapshots(editor.state.doc, { changeId })
      : (() => {
          const position = getPos();
          if (typeof position !== "number") {
            return [];
          }

          return collectChangeNodeSnapshots(editor.state.doc).filter(
            (snapshot) => snapshot.pos === position,
          );
        })();

    if (snapshots.length === 0) {
      console.warn("[ChangeNodes] No live change group was found", {
        decision,
        changeId,
      });
      return;
    }

    const result = createAtomicChangeDecisionTransaction(
      editor.state.doc,
      snapshots,
      decision,
      editor.schema,
      editor.state.selection,
    );

    if (result.ok) {
      editor.view.dispatch(result.transaction);
      dispatchSuggestionDecisionEvent(
        editor,
        decision,
        snapshots,
        countChangeDecisionGroups(snapshots),
      );
    }

    if (!result.ok && (result.skipped > 0 || result.errors > 0)) {
      console.warn("[ChangeNodes] Skipped unsafe change operation", {
        decision,
        changeId,
        ...result,
      });
    }
  } catch (error) {
    console.error("[ChangeNodes] Failed to apply change operation", {
      decision,
      error,
    });
  }
}

function dispatchSuggestionDecisionEvent(
  editor: any,
  decision: ChangeDecision,
  snapshots: ChangeNodeSnapshot[],
  changesCount: number,
): void {
  if (
    typeof window === "undefined" ||
    snapshots.length === 0 ||
    changesCount <= 0
  ) {
    return;
  }

  const editorId = editor?.view?.dom?.getAttribute?.("data-ialex-editor-id");

  window.dispatchEvent(
    new CustomEvent<EditorSuggestionDecisionDetail>(
      EDITOR_SUGGESTION_DECISION_EVENT,
      {
        detail: {
          editorId:
            typeof editorId === "string" && editorId.length > 0
              ? editorId
              : null,
          decision,
          snapshots,
          changesCount,
        },
      },
    ),
  );
}
