import { Node,mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    audioEmbed: {
      insertAudioEmbed: (src: string) => ReturnType;
    };
  }
}

export const AudioEmbed = Node.create({
  name: 'audioEmbed',
  group: 'block',
  atom: true, // single unit — not editable in place, but selectable + deletable
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => element.getAttribute('src') || element.getAttribute('data-src'),
        renderHTML: (attributes) => attributes.src ? { src: attributes.src } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'audio[src]',
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return false;
          return { src: node.getAttribute('src') };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const src = (HTMLAttributes as { src?: string }).src;
    if (!src) return ['div', mergeAttributes(HTMLAttributes, { 'data-audio-embed': '' })];

    return [
      'div',
      mergeAttributes({
        class: 'audio-embed-wrapper',
        style: 'margin: 1rem 0; width: 100%; max-width: 400px;',
      }),
      [
        'audio',
        {
          src,
          controls: 'true',
          style: 'width: 100%;',
        },
      ],
    ];
  },

  addCommands() {
    return {
      insertAudioEmbed:
        (src: string) =>
        ({ commands }) => {
          if (!src) return false;
          return commands.insertContent({ type: this.name, attrs: { src } });
        },
    };
  },
});
