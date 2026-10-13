import { Extension } from "@tiptap/core";

export interface ParagraphIndentOptions {
  types: string[];
  stepMm: number;
  minSideIndentMm: number;
  maxSideIndentMm: number;
  maxTextIndentMm: number;
}

interface ParagraphAttributeReader {
  getAttributes: (typeOrName: string) => Record<string, unknown>;
  state: {
    selection: {
      $from: {
        parent: {
          type: {
            name: string;
          };
        };
      };
    };
  };
  isActive: (typeOrName: string) => boolean;
}

interface ParagraphAttributeCommand {
  updateAttributes: (
    typeOrName: string,
    attributes: Record<string, unknown>,
  ) => boolean;
}

interface ParagraphCommandContext {
  editor: ParagraphAttributeReader;
  commands: ParagraphAttributeCommand;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphIndent: {
      setParagraphIndent: (valueMm: number | null) => ReturnType;
      unsetParagraphIndent: () => ReturnType;
      increaseParagraphIndent: () => ReturnType;
      decreaseParagraphIndent: () => ReturnType;
      setParagraphLeftIndent: (valueMm: number | null) => ReturnType;
      setParagraphRightIndent: (valueMm: number | null) => ReturnType;
    };
  }
}

export interface ParagraphIndentAttributes {
  leftIndent: number;
  rightIndent: number;
  textIndent: number;
}

export const DEFAULT_PARAGRAPH_INDENT_ATTRIBUTES: ParagraphIndentAttributes = {
  leftIndent: 0,
  rightIndent: 0,
  textIndent: 0,
};

function toValidIndent(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsedValue = Number.parseFloat(value.replace(/[a-z%]+/gi, "").trim());
    if (Number.isFinite(parsedValue)) {
      return parsedValue;
    }
  }

  return null;
}

function getElementStyleValue(
  element: Element,
  styleKey: "textIndent" | "marginLeft" | "marginRight",
): string {
  return element instanceof HTMLElement ? element.style[styleKey] : "";
}

function getDataAttributeIndent(
  element: Element,
  attributeName: string,
): number | null {
  return toValidIndent(element.getAttribute(attributeName));
}

function resolveParagraphType(
  editor: ParagraphAttributeReader,
  types: string[],
): string {
  const currentType = editor.state.selection.$from.parent.type.name;
  if (types.includes(currentType)) {
    return currentType;
  }

  const activeType = types.find((type) => editor.isActive(type));
  return activeType ?? types[0];
}

function toStoredSideIndent(
  valueMm: number | null,
  options: ParagraphIndentOptions,
): number | null {
  if (valueMm === null || valueMm <= options.minSideIndentMm) {
    return null;
  }

  return Math.min(
    options.maxSideIndentMm,
    Math.max(options.minSideIndentMm, valueMm),
  );
}

function toStoredTextIndent(
  valueMm: number | null,
  options: ParagraphIndentOptions,
): number | null {
  if (valueMm === null || Math.abs(valueMm) < 0.05) {
    return null;
  }

  return Math.min(
    options.maxTextIndentMm,
    Math.max(-options.maxTextIndentMm, valueMm),
  );
}

export function getParagraphIndentAttributes(
  attributes?: Record<string, unknown> | null,
): ParagraphIndentAttributes {
  return {
    leftIndent: toValidIndent(attributes?.leftIndent) ?? 0,
    rightIndent: toValidIndent(attributes?.rightIndent) ?? 0,
    textIndent: toValidIndent(attributes?.textIndent) ?? 0,
  };
}

