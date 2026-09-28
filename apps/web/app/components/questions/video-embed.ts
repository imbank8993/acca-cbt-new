import { Node,mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    videoEmbed: {
      insertVideoEmbed: (src: string, width?: string) => ReturnType;
    };
  }
}

/**
 * Convert common YouTube/Vimeo share URLs into their embeddable iframe src.
 * Returns the original input unchanged if no provider matches.
 */
export function buildVideoEmbedUrl(input: string): string | null {
  const raw = (input || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();

    // YouTube — accept watch?v=, youtu.be/, embed/, shorts/
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (url.pathname.startsWith('/watch')) {
        const id = url.searchParams.get('v');
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
      if (url.pathname.startsWith('/embed/')) {
        return `https://www.youtube.com${url.pathname}`;
      }
      if (url.pathname.startsWith('/shorts/')) {
        const id = url.pathname.split('/')[2];
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
    }
    if (host === 'youtu.be') {
      const id = url.pathname.replace(/^\//, '').split('/')[0];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }

    // Vimeo — accept vimeo.com/<id> and player.vimeo.com/video/<id>
    if (host === 'vimeo.com') {
      const id = url.pathname.replace(/^\//, '').split('/')[0];
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
    if (host === 'player.vimeo.com') {
      return raw;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract YouTube video ID from embed URL for thumbnail.
 */
function extractYouTubeId(src: string): string | null {
  const m = src.match(/youtube\.com\/embed\/([^?&/]+)/);
  return m ? m[1] : null;
}

/**
 * Extract the embeddable src from an existing <iframe> element when parsing
 * stored HTML. We rely on the same YouTube/Vimeo embed hosts, so previously
 * stored content round-trips cleanly.
 */
function extractEmbedSrcFromIframe(src: string | null): string | null {
  if (!src) return null;
  try {
    const url = new URL(src);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtube.com' && url.pathname.startsWith('/embed/')) return src;
    if (host === 'player.vimeo.com' && url.pathname.startsWith('/video/')) return src;
    return src;
  } catch {
    return null;
  }
}

export const VideoEmbed = Node.create({
  name: 'videoEmbed',
  group: 'block',
  atom: true, // single unit — not editable in place, but selectable + deletable
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) =>
          element.tagName === 'IFRAME'
            ? extractEmbedSrcFromIframe((element as HTMLIFrameElement).getAttribute('src'))
            : (element as HTMLElement).getAttribute('data-src'),
        renderHTML: (attributes) =>
          attributes.src ? { 'data-src': attributes.src } : {},
      },
      width: {
        default: '100%',
        parseHTML: (element) => {
          const style = (element as HTMLElement).getAttribute('style') || '';
          const m = style.match(/max-width:\s*([^;]+)/);
          return m ? m[1].trim() : '100%';
        },
        renderHTML: (attributes) => ({ 'data-width': attributes.width || '100%' }),
      },
    };
  },

  parseHTML() {
    // Accept either an <iframe> (round-trip) or a placeholder <div data-src>
    return [
      {
        tag: 'iframe[src]',
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return false;
          const src = extractEmbedSrcFromIframe(node.getAttribute('src'));
          return src ? { src } : false;
        },
      },
      { tag: 'div[data-video-embed]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const src = (HTMLAttributes as { 'data-src'?: string })['data-src']
      ?? (HTMLAttributes as { src?: string }).src;
    const width = (HTMLAttributes as { 'data-width'?: string })['data-width'] || '100%';

    if (!src) return ['div', mergeAttributes(HTMLAttributes, { 'data-video-embed': '' })];

    // Extract YouTube ID to use thumbnail image as static preview in editor
    const ytId = extractYouTubeId(src);
    const thumbnailUrl = ytId
      ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`
      : null;

    const isVimeo = src.includes('vimeo.com');
    const providerLabel = isVimeo ? 'Vimeo' : 'YouTube';

    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-video-embed': '',
        'data-src': src,
        'data-width': width,
        class: 'video-embed-editor-placeholder',
        // Static placeholder — no iframe so it cannot play in editor
        style: [
          `max-width: ${width}`,
          'margin: 1rem auto',
          'border-radius: 0.75rem',
          'overflow: hidden',
          'position: relative',
          'aspect-ratio: 16/9',
          'background: #0f172a',
          'cursor: pointer',
          'display: block',
          'border: 2px dashed #334155',
        ].join(';'),
      }),
      // Thumbnail background image (YouTube only)
      ...(thumbnailUrl
        ? [
            [
              'img',
              {
                src: thumbnailUrl,
                alt: 'Video thumbnail',
                style: 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.5;pointer-events:none;',
              },
            ] as [string, Record<string, string>],
          ]
        : []),
      // Overlay with play/edit buttons
      [
        'div',
        {
          style: [
            'position:absolute',
            'inset:0',
            'display:flex',
            'flex-direction:column',
            'align-items:center',
            'justify-content:center',
            'gap:0.75rem',
            'pointer-events:none',
          ].join(';'),
        },
        // Play button (center)
        [
          'div',
          {
            class: 'video-embed-play-btn',
            title: 'Putar video',
            style: [
              'width:64px',
              'height:64px',
              'border-radius:50%',
              'background:rgba(59,130,246,0.9)',
              'display:flex',
              'align-items:center',
              'justify-content:center',
              'box-shadow:0 4px 24px rgba(0,0,0,0.5)',
              'cursor:pointer',
              'pointer-events:auto',
              'transition:transform 0.15s',
            ].join(';'),
          },
          [
            'img',
            {
              src: "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cpath d='M8 5v14l11-7z'/%3E%3C/svg%3E",
              alt: 'Play',
              style: 'width:30px;height:30px;',
            },
          ],
        ],
        // Provider label + Edit hint
        [
          'span',
          {
            style: [
              'color:white',
              'font-size:11px',
              'font-weight:600',
              'background:rgba(0,0,0,0.55)',
              'padding:3px 10px',
              'border-radius:999px',
              'pointer-events:none',
            ].join(';'),
          },
          `${providerLabel} · Klik gambar untuk edit`,
        ],
      ],
      // Edit button (top-right corner)
      [
        'div',
        {
          class: 'video-embed-edit-btn',
          title: 'Edit video',
          style: [
            'position:absolute',
            'top:10px',
            'right:10px',
            'width:36px',
            'height:36px',
            'border-radius:50%',
            'background:rgba(0,0,0,0.6)',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'cursor:pointer',
            'pointer-events:auto',
            'backdrop-filter:blur(4px)',
          ].join(';'),
        },
        [
          'img',
          {
            src: "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7'/%3E%3Cpath d='M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z'/%3E%3C/svg%3E",
            alt: 'Edit',
            style: 'width:16px;height:16px;',
          },
        ],
      ],
    ];
  },

  addCommands() {
    return {
      insertVideoEmbed:
        (src: string, width = '100%') =>
        ({ commands }) => {
          const embed = buildVideoEmbedUrl(src);
          if (!embed) return false;
          return commands.insertContent({ type: this.name, attrs: { src: embed, width } });
        },
    };
  },
});
