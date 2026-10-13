import Image from "@tiptap/extension-image";

/**
 * Parses width/height HTML attributes into numeric TipTap attrs when present.
 */
function parseDimensionAttribute(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Extends TipTap's image node so escritos can persist stored asset ids and
 * dimensions while remaining compatible with legacy `<img>` HTML.
 */
export const StoredImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      assetId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-asset-id"),
        renderHTML: (attributes) =>
          attributes.assetId ? { "data-asset-id": attributes.assetId } : {},
      },
      width: {
        default: null,
        parseHTML: (element) =>
          parseDimensionAttribute(
            element.getAttribute("data-width") || element.getAttribute("width"),
          ),
        renderHTML: (attributes) =>
          attributes.width
            ? {
                width: attributes.width,
                "data-width": attributes.width,
              }
            : {},
      },
      height: {
        default: null,
        parseHTML: (element) =>
          parseDimensionAttribute(
            element.getAttribute("data-height") || element.getAttribute("height"),
          ),
        renderHTML: (attributes) =>
          attributes.height
            ? {
                height: attributes.height,
                "data-height": attributes.height,
              }
            : {},
      },
    };
  },
});