export const ParagraphIndent = Extension.create<ParagraphIndentOptions>({
  name: "paragraphIndent",

  addOptions() {
    return {
      types: ["paragraph", "heading"],
      stepMm: 10,
      minSideIndentMm: 0,
      maxSideIndentMm: 120,
      maxTextIndentMm: 120,
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          textIndent: {
            default: null,
            parseHTML: (element: Element) => {
              const styleValue = getElementStyleValue(element, "textIndent");
              return (
                toValidIndent(styleValue) ??
                getDataAttributeIndent(element, "data-text-indent")
              );
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const { leftIndent, rightIndent, textIndent } =
                getParagraphIndentAttributes(attributes);
              const textAlign =
                typeof attributes.textAlign === "string"
                  ? attributes.textAlign
                  : null;
              const styles: string[] = [];
              const constrainedWidthMmExpression = `calc(100% - ${leftIndent}mm - ${rightIndent}mm)`;

              if (textAlign) {
                styles.push(`text-align: ${textAlign}`);
              }

              styles.push("box-sizing: border-box");
              styles.push("display: block");
              styles.push(`width: ${constrainedWidthMmExpression}`);
              styles.push(`max-width: ${constrainedWidthMmExpression}`);

              if (leftIndent > 0) {
                styles.push(`margin-left: ${leftIndent}mm`);
              }

              if (rightIndent > 0) {
                styles.push(`margin-right: ${rightIndent}mm`);
              }

              if (textIndent !== 0) {
                styles.push(`text-indent: ${textIndent}mm`);
              }

              return styles.length > 0
                ? {
                    style: styles.join("; "),
                    "data-left-indent": leftIndent || undefined,
                    "data-right-indent": rightIndent || undefined,
                    "data-text-indent": textIndent || undefined,
                  }
                : {};
            },
          },
          leftIndent: {
            default: null,
            parseHTML: (element: Element) => {
              const styleValue = getElementStyleValue(element, "marginLeft");
              return (
                toValidIndent(styleValue) ??
                getDataAttributeIndent(element, "data-left-indent")
              );
            },
            renderHTML: () => ({}),
          },
          rightIndent: {
            default: null,
            parseHTML: (element: Element) => {
              const styleValue = getElementStyleValue(element, "marginRight");
              return (
                toValidIndent(styleValue) ??
                getDataAttributeIndent(element, "data-right-indent")
              );
            },
            renderHTML: () => ({}),
          },
        },
      },
    ];
  },

  addCommands() {
    const getCurrentIndent = (editor: ParagraphAttributeReader) => {
      const targetType = resolveParagraphType(editor, this.options.types);
      return getParagraphIndentAttributes(editor.getAttributes(targetType))
        .textIndent;
    };

    const updateActiveParagraphAttributes = (
      editor: ParagraphAttributeReader,
      commands: ParagraphAttributeCommand,
      attributes: Record<string, unknown>,
    ) => {
      const targetType = resolveParagraphType(editor, this.options.types);
      return commands.updateAttributes(targetType, attributes);
    };

    return {
      setParagraphIndent:
        (valueMm: number | null) =>
        ({ editor, commands }: ParagraphCommandContext) =>
          updateActiveParagraphAttributes(editor, commands, {
            textIndent: toStoredTextIndent(valueMm, this.options),
          }),

      unsetParagraphIndent:
        () =>
        ({ editor, commands }: ParagraphCommandContext) =>
          updateActiveParagraphAttributes(editor, commands, { textIndent: null }),

      increaseParagraphIndent:
        () =>
        ({ editor, commands }: ParagraphCommandContext) =>
          updateActiveParagraphAttributes(editor, commands, {
            textIndent: toStoredTextIndent(
              getCurrentIndent(editor) + this.options.stepMm,
              this.options,
            ),
          }),

      decreaseParagraphIndent:
        () =>
        ({ editor, commands }: ParagraphCommandContext) =>
          updateActiveParagraphAttributes(editor, commands, {
            textIndent: toStoredTextIndent(
              getCurrentIndent(editor) - this.options.stepMm,
              this.options,
            ),
          }),

      setParagraphLeftIndent:
        (valueMm: number | null) =>
        ({ editor, commands }: ParagraphCommandContext) =>
          updateActiveParagraphAttributes(editor, commands, {
            leftIndent: toStoredSideIndent(valueMm, this.options),
          }),

      setParagraphRightIndent:
        (valueMm: number | null) =>
        ({ editor, commands }: ParagraphCommandContext) =>
          updateActiveParagraphAttributes(editor, commands, {
            rightIndent: toStoredSideIndent(valueMm, this.options),
          }),
    };
  },
});
