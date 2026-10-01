import { Extension } from '@tiptap/core';

const INDENT_STYLE_PROPERTIES = ['margin-left', 'margin-right', 'text-indent'] as const;
type IndentStyleProperty = (typeof INDENT_STYLE_PROPERTIES)[number];

function readIndentStyle(element: HTMLElement, property: IndentStyleProperty): string | null {
  const value = element.style.getPropertyValue(property).trim();
  return /^-?\d+(?:\.\d+)?(?:px|pt|pc|in|cm|mm|em|rem|%)$/i.test(value) ? value : null;
}

export const ImportedParagraphFormat = Extension.create({
  name: 'importedParagraphFormat',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          importedIndent: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const indent = Object.fromEntries(
                INDENT_STYLE_PROPERTIES
                  .map((property) => [property, readIndentStyle(element, property)] as const)
                  .filter((entry): entry is readonly [IndentStyleProperty, string] => entry[1] !== null),
              );
              return Object.keys(indent).length > 0 ? indent : null;
            },
            renderHTML: (attributes: { importedIndent?: Partial<Record<IndentStyleProperty, string>> | null }) => {
              const styles = INDENT_STYLE_PROPERTIES
                .map((property) => {
                  const value = attributes.importedIndent?.[property];
                  return value && /^-?\d+(?:\.\d+)?(?:px|pt|pc|in|cm|mm|em|rem|%)$/i.test(value)
                    ? `${property}:${value}`
                    : '';
                })
                .filter(Boolean);
              return styles.length > 0 ? { style: `${styles.join(';')};` } : {};
            },
          },
        },
      },
    ];
  },
});
