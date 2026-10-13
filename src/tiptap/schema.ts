import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import {
  Color,
  FontFamily,
  FontSize,
  LineHeight,
  TextStyle,
} from "@tiptap/extension-text-style";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import Link from "@tiptap/extension-link";
import { ParagraphIndent } from "./paragraphIndent";
import { StoredImage } from "./storedImage";
import { InlineChange, BlockChange, LineBreakChange } from "./changeNodes";
import { getSchema, type Extensions } from "@tiptap/core";
import { Schema } from "@tiptap/pm/model";

export function createReviewExtensions(): Extensions {
  return [
    StarterKit.configure({
      horizontalRule: false,
      link: false,
      underline: false,
    }),
    TextStyle,
    InlineChange,
    BlockChange,
    LineBreakChange,
    LineHeight,
    Link.configure({
      openOnClick: false,
      autolink: true,
      defaultProtocol: "https",
    }),
    Color,
    FontFamily.configure({
      types: ["textStyle"],
    }),
    FontSize.configure({
      types: ["textStyle"],
    }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    ParagraphIndent.configure({ types: ["paragraph", "heading"] }),
    Underline,

    // Image extension
    StoredImage.configure({
      inline: true,
      allowBase64: true,
      HTMLAttributes: {
        class: "editor-image",
      },
    }),
    // Table extensions
    Table.configure({
      resizable: true,
      allowTableNodeSelection: true,
    }),
    TableRow,
    TableHeader,
    TableCell,
  ];
}

export function buildServerSchema(): Schema {
  return getSchema(createReviewExtensions());
}
