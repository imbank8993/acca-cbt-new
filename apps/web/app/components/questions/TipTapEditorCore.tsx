"use client";
import React, { useCallback, useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import ListItem from '@tiptap/extension-list-item';
import OrderedList from '@tiptap/extension-ordered-list';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import BulletList from '@tiptap/extension-bullet-list';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { Extension } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { DOMSerializer } from '@tiptap/pm/model';
import { Mark, mergeAttributes } from '@tiptap/core';
import { BarChart2, PieChart, LineChart, Table as TableIcon, ImageIcon, LinkIcon, Plus, Minus, Trash2, FunctionSquare, Youtube, X, Mic, Check } from 'lucide-react';
import { MathToolbar } from './MathToolbar';
import { MathRenderer } from './MathRenderer';
import { normalizeLatex, renderLatex } from './math-utils';
import { CustomVideoPlayer } from './CustomVideoPlayer';
import 'mathlive';
import { VideoEmbed, buildVideoEmbedUrl } from './video-embed';
import { AudioEmbed } from './audio-embed';

// Ordered list style options
const ORDERED_LIST_STYLES = [
  { key: 'decimal',  label: '1.  2.  3.' },
  { key: 'paren',    label: '1)  2)  3)' },
  { key: 'roman-l',  label: '(i) (ii) (iii)' },
  { key: 'alpha-l',  label: '(a) (b) (c)' },
  { key: 'roman-u',  label: 'I.  II.  III.' },
  { key: 'alpha-u',  label: 'A.  B.  C.' },
] as const;

// Bullet style options
const BULLET_LIST_STYLES = [
  { key: 'disc',   label: '• bullet (default)' },
  { key: 'circle', label: '○ circle' },
  { key: 'square', label: '■ square' },
  { key: 'diamond',label: '◆ diamond' },
  { key: 'dash',   label: '– dash' },
  { key: 'asterisk', label: '⁎ asterisk' },
  { key: 'arrow',  label: '▸ arrow' },
  { key: 'checkmark', label: '✓ checkmark' },
] as const;

type OrderedListStyleKey = typeof ORDERED_LIST_STYLES[number]['key'];
type BulletListStyleKey = typeof BULLET_LIST_STYLES[number]['key'];

declare global {
  interface Window {
    mathEditorMode: 'visual' | 'latex';
  }
}

// ProseMirror plugin to highlight math text matches ($...$ and $$...$$) on the fly
const MathHighlighter = Extension.create({
  name: 'mathHighlighter',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            const doc = state.doc;
            doc.descendants((node, pos) => {
              if (node.isText && node.text) {
                const regex = /\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$/g;
                let match;
                while ((match = regex.exec(node.text)) !== null) {
                  const matchStr = match[0];
                  const start = pos + match.index;
                  const end = start + matchStr.length;
                  const isBlock = matchStr.startsWith('$$');
                  const latex = isBlock ? matchStr.slice(2, -2) : matchStr.slice(1, -1);
                  
                  // Hide original text
                  decorations.push(
                    Decoration.inline(start, end, {
                      style: 'font-size: 0px; letter-spacing: -1px; color: transparent; pointer-events: none;',
                      class: 'math-original-text'
                    })
                  );
                  
                  // Render math widget
                  decorations.push(
                    Decoration.widget(start, () => {
                      const span = document.createElement('span');
                      span.innerHTML = renderLatex(latex, isBlock).html;
                      span.className = 'math-highlight-editor cursor-pointer hover:bg-blue-50 transition-colors rounded';
                      if (isBlock) {
                        span.style.display = 'inline-block';
                        span.style.width = '100%';
                        span.style.textAlign = 'center';
                        span.style.margin = '1rem 0';
                      } else {
                        span.style.display = 'inline-block';
                        span.style.margin = '0 0.25rem';
                        span.style.verticalAlign = 'middle';
                      }
                      span.dataset.latex = matchStr;
                      span.dataset.start = start.toString();
                      span.dataset.end = end.toString();
                      // To ensure clicks are captured by our handler
                      span.style.userSelect = 'none';
                      return span;
                    })
                  );
                }
              }
            });
            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});

interface TipTapEditorCoreProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  onImageUpload?: (file: File) => Promise<string>;
  onAudioUpload?: (file: File) => Promise<string>;
  minHeight?: string;
}

export default function TipTapEditorCore({
  content,
  onChange,
  placeholder = 'Tulis pertanyaan di sini...',
  editable = true,
  onImageUpload,
  onAudioUpload,
  minHeight = '200px',
}: TipTapEditorCoreProps) {
  const lastContent = useRef('');
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const [showChartModal, setShowChartModal] = useState(false);
  const [showMathModal, setShowMathModal] = useState(false);
  const [showTableModal, setShowTableModal] = useState(false);
  const [tableRowsInput, setTableRowsInput] = useState(3);
  const [tableColsInput, setTableColsInput] = useState(3);
  const [tableHeaderRow, setTableHeaderRow] = useState(true);
  // Table width control — 'auto' means no inline style (browser/default).
  // Otherwise we store a CSS width value like '100%', '75%', or '500px'.
  type TableWidthPreset = 'auto' | '100%' | '75%' | '50%';
  const TABLE_WIDTH_PRESETS: { key: TableWidthPreset; label: string }[] = [
    { key: 'auto', label: 'Otomatis' },
    { key: '50%',  label: '50%' },
    { key: '75%',  label: '75%' },
    { key: '100%', label: '100%' },
  ];
  const [tableWidthPreset, setTableWidthPreset] = useState<TableWidthPreset>('100%');
  const [tableWidthCustom, setTableWidthCustom] = useState<string>('');
  const [mathEditorMode, setMathEditorMode] = useState<'visual' | 'latex'>('visual');
  const [mathInput, setMathInput] = useState('');
  const [isMathBlock, setIsMathBlock] = useState(false);
  const [chartData, setChartData] = useState({
    labels: ['A', 'B', 'C', 'D'],
    datasets: [{
      label: 'Data',
      data: [12, 19, 8, 15],
      backgroundColor: ['#030C4D', '#0038A8', '#10b981', '#ef4444'],
      borderColor: ['#030C4D', '#0038A8', '#10b981', '#ef4444'],
      borderWidth: 1,
    }],
  });
  const [chartType, setChartType] = useState<'bar' | 'pie' | 'line'>('bar');
  const [showImageModal, setShowImageModal] = useState(false);
  const [localImageSrc, setLocalImageSrc] = useState('');
  const [imgWidth, setImgWidth] = useState('400px');
  const [cropAspectRatio, setCropAspectRatio] = useState<'original' | '1:1' | '4:3' | '16:9'>('original');
  const [imgAlign, setImgAlign] = useState<'left' | 'center' | 'right'>('center');
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoError, setVideoError] = useState('');
  const [videoWidth, setVideoWidth] = useState<'100%' | '75%' | '50%'>('100%');
  // Edit video modal state
  const [showEditVideoModal, setShowEditVideoModal] = useState(false);
  const [editVideoUrl, setEditVideoUrl] = useState('');
  const [editVideoWidth, setEditVideoWidth] = useState('100%');
  const [editVideoError, setEditVideoError] = useState('');
  const [editVideoNodePos, setEditVideoNodePos] = useState<number | null>(null);
  // Play video in editor modal state
  const [showVideoPlayModal, setShowVideoPlayModal] = useState(false);
  const [playVideoSrc, setPlayVideoSrc] = useState('');
  const [enableCrop, setEnableCrop] = useState(false);
  const [cropBox, setCropBox] = useState({ x: 20, y: 20, width: 200, height: 120 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [defaultListStyle, setDefaultListStyle] = useState<OrderedListStyleKey | null>(null);
  const [defaultBulletStyle, setDefaultBulletStyle] = useState<BulletListStyleKey | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        orderedList: false,
        bulletList: false,
      }),
      VideoEmbed,
      AudioEmbed,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      OrderedList.configure({
        addAttributes() {
          return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...(this as any).parent?.(),
            listStyle: {
              default: null,
              parseHTML: (element: HTMLElement) => element.getAttribute('data-list-style'),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              renderHTML: (attributes: any) =>
                attributes.listStyle ? { 'data-list-style': attributes.listStyle } : {},
            },
          };
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      BulletList.configure({
        addAttributes() {
          return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...(this as any).parent?.(),
            bulletStyle: {
              default: 'disc',
              parseHTML: (element: HTMLElement) => element.getAttribute('data-bullet-style') || 'disc',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              renderHTML: (attributes: any) =>
                ({ 'data-bullet-style': attributes.bulletStyle }),
            },
          };
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-blue-500 underline' },
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph', 'listItem', 'tableCell', 'tableHeader'],
        alignments: ['left', 'center', 'right', 'justify'],
      }),
      Image.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            width: {
              default: null,
              parseHTML: element => element.getAttribute('width'),
              renderHTML: attributes => {
                if (!attributes.width) return {};
                return { width: attributes.width };
              },
            },
            style: {
              default: null,
              parseHTML: element => element.getAttribute('style'),
              renderHTML: attributes => {
                if (!attributes.style) return {};
                return { style: attributes.style };
              },
            },
          };
        },
      }).configure({
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg',
          loading: 'lazy',
          decoding: 'async',
        },
        inline: false,
        allowBase64: true,
      }),
      Table.configure({
        resizable: true,
        // No `w-full` here so the inline `style="width: ..."` from the active
        // table (set by the width controls) can actually take effect.
        HTMLAttributes: { class: 'border-collapse my-4' },
      }),
      TableRow,
      TableHeader.configure({
        HTMLAttributes: { class: 'border border-slate-300 bg-slate-100 p-3 font-semibold text-sm text-left' },
      }),
      TableCell.configure({
        HTMLAttributes: { class: 'border border-slate-300 p-3 text-sm' },
      }),
      Placeholder.configure({ placeholder }),
      MathHighlighter,
    ],
    content,
    editable,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      if (html !== lastContent.current) {
        lastContent.current = html;
        onChange(html);
      }
    },
    editorProps: {
      attributes: {
        class: 'prose prose-slate max-w-none focus:outline-none px-4 py-3',
        style: `min-height: ${minHeight}`,
      },
      handleClick: (view, pos, event) => {
        let target = event.target as HTMLElement;
        // Walk up the DOM tree in case they clicked inside the rendered katex
        while (target && target !== view.dom) {
          if (target.classList.contains('math-highlight-editor')) {
            const mathText = target.dataset.latex || target.innerText || target.textContent || '';
            let latex = mathText;
            let isBlock = false;
            if (mathText.startsWith('$$') && mathText.endsWith('$$')) {
              latex = mathText.slice(2, -2);
              isBlock = true;
            } else if (mathText.startsWith('$') && mathText.endsWith('$')) {
              latex = mathText.slice(1, -1);
              isBlock = false;
            }
            
            const startStr = target.dataset.start;
            const endStr = target.dataset.end;
            if (startStr && endStr) {
              const s = parseInt(startStr, 10);
              const e = parseInt(endStr, 10);
              view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, s, e)));
            }

            setMathInput(latex);
            setIsMathBlock(isBlock);
            setShowMathModal(true);
            return true;
          }
          target = target.parentElement as HTMLElement;
        }
        return false;
      },
    },
  });

  // Insert math string with delimiters at current cursor position
  const insertMath = useCallback((latex: string, isBlock: boolean) => {
    if (!editor) return;
    const trimmed = latex.trim();
    if (!trimmed) return;
    const formatted = isBlock ? `$$${trimmed}$$` : `$${trimmed}$`;
    editor.chain().focus().insertContent(formatted).run();
  }, [editor]);

  // Keep ref in sync when content is set externally
  useEffect(() => {
    if (editor && lastContent.current === '') {
      lastContent.current = content;
    }
  }, [content, editor]);

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);
  useEffect(() => {
    if (!editor) return;
    const handleEditorClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target && target.tagName === 'IMG') {
        const src = target.getAttribute('src') || '';
        const style = target.getAttribute('style') || '';
        if (src) {
          setLocalImageSrc(src);
          const widthMatch = style.match(/width:\s*([^;]+)/);
          if (widthMatch) {
            setImgWidth(widthMatch[1].trim());
          }
          setShowImageModal(true);
        }
      }
      // Detect click on video embed placeholder
      const videoWrapper = (target as HTMLElement).closest('.video-embed-editor-placeholder') as HTMLElement | null;
      if (videoWrapper) {
        const clickedPlayBtn = (target as HTMLElement).closest('.video-embed-play-btn');
        const clickedEditBtn = (target as HTMLElement).closest('.video-embed-edit-btn');
        
        // Find the TipTap node position
        let pos: number;
        try {
          pos = editor.view.posAtDOM(videoWrapper, 0);
        } catch {
          return;
        }
        const resolvedNode = editor.state.doc.nodeAt(pos);
        const src = resolvedNode?.attrs?.src || videoWrapper.getAttribute('data-src') || '';
        const width = resolvedNode?.attrs?.width || videoWrapper.getAttribute('data-width') || '100%';

        if (clickedPlayBtn && src) {
          // Open play modal
          setPlayVideoSrc(src);
          setShowVideoPlayModal(true);
        } else if (!clickedEditBtn && !clickedPlayBtn) {
          // Clicking anywhere else on placeholder = open edit
          setEditVideoUrl(src);
          setEditVideoWidth(width);
          setEditVideoError('');
          setEditVideoNodePos(pos);
          setShowEditVideoModal(true);
        } else if (clickedEditBtn) {
          setEditVideoUrl(src);
          setEditVideoWidth(width);
          setEditVideoError('');
          setEditVideoNodePos(pos);
          setShowEditVideoModal(true);
        }
      }
    };
    const dom = editor.view.dom;
    dom.addEventListener('click', handleEditorClick);
    return () => {
      dom.removeEventListener('click', handleEditorClick);
    };
  }, [editor]);  const handleImageUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        setLocalImageSrc(e.target.result as string);
        setShowImageModal(true);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const handleAudioUpload = async (file: File) => {
    if (!file || !onAudioUpload) return;
    setIsUploadingAudio(true);
    try {
      const url = await onAudioUpload(file);
      if (editor) {
        editor.chain().focus().insertAudioEmbed(url).run();
      }
    } catch (error) {
      console.error('Audio upload failed', error);
      alert('Gagal mengunggah audio. Silakan coba lagi.');
    } finally {
      setIsUploadingAudio(false);
    }
  };

  const applyImageProcess = () => {
    let marginStyle = 'display: block; margin-left: auto; margin-right: auto;';
    if (imgAlign === 'left') {
      marginStyle = 'display: block; margin-left: 0; margin-right: auto;';
    } else if (imgAlign === 'right') {
      marginStyle = 'display: block; margin-left: auto; margin-right: 0;';
    }
    const inlineWidthStyle = imgWidth !== 'original' ? `width: ${imgWidth}; max-width: 100%;` : 'max-width: 100%;';
    const completeStyle = `${inlineWidthStyle} height: auto; ${marginStyle} margin-top: 0.5rem; margin-bottom: 0.5rem; border-radius: 0.5rem;`;

    if (!enableCrop) {
      if (editor) {
        editor.chain().focus().setImage({
          src: localImageSrc,
          alt: 'Gambar Soal',
          title: 'Gambar Soal',
        } as any).run();
        editor.chain().focus().updateAttributes('image', { style: completeStyle, width: imgWidth !== 'original' ? imgWidth : null }).run();
      }
      setShowImageModal(false);
      setLocalImageSrc('');
      return;
    }

    const img = new window.Image();
    img.src = localImageSrc;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const sw = img.naturalWidth || img.width;
      const sh = img.naturalHeight || img.height;

      let sx = 0;
      let sy = 0;
      let sWidth = sw;
      let sHeight = sh;

      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const scaleX = sw / rect.width;
        const scaleY = sh / rect.height;

        sx = cropBox.x * scaleX;
        sy = cropBox.y * scaleY;
        sWidth = cropBox.width * scaleX;
        sHeight = cropBox.height * scaleY;
      }

      let dw = sWidth;
      let dh = sHeight;
      if (imgWidth !== 'original' && !imgWidth.endsWith('%')) {
        dw = parseInt(imgWidth, 10);
        dh = (sHeight / sWidth) * dw;
      }

      canvas.width = dw;
      canvas.height = dh;
      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, dw, dh);

      const finalBase64 = canvas.toDataURL('image/jpeg', 0.92);

      if (editor) {
        editor.chain().focus().setImage({
          src: finalBase64,
          alt: 'Gambar Soal',
          title: 'Gambar Soal',
        } as any).run();
        editor.chain().focus().updateAttributes('image', { style: completeStyle, width: imgWidth !== 'original' ? imgWidth : null }).run();
      }

      setShowImageModal(false);
      setLocalImageSrc('');
    };
  };

  const addTable = useCallback((rows: number, cols: number, withHeader: boolean) => {
    if (!editor) return;
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: withHeader }).run();
  }, [editor]);

  const videoProviders = [
    { name: 'YouTube', rx: /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/ },
    { name: 'Vimeo',   rx: /vimeo\.com\/(?:video\/)?(\d+)/ },
  ] as const;

  const parseVideo = useCallback((raw: string): { provider: string; id: string; embedUrl: string } | null => {
    const url = raw.trim();
    if (!url) return null;
    for (const p of videoProviders) {
      const m = url.match(p.rx);
      if (m && m[1]) {
        const id = m[1];
        const embedUrl = p.name === 'YouTube'
          ? `https://www.youtube.com/embed/${id}?rel=0`
          : `https://player.vimeo.com/video/${id}`;
        return { provider: p.name, id, embedUrl };
      }
    }
    return null;
  }, []);

  const insertVideo = useCallback(() => {
    if (!editor) return;
    const parsed = parseVideo(videoUrl);
    if (!parsed) {
      setVideoError('URL tidak dikenali. Gunakan link YouTube atau Vimeo yang valid.');
      return;
    }
    const containerStyle = `width: ${videoWidth}; max-width: 100%; margin: 0 auto;`;
    const iframeStyle = 'width: 100%; aspect-ratio: 16/9; border: 0; border-radius: 0.5rem; display: block;';
    const html =
      `<div class="video-embed" data-provider="${parsed.provider}" data-video-id="${parsed.id}" style="${containerStyle}">` +
      `<iframe src="${parsed.embedUrl}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy" style="${iframeStyle}"></iframe>` +
      `</div><p></p>`;
    editor.chain().focus().insertContent(html).run();
    setVideoUrl('');
    setVideoError('');
    setShowVideoModal(false);
  }, [editor, videoUrl, videoWidth, parseVideo]);

  const applyVideoEdit = useCallback(() => {
    if (!editor || editVideoNodePos === null) return;
    const parsed = parseVideo(editVideoUrl);
    if (!parsed) {
      setEditVideoError('URL tidak dikenali. Gunakan link YouTube atau Vimeo yang valid.');
      return;
    }
    // Update TipTap node attributes in-place using setNodeMarkup
    const node = editor.state.doc.nodeAt(editVideoNodePos);
    if (node && node.type.name === 'videoEmbed') {
      editor.chain().focus().command(({ tr }) => {
        tr.setNodeMarkup(editVideoNodePos, undefined, {
          src: parsed.embedUrl,
          width: editVideoWidth,
        });
        return true;
      }).run();
    } else {
      // Fallback: replace with TipTap insertVideoEmbed
      if (node) {
        editor.chain().focus()
          .deleteRange({ from: editVideoNodePos, to: editVideoNodePos + node.nodeSize })
          .insertContentAt(editVideoNodePos, {
            type: 'videoEmbed',
            attrs: { src: parsed.embedUrl, width: editVideoWidth },
          })
          .run();
      }
    }
    setShowEditVideoModal(false);
    setEditVideoNodePos(null);
  }, [editor, editVideoUrl, editVideoWidth, editVideoNodePos, parseVideo]);

  // Resolve the user-picked width (preset or custom) into a CSS width value

  // Resolve the user-picked width (preset or custom) into a CSS width value
  // or null for "auto" (no inline style — defaults to w-full class).
  const buildTableStyle = useCallback((): string | null => {
    const custom = tableWidthCustom.trim();
    if (custom) {
      // Allow "500px", "60%", "30em" — anything that is a single CSS length.
      return `width: ${custom}`;
    }
    if (tableWidthPreset === 'auto') return null;
    return `width: ${tableWidthPreset}`;
  }, [tableWidthPreset, tableWidthCustom]);

  // Apply the chosen width to the active table by setting the `style` attr.
  // Setting style to null lets the editor fall back to default rendering.
  const applyTableWidth = useCallback(() => {
    if (!editor) return;
    const style = buildTableStyle();
    const chain = editor.chain().focus();
    if (style === null) {
      chain.updateAttributes('table', { style: null }).run();
    } else {
      chain.updateAttributes('table', { style }).run();
    }
  }, [editor, buildTableStyle]);

  // Read the current table width from the active table so the modal reflects
  // what is already set when the user re-opens it.
  const readActiveTableWidth = useCallback((): { preset: TableWidthPreset; custom: string } => {
    if (!editor) return { preset: '100%', custom: '' };
    const { state } = editor;
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === 'table') {
        // TipTap Table extension stores inline style; check `style` first, then `width`.
        const style = ((node.attrs as any).style as string | null | undefined) || '';
        const widthAttr = (node.attrs as any).width as string | null | undefined;
        const combined = style || (widthAttr ? `width: ${widthAttr}` : '');
        if (!combined) return { preset: 'auto', custom: '' };
        const match = combined.match(/width\s*:\s*([^;]+)/i);
        if (!match) return { preset: 'auto', custom: '' };
        const value = match[1].trim();
        if (['50%', '75%', '100%'].includes(value)) return { preset: value as TableWidthPreset, custom: '' };
        return { preset: 'auto', custom: value };
      }
    }
    return { preset: '100%', custom: '' };
  }, [editor]);

  // Extract the active <table> HTML from the editor so the right-hand panel
  // can show a true live preview of the table being edited (not a static mock).
  const activeTableHTML = useCallback((): string => {
    if (!editor) return '';
    const { state } = editor;
    const { $from } = state.selection;
    // Walk up the parent chain — $from.depth can be 4+ for cells (cell > row > table > doc).
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === 'table') {
        // ProseMirror's DOMSerializer is the correct API; editor.view doesn't expose one.
        const serializer = DOMSerializer.fromSchema(editor.schema);
        const div = document.createElement('div');
        const serialized = serializer.serializeNode(node);
        div.appendChild(serialized);
        return div.innerHTML;
      }
    }
    return '';
  }, [editor]);

  const [activeTablePreview, setActiveTablePreview] = useState<string>('');
  const [, forcePreviewUpdate] = useState(0);

  // Refresh the active-table preview whenever the editor selection moves
  // or any transaction updates the active table, while the table modal is open.
  // Must be declared before any early `return` to keep hook order stable.
  useEffect(() => {
    if (!editor) return;
    const refresh = () => {
      if (!showTableModal) {
        setActiveTablePreview('');
        return;
      }
      if (!editor.isActive('table')) {
        setActiveTablePreview('');
        return;
      }
      setActiveTablePreview(activeTableHTML());
      // Bump a counter so React re-renders even if the HTML string is identical.
      forcePreviewUpdate(n => n + 1);
    };
    editor.on('selectionUpdate', refresh);
    editor.on('transaction', refresh);
    refresh();
    return () => {
      editor.off('selectionUpdate', refresh);
      editor.off('transaction', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTableModal, editor, activeTableHTML]);

  const insertChartHTML = () => {
    if (!editor) return;
    const chartHTML = `
      <div class="chart-container" style="width:100%;max-width:500px;margin:1rem 0;padding:1rem;background:#f8fafc;border-radius:0.75rem;border:1px solid #e2e8f0;text-align:center">
        <p style="font-size:0.75rem;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:0.5rem">Grafik (${chartType})</p>
        <div style="display:flex;align-items:center;justify-content:center;gap:0.5rem;flex-wrap:wrap;font-size:0.7rem;color:#94a3b8;margin-bottom:0.5rem">
          ${chartData.labels.map((l, i) => `<span style="display:inline-flex;align-items:center;gap:0.25rem"><span style="width:8px;height:8px;border-radius:50%;background:${chartData.datasets[0].backgroundColor[i]}"></span>${l}: ${chartData.datasets[0].data[i]}</span>`).join(' &nbsp;')}
        </div>
        <p style="font-size:0.7rem;color:#cbd5e1;font-style:italic">Grafik ${chartType} - render di preview</p>
      </div>
    `;
    editor.chain().focus().insertContent(chartHTML).run();
    setShowChartModal(false);
  };

  if (!editor) {
    return <div className="border border-slate-200 rounded-lg animate-pulse bg-slate-50" style={{ minHeight }} />;
  }

  const isInTable = editor.isActive('table');
  const selectedTable = isInTable ? editor.state.selection : null;

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white" ref={editorWrapRef}>
      {/* Toolbar */}
      {editable && (
        <div className="editor-toolbar flex items-center gap-1 px-3 py-2 border-b border-slate-100 bg-slate-50/50 flex-wrap">
          {/* Heading */}
          <select
            onChange={(e) => {
              const value = e.target.value;
              if (value === '0') editor.chain().focus().setParagraph().run();
              else editor.chain().focus().toggleHeading({ level: parseInt(value) as 1 | 2 | 3 }).run();
            }}
            value={
              editor.isActive('heading', { level: 1 }) ? '1' :
              editor.isActive('heading', { level: 2 }) ? '2' :
              editor.isActive('heading', { level: 3 }) ? '3' : '0'
            }
            className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 cursor-pointer hover:bg-slate-50 outline-none"
          >
            <option value="0">Paragraf</option>
            <option value="1">H1</option>
            <option value="2">H2</option>
            <option value="3">H3</option>
          </select>

          <div className="w-px h-6 bg-slate-200 mx-1" />

          {/* Bold */}
          <button onClick={() => editor.chain().focus().toggleBold().run()}
            className={`w-8 h-8 flex items-center justify-center rounded-md text-xs font-bold transition-colors ${editor.isActive('bold') ? 'bg-[#030C4D] text-white' : 'hover:bg-slate-100 text-slate-600'}`} title="Bold (B)">
            <span className="font-extrabold">B</span>
          </button>

          {/* Italic */}
          <button onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`w-8 h-8 flex items-center justify-center rounded-md text-xs font-bold italic transition-colors ${editor.isActive('italic') ? 'bg-[#030C4D] text-white' : 'hover:bg-slate-100 text-slate-600'}`} title="Italic">
            <span className="font-serif italic">I</span>
          </button>

          {/* Underline */}
          <button onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={`w-8 h-8 flex items-center justify-center rounded-md text-xs font-bold underline transition-colors ${editor.isActive('underline') ? 'bg-[#030C4D] text-white' : 'hover:bg-slate-100 text-slate-600'}`} title="Underline">
            U
          </button>

          <div className="w-px h-6 bg-slate-200 mx-1" />

          {/* Alignment */}
          <button onClick={() => editor.chain().focus().toggleTextAlign('left').run()}
            className={`w-8 h-8 flex items-center justify-center rounded-md text-xs transition-colors ${editor.isActive({ textAlign: 'left' }) ? 'bg-[#030C4D] text-white' : 'hover:bg-slate-100 text-slate-600'}`} title="Rata Kiri">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="21" y1="6" x2="3" y2="6"/><line x1="15" y1="12" x2="3" y2="12"/><line x1="17" y1="18" x2="3" y2="18"/></svg>
          </button>
          <button onClick={() => editor.chain().focus().toggleTextAlign('center').run()}
            className={`w-8 h-8 flex items-center justify-center rounded-md text-xs transition-colors ${editor.isActive({ textAlign: 'center' }) ? 'bg-[#030C4D] text-white' : 'hover:bg-slate-100 text-slate-600'}`} title="Rata Tengah">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="21" y1="6" x2="3" y2="6"/><line x1="17" y1="12" x2="7" y2="12"/><line x1="19" y1="18" x2="5" y2="18"/></svg>
          </button>
          <button onClick={() => editor.chain().focus().toggleTextAlign('right').run()}
            className={`w-8 h-8 flex items-center justify-center rounded-md text-xs transition-colors ${editor.isActive({ textAlign: 'right' }) ? 'bg-[#030C4D] text-white' : 'hover:bg-slate-100 text-slate-600'}`} title="Rata Kanan">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="12" x2="7" y2="12"/><line x1="21" y1="18" x2="3" y2="18"/></svg>
          </button>
          <button onClick={() => editor.chain().focus().toggleTextAlign('justify').run()}
            className={`w-8 h-8 flex items-center justify-center rounded-md text-xs transition-colors ${editor.isActive({ textAlign: 'justify' }) ? 'bg-[#030C4D] text-white' : 'hover:bg-slate-100 text-slate-600'}`} title="Rata Kiri-Kanan">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="12" x2="3" y2="12"/><line x1="21" y1="18" x2="3" y2="18"/></svg>
          </button>

          <div className="w-px h-6 bg-slate-200 mx-1" />

          {/* Lists */}
          <button onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`w-8 h-8 flex items-center justify-center rounded-md text-xs transition-colors ${editor.isActive('bulletList') ? 'bg-[#030C4D] text-white' : 'hover:bg-slate-100 text-slate-600'}`} title="Daftar Titik">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
          </button>
          <button onClick={() => {
            if (!editor.isActive('orderedList') && defaultListStyle) {
              editor.chain().focus().updateAttributes('orderedList', { listStyle: defaultListStyle }).run();
            }
            editor.chain().focus().toggleOrderedList().run();
          }}
            className={`w-8 h-8 flex items-center justify-center rounded-md text-xs transition-colors ${editor.isActive('orderedList') ? 'bg-[#030C4D] text-white' : 'hover:bg-slate-100 text-slate-600'}`} title="Daftar Nomor">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4" stroke="currentColor" strokeWidth="2"/><path d="M4 10h2" stroke="currentColor" strokeWidth="2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1.5" stroke="currentColor" strokeWidth="2"/></svg>
          </button>
          {editor.isActive('orderedList') && (
            <select
              title="Gaya Daftar Nomor"
              value={editor.getAttributes('orderedList').listStyle ?? 'decimal'}
              onChange={(e) => {
                const value = e.target.value as OrderedListStyleKey;
                editor.chain().focus().updateAttributes('orderedList', { listStyle: value }).run();
                setDefaultListStyle(value);
              }}
              className="text-xs px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 cursor-pointer hover:bg-slate-50 outline-none h-8"
            >
              {ORDERED_LIST_STYLES.map(s => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          )}
          {editor.isActive('bulletList') && (
            <select
              title="Gaya Bullet"
              value={editor.getAttributes('bulletList').bulletStyle ?? 'disc'}
              onChange={(e) => {
                const value = e.target.value as BulletListStyleKey;
                editor.chain().focus().updateAttributes('bulletList', { bulletStyle: value }).run();
                setDefaultBulletStyle(value);
              }}
              className="text-xs px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 cursor-pointer hover:bg-slate-50 outline-none h-8"
            >
              {BULLET_LIST_STYLES.map(s => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          )}

          <div className="w-px h-6 bg-slate-200 mx-1" />

          {/* Image */}
          <label className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer" title="Sisipkan Gambar">
            <ImageIcon size={14} />
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => { const file = e.target.files?.[0]; if (file) handleImageUpload(file); e.target.value = ''; }} />
          </label>
          
          {onAudioUpload && (
            <label className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer" title="Sisipkan Audio">
              <Mic size={14} />
              <input type="file" accept="audio/*" className="hidden"
                onChange={(e) => { const file = e.target.files?.[0]; if (file) handleAudioUpload(file); e.target.value = ''; }} />
            </label>
          )}

          {/* Link */}
          <button onClick={() => { const url = prompt('Masukkan URL:'); if (url) editor.chain().focus().setLink({ href: url }).run(); }}
            className={`w-8 h-8 flex items-center justify-center rounded-md text-xs transition-colors ${editor.isActive('link') ? 'bg-[#030C4D] text-white' : 'hover:bg-slate-100 text-slate-600'}`} title="Sisipkan Link">
            <LinkIcon size={14} />
          </button>

          {/* Video Embed */}
          <button
            onClick={() => setShowVideoModal(true)}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-600 transition-colors"
            title="Sisipkan Video (YouTube / Vimeo)"
          >
            <Youtube size={14} />
          </button>

          <div className="w-px h-6 bg-slate-200 mx-1" />

          {/* Table */}
          <button
            onClick={() => {
              if (!isInTable) {
                setTableRowsInput(3);
                setTableColsInput(3);
                setTableHeaderRow(true);
                setTableWidthPreset('100%');
                setTableWidthCustom('');
              } else {
                // Sync the width controls with the active table's current style.
                const { preset, custom } = readActiveTableWidth();
                setTableWidthPreset(preset);
                setTableWidthCustom(custom);
              }
              setShowTableModal(true);
            }}
            className={`w-8 h-8 flex items-center justify-center rounded-md text-xs transition-colors ${isInTable ? 'bg-[#0038A8] text-white' : 'hover:bg-slate-100 text-slate-600'}`}
            title={isInTable ? "Kelola Tabel" : "Sisipkan Tabel"}
          >
            <TableIcon size={14} />
          </button>

          <div className="w-px h-6 bg-slate-200 mx-1" />

          {/* Chart */}
          <button onClick={() => setShowChartModal(true)}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-600 transition-colors text-xs" title="Sisipkan Grafik">
            <BarChart2 size={14} />
          </button>

          {/* MathJax / LaTeX Formulas */}
          <button onClick={() => { setShowMathModal(!showMathModal); setMathInput(''); }}
            className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors text-xs ${showMathModal ? 'bg-[#030C4D] text-white' : 'hover:bg-slate-100 text-slate-600'}`} title="Sisipkan Rumus Matematika">
            <FunctionSquare size={14} />
          </button>
        </div>
      )}

      {/* MathToolbar Inline Panel */}
      {showMathModal && (
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">Editor Rumus Matematika</span>
            <button onClick={() => setShowMathModal(false)} className="text-xs text-slate-400 hover:text-slate-600 font-semibold px-2 py-1 rounded hover:bg-slate-100">Tutup</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Kiri: LaTeX Templates & Keyboard Toolbar */}
            <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm flex flex-col gap-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Template Rumus</span>
              <MathToolbar onInsert={(latex) => {
                if (mathEditorMode === 'visual') {
                  const mf = document.getElementById('mf-editor') as any;
                  if (mf) {
                    let liveLatex = latex.replace(/\?/g, '#?');
                    mf.executeCommand(['insert', liveLatex]);
                    setMathInput(mf.value);
                  }
                } else {
                  const plainLatex = latex.replace(/\?/g, ' ');
                  setMathInput(prev => prev + plainLatex);
                }
              }} />
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Mode Editor</span>
                <div className="flex gap-2">
                  <button onClick={() => setMathEditorMode('visual')} className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${mathEditorMode === 'visual' ? 'bg-[#030C4D] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Visual (Word)</button>
                  <button onClick={() => setMathEditorMode('latex')} className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${mathEditorMode === 'latex' ? 'bg-[#030C4D] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Kode LaTeX</button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5 relative">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Input Rumus</span>
                {mathEditorMode === 'visual' ? (
                  <div className="w-full min-h-[96px] p-2.5 border border-slate-200 rounded-lg outline-none focus-within:border-slate-400 bg-white">
                    <style>{`
                      math-field::part(menu-toggle) { display: none !important; }
                      math-field::part(virtual-keyboard-toggle) { display: none !important; }
                      math-field {
                        --placeholder-color: transparent;
                        --placeholder-opacity: 1;
                        --prompt-background-color: #f8fafc;
                      }
                      math-field::part(prompt) {
                        border: 1px dashed #94a3b8 !important;
                        background-color: #f1f5f9 !important;
                        border-radius: 2px !important;
                        min-width: 0.8em;
                        min-height: 1em;
                        margin: 0 1px;
                      }
                      math-field::part(placeholder) {
                        border: 1px dashed #94a3b8 !important;
                        background-color: #f1f5f9 !important;
                        border-radius: 2px !important;
                      }
                    `}</style>
                    {/* @ts-ignore */}
                    <math-field 
                      id="mf-editor"
                      style={{ width: '100%', fontSize: '1.25rem', padding: '4px', outline: 'none' }}
                      onInput={(e: any) => {
                        let val = e.target.value;
                        const originalVal = val;
                        // Force placeholders for extensible accents that natively drop them when empty
                        val = val.replace(/\\overrightarrow\{\}/g, '\\overrightarrow{\\placeholder{}}')
                                 .replace(/\\widehat\{\}/g, '\\widehat{\\placeholder{}}')
                                 .replace(/\\overline\{\}/g, '\\overline{\\placeholder{}}')
                                 .replace(/\\wideparen\{\}/g, '\\wideparen{\\placeholder{}}')
                                 .replace(/\\underline\{\}/g, '\\underline{\\placeholder{}}');
                        
                        if (val !== originalVal) {
                          e.target.value = val;
                          e.target.executeCommand(['moveToNextPlaceholder']);
                        }
                        setMathInput(val);
                      }}
                      ref={(el: any) => {
                        if (el) {
                          if (el.value !== mathInput) {
                            el.value = mathInput;
                          }
                          // Gunakan karakter Dotted Square (U+2B1A) agar tampil seperti garis putus-putus
                          // tanpa mengandalkan CSS Shadow DOM yang sering tertimpa oleh MathLive.
                          el.placeholderSymbol = '⬚';
                        }
                      }}
                    >
                    {/* @ts-ignore */}
                    </math-field>
                  </div>
                ) : (
                  <textarea
                    value={mathInput}
                    onChange={(e) => setMathInput(e.target.value)}
                    placeholder="Ketik rumus Anda di sini (misal: \frac{a}{b})"
                    className="w-full h-24 p-2.5 text-xs font-mono border border-slate-200 rounded-lg outline-none focus:border-slate-400 resize-none"
                  />
                )}
              </div>

              {/* Live Preview (Only for LaTeX mode as Visual mode already shows it) */}
              {mathEditorMode === 'latex' && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pratinjau Rumus</span>
                  <div className="p-3 border border-slate-100 rounded-lg bg-slate-50 min-h-[48px] flex items-center justify-center text-sm overflow-x-auto">
                    <MathRenderer latex={mathInput || ' '} displayMode={isMathBlock} />
                  </div>
                </div>
              )}

              {/* Tombol Sisipkan */}
              <button
                onClick={() => {
                  if (mathInput.trim()) {
                    insertMath(mathInput, isMathBlock);
                    setMathInput('');
                    setShowMathModal(false);
                  }
                }}
                className="w-full mt-auto py-2 bg-[#030C4D] hover:bg-[#020735] text-white font-bold text-xs rounded-lg transition-colors shadow-sm"
              >
                Sisipkan ke Soal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Editor Content */}
      <EditorContent editor={editor} />

      {/* Chart Modal */}
      {showChartModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-[#030C4D]">Sisipkan Grafik</h3>
              <button onClick={() => setShowChartModal(false)} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:bg-slate-200">
                <span>&times;</span>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Tipe Grafik</label>
                <div className="flex gap-2">
                  {[
                    { type: 'bar', icon: BarChart2, label: 'Bar' },
                    { type: 'pie', icon: PieChart, label: 'Pie' },
                    { type: 'line', icon: LineChart, label: 'Line' },
                  ].map((ct) => (
                    <button key={ct.type} onClick={() => setChartType(ct.type as typeof chartType)}
                      className={`flex-1 py-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all border-2 ${
                        chartType === ct.type ? 'bg-[#030C4D] text-white border-[#030C4D]' : 'border-slate-200 text-slate-600 hover:border-[#030C4D]'
                      }`}>
                      <ct.icon size={16} /> {ct.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Label & Nilai</label>
                <div className="space-y-2">
                  {chartData.labels.map((label, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full shrink-0" style={{ backgroundColor: chartData.datasets[0].backgroundColor[i] }} />
                      <input
                        type="text"
                        value={label}
                        onChange={(e) => {
                          const newLabels = [...chartData.labels];
                          newLabels[i] = e.target.value;
                          setChartData({ ...chartData, labels: newLabels });
                        }}
                        className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#030C4D]/30"
                        placeholder={`Label ${i + 1}`}
                      />
                      <input
                        type="number"
                        value={chartData.datasets[0].data[i]}
                        onChange={(e) => {
                          const newData = [...chartData.datasets[0].data];
                          newData[i] = parseInt(e.target.value) || 0;
                          setChartData({
                            ...chartData,
                            datasets: [{ ...chartData.datasets[0], data: newData }],
                          });
                        }}
                        className="w-20 px-3 py-2 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:border-[#030C4D]/30"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Preview</label>
                <div className="bg-slate-50 rounded-lg p-4 text-center border border-slate-200">
                  <div className="flex items-center justify-center gap-2 mb-3">
                    {chartData.labels.map((l, i) => (
                      <div key={i} className="flex items-center gap-1 text-xs text-slate-600">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: chartData.datasets[0].backgroundColor[i] }} />
                        <span>{l}: {chartData.datasets[0].data[i]}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-end justify-center gap-1 h-16">
                    {chartData.datasets[0].data.map((v, i) => (
                      <div key={i} className="flex-1 rounded-sm max-w-8 transition-all"
                        style={{ height: `${Math.max(4, (v / Math.max(...chartData.datasets[0].data)) * 100)}%`, backgroundColor: chartData.datasets[0].backgroundColor[i] }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex gap-3">
              <button onClick={() => setShowChartModal(false)} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg font-semibold text-sm hover:bg-slate-200 transition-colors">Batal</button>
              <button onClick={insertChartHTML} className="flex-1 py-2.5 bg-[#030C4D] text-white rounded-lg font-semibold text-sm hover:bg-[#0a1a6e] transition-colors flex items-center justify-center gap-2">
                <Plus size={16} /> Sisipkan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Manager Modal */}
      {showImageModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-[#030C4D]">Sesuaikan & Edit Gambar Soal</h3>
              <button onClick={() => setShowImageModal(false)} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:bg-slate-200">
                <span>&times;</span>
              </button>
            </div>
            
            <div className="p-6 grid grid-cols-1 md:grid-cols-12 gap-6">
              {/* Left Column: Settings (5 cols) */}
              <div className="md:col-span-5 space-y-5">
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase mb-2.5 block">Lebar Gambar</label>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {['original', '30%', '50%', '75%', '100%'].map((w) => (
                      <button key={w} onClick={() => setImgWidth(w)}
                        className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all border cursor-pointer ${
                          imgWidth === w ? 'bg-[#030C4D] text-white border-[#030C4D]' : 'border-slate-200 text-slate-600 hover:border-[#030C4D]'
                        }`}>
                        {w === 'original' ? 'Asli' : w}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Lebar Kustom:</span>
                    <input
                      type="text"
                      placeholder="Contoh: 350px atau 65%"
                      value={imgWidth !== 'original' ? imgWidth : ''}
                      onChange={(e) => setImgWidth(e.target.value)}
                      className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-[#030C4D]"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase mb-2.5 block">Perataan Gambar</label>
                  <div className="flex gap-1.5">
                    {[
                      { key: 'left', label: 'Kiri' },
                      { key: 'center', label: 'Tengah' },
                      { key: 'right', label: 'Kanan' },
                    ].map((align) => (
                      <button key={align.key} onClick={() => setImgAlign(align.key as any)}
                        className={`flex-1 py-2 rounded-lg text-[10px] font-semibold transition-all border cursor-pointer ${
                          imgAlign === align.key ? 'bg-[#030C4D] text-white border-[#030C4D]' : 'border-slate-200 text-slate-600 hover:border-[#030C4D]'
                        }`}>
                        {align.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="enable-crop-chk"
                      checked={enableCrop}
                      onChange={(e) => setEnableCrop(e.target.checked)}
                      className="w-4 h-4 text-[#030C4D] border-slate-300 rounded focus:ring-[#030C4D] cursor-pointer"
                    />
                    <label htmlFor="enable-crop-chk" className="text-xs font-bold text-slate-600 select-none cursor-pointer">
                      Aktifkan Pemotongan Gambar (Crop)
                    </label>
                  </div>
                </div>
              </div>

              {/* Right Column: Live Preview Area (7 cols) */}
              <div className="md:col-span-7 flex flex-col items-center justify-center border border-slate-100 rounded-xl p-4 bg-slate-50 min-h-[260px] relative">
                <span className="text-[10px] font-bold text-slate-400 uppercase mb-3 block">Pratinjau Tampilan</span>
                
                {enableCrop ? (
                  // Cropping canvas overlay
                  <div className="flex flex-col items-center gap-2 w-full">
                    <span className="text-[9px] text-slate-400 font-semibold text-center mb-1">Seret kotak biru untuk mengatur pemotongan</span>
                    <div
                      ref={containerRef}
                      onMouseMove={(e) => {
                        if (!containerRef.current) return;
                        const rect = containerRef.current.getBoundingClientRect();
                        if (isDragging) {
                          let newX = e.clientX - dragStart.x;
                          let newY = e.clientY - dragStart.y;
                          newX = Math.max(0, Math.min(rect.width - cropBox.width, newX));
                          newY = Math.max(0, Math.min(rect.height - cropBox.height, newY));
                          setCropBox(prev => ({ ...prev, x: newX, y: newY }));
                        } else if (isResizing) {
                          let newW = e.clientX - rect.left - cropBox.x;
                          let newH = e.clientY - rect.top - cropBox.y;
                          newW = Math.max(20, Math.min(rect.width - cropBox.x, newW));
                          newH = Math.max(20, Math.min(rect.height - cropBox.y, newH));
                          setCropBox(prev => ({ ...prev, width: newW, height: newH }));
                        }
                      }}
                      onMouseUp={() => {
                        setIsDragging(false);
                        setIsResizing(false);
                      }}
                      onMouseLeave={() => {
                        setIsDragging(false);
                        setIsResizing(false);
                      }}
                      className="relative select-none max-w-full max-h-[220px] overflow-hidden flex items-center justify-center bg-slate-200 rounded-lg cursor-default"
                      style={{ cursor: isDragging ? 'move' : isResizing ? 'se-resize' : 'default' }}
                    >
                      <img src={localImageSrc} alt="Image Preview" className="max-w-full max-h-[220px] rounded-lg object-contain select-none pointer-events-none" />

                      {/* Interactive Crop Box */}
                      <div
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setIsDragging(true);
                          setDragStart({
                            x: e.clientX - cropBox.x,
                            y: e.clientY - cropBox.y,
                          });
                        }}
                        style={{
                          position: 'absolute',
                          left: `${cropBox.x}px`,
                          top: `${cropBox.y}px`,
                          width: `${cropBox.width}px`,
                          height: `${cropBox.height}px`,
                          border: '2px solid #2563eb',
                          backgroundColor: 'rgba(37, 99, 235, 0.15)',
                          boxShadow: '0 0 0 4000px rgba(0, 0, 0, 0.5)',
                          cursor: 'move',
                        }}
                        className="z-10"
                      >
                        {/* Resize handle */}
                        <div
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setIsResizing(true);
                          }}
                          style={{
                            position: 'absolute',
                            bottom: '-5px',
                            right: '-5px',
                            width: '10px',
                            height: '10px',
                            backgroundColor: '#2563eb',
                            border: '2px solid #ffffff',
                            borderRadius: '50%',
                            cursor: 'se-resize',
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  // Styled Live Preview inside document simulator
                  <div className="w-full bg-white border border-dashed border-slate-300 rounded-lg p-4 min-h-[220px] flex flex-col justify-center shadow-inner">
                    <p className="text-[9px] text-slate-300 text-center mb-3 italic border-b border-slate-100 pb-1 select-none">Batas Kolom Editor</p>
                    <div className="w-full flex" style={{
                      justifyContent: imgAlign === 'left' ? 'flex-start' : imgAlign === 'right' ? 'flex-end' : 'center'
                    }}>
                      <img 
                        src={localImageSrc} 
                        alt="Live Style Preview" 
                        className="rounded-lg shadow-sm border border-slate-200 transition-all duration-200"
                        style={{
                          width: imgWidth === 'original' ? '100%' : imgWidth,
                          maxWidth: '100%',
                          height: 'auto'
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            <div className="px-6 py-4 border-t border-slate-200 flex gap-3">
              <button onClick={() => setShowImageModal(false)} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg font-semibold text-sm hover:bg-slate-200 transition-colors cursor-pointer">Batal</button>
              <button onClick={applyImageProcess} className="flex-1 py-2.5 bg-[#030C4D] text-white rounded-lg font-semibold text-sm hover:bg-[#0a1a6e] transition-colors flex items-center justify-center gap-2 cursor-pointer">
                <Plus size={16} /> Sisipkan ke Soal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Video Embed Modal */}
      {showVideoModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-[#030C4D] flex items-center gap-2">
                <Youtube size={18} className="text-red-500" /> Sisipkan Video
              </h3>
              <button onClick={() => setShowVideoModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer" title="Tutup">
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">Tautan Video</label>
                <input
                  type="text"
                  value={videoUrl}
                  onChange={(e) => { setVideoUrl(e.target.value); setVideoError(''); }}
                  placeholder="https://www.youtube.com/watch?v=... atau https://youtu.be/... atau https://vimeo.com/..."
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-[#030C4D]"
                  onKeyDown={(e) => { if (e.key === 'Enter') insertVideo(); }}
                  autoFocus
                />
                {videoError && (
                  <p className="text-xs text-red-600 mt-1.5">{videoError}</p>
                )}
                <p className="text-[11px] text-slate-500 mt-1.5">
                  Mendukung <strong>YouTube</strong> dan <strong>Vimeo</strong>. Tempelkan URL lengkap (contoh: <code className="bg-slate-100 px-1 rounded">https://youtu.be/dQw4w9WgXcQ</code>).
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(['100%', '75%', '50%'] as const).map((w) => (
                  <button
                    key={w}
                    onClick={() => setVideoWidth(w)}
                    className={`py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                      videoWidth === w
                        ? 'bg-[#030C4D] text-white border-[#030C4D]'
                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex gap-3">
              <button
                onClick={() => setShowVideoModal(false)}
                className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg font-semibold text-sm hover:bg-slate-200 transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                onClick={insertVideo}
                className="flex-1 py-2.5 bg-[#030C4D] text-white rounded-lg font-semibold text-sm hover:bg-[#0a1a6e] transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Plus size={16} /> Sisipkan Video
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Video Modal - opens when clicking an existing video in editor */}
      {showEditVideoModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
              <h3 className="font-bold text-[#030C4D] flex items-center gap-2 text-base">
                <Youtube size={18} className="text-red-500" /> Edit Video
              </h3>
              <button
                onClick={() => { setShowEditVideoModal(false); setEditVideoNodePos(null); }}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-colors cursor-pointer"
                title="Tutup"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* URL Input */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Tautan Video
                </label>
                <input
                  type="text"
                  value={editVideoUrl}
                  onChange={(e) => { setEditVideoUrl(e.target.value); setEditVideoError(''); }}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#030C4D] focus:ring-2 focus:ring-[#030C4D]/10 transition-all"
                  onKeyDown={(e) => { if (e.key === 'Enter') applyVideoEdit(); }}
                  autoFocus
                />
                {editVideoError && (
                  <p className="text-xs text-red-600 mt-1.5">{editVideoError}</p>
                )}
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Mendukung <strong>YouTube</strong> dan <strong>Vimeo</strong>.
                </p>
              </div>

              {/* Size Selector - Presets + Custom */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Ukuran Tampilan
                </label>
                {/* Preset buttons */}
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {[
                    { w: '25%', label: '25%' },
                    { w: '50%', label: '50%' },
                    { w: '75%', label: '75%' },
                    { w: '100%', label: '100%' },
                  ].map(({ w, label }) => (
                    <button
                      key={w}
                      onClick={() => setEditVideoWidth(w)}
                      className={`py-2 text-xs font-semibold rounded-lg border-2 transition-all cursor-pointer ${
                        editVideoWidth === w
                          ? 'bg-[#030C4D] text-white border-[#030C4D] shadow-md'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-[#030C4D]/40 hover:bg-slate-50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* Custom size input */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 whitespace-nowrap">Kustom:</span>
                  <input
                    type="text"
                    value={editVideoWidth}
                    onChange={(e) => setEditVideoWidth(e.target.value)}
                    placeholder="contoh: 600px, 80%, auto"
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#030C4D] focus:ring-2 focus:ring-[#030C4D]/10 transition-all font-mono"
                  />
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Gunakan nilai CSS: <code className="bg-slate-100 px-1 rounded">100%</code>, <code className="bg-slate-100 px-1 rounded">600px</code>, <code className="bg-slate-100 px-1 rounded">80%</code>, dll.
                </p>
              </div>

              {/* Preview hint */}
              <div className="bg-blue-50 rounded-xl px-4 py-3 text-[11px] text-blue-700 flex items-start gap-2 border border-blue-100">
                <span className="mt-0.5">🔒</span>
                <span>Video akan aman dari akses siswa — hanya dapat diputar di dalam halaman ujian, tidak dapat membuka YouTube.</span>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex gap-3 bg-slate-50/50">
              <button
                onClick={() => { setShowEditVideoModal(false); setEditVideoNodePos(null); }}
                className="flex-1 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl font-semibold text-sm hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                onClick={applyVideoEdit}
                className="flex-1 py-2.5 bg-[#030C4D] text-white rounded-xl font-semibold text-sm hover:bg-[#0a1a6e] transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md"
              >
                <Check size={15} /> Simpan Perubahan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Play Video Modal - plays video inline without leaving editor */}
      {showVideoPlayModal && playVideoSrc && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setShowVideoPlayModal(false)}
        >
          <div
            className="w-full max-w-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-white font-semibold text-sm flex items-center gap-2">
                <Youtube size={16} className="text-red-400" /> Pratinjau Video
              </span>
              <button
                onClick={() => setShowVideoPlayModal(false)}
                className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="w-full rounded-2xl overflow-hidden shadow-2xl">
              <CustomVideoPlayer url={playVideoSrc} width="100%" />
            </div>
          </div>
        </div>
      )}

      {/* Table Manager Modal */}
      {showTableModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-[#030C4D]">
                {isInTable ? 'Kelola & Edit Tabel Soal' : 'Sisipkan Tabel Baru'}
              </h3>
              <button 
                onClick={() => setShowTableModal(false)} 
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:bg-slate-200 cursor-pointer"
              >
                <span>&times;</span>
              </button>
            </div>
            
            <div className="p-6">
              {!isInTable ? (
                // Buat Tabel Baru
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  {/* Left Column: Settings (5 cols) */}
                  <div className="md:col-span-5 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Baris</label>
                        <div className="flex items-center">
                          <button 
                            onClick={() => setTableRowsInput(r => Math.max(1, r - 1))}
                            className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-l-lg text-slate-600 font-bold cursor-pointer"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={30}
                            value={tableRowsInput}
                            onChange={(e) => setTableRowsInput(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-12 h-8 text-center border-y border-slate-200 text-sm focus:outline-none"
                          />
                          <button 
                            onClick={() => setTableRowsInput(r => Math.min(30, r + 1))}
                            className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-r-lg text-slate-600 font-bold cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Kolom</label>
                        <div className="flex items-center">
                          <button 
                            onClick={() => setTableColsInput(c => Math.max(1, c - 1))}
                            className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-l-lg text-slate-600 font-bold cursor-pointer"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={30}
                            value={tableColsInput}
                            onChange={(e) => setTableColsInput(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-12 h-8 text-center border-y border-slate-200 text-sm focus:outline-none"
                          />
                          <button 
                            onClick={() => setTableColsInput(c => Math.min(30, c + 1))}
                            className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-r-lg text-slate-600 font-bold cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                      <input
                        type="checkbox"
                        id="header-row-chk"
                        checked={tableHeaderRow}
                        onChange={(e) => setTableHeaderRow(e.target.checked)}
                        className="w-4 h-4 text-[#030C4D] border-slate-300 rounded focus:ring-[#030C4D] cursor-pointer"
                      />
                      <label htmlFor="header-row-chk" className="text-xs font-semibold text-slate-600 select-none cursor-pointer">
                        Gunakan Baris Header (Baris 1 Tebal)
                      </label>
                    </div>
                  </div>

                  {/* Right Column: Live Grid Preview (7 cols) */}
                  <div className="md:col-span-7 border border-slate-100 bg-slate-50 rounded-xl p-4 flex flex-col items-center justify-center min-h-[160px] relative">
                    <span className="text-[10px] font-bold text-slate-400 uppercase mb-3 block">Pratinjau Struktur ({tableRowsInput} x {tableColsInput})</span>
                    <div className="w-full max-h-[150px] overflow-auto p-1 bg-white border border-slate-200 rounded-lg shadow-inner">
                      <table className="w-full border-collapse">
                        <tbody>
                          {Array.from({ length: Math.min(6, tableRowsInput) }).map((_, rIdx) => (
                            <tr key={rIdx}>
                              {Array.from({ length: Math.min(6, tableColsInput) }).map((_, cIdx) => {
                                const isHeader = rIdx === 0 && tableHeaderRow;
                                return (
                                  <td 
                                    key={cIdx} 
                                    className={`border border-slate-200 p-2 text-center text-[10px] transition-all ${
                                      isHeader ? 'bg-[#030C4D]/10 font-bold text-[#030C4D]' : 'bg-white'
                                    }`}
                                  >
                                    {isHeader ? 'Header' : ''}
                                  </td>
                                );
                              })}
                              {tableColsInput > 6 && (
                                <td className="border border-dashed border-slate-200 p-2 text-center text-[10px] text-slate-400">...</td>
                              )}
                            </tr>
                          ))}
                          {tableRowsInput > 6 && (
                            <tr>
                              <td 
                                colSpan={Math.min(7, tableColsInput + (tableColsInput > 6 ? 1 : 0))} 
                                className="border border-dashed border-slate-200 p-1.5 text-center text-[10px] text-slate-400"
                              >
                                ...
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                // Kelola Tabel yang Ada
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  {/* Left Column: Management Actions */}
                  <div className="md:col-span-5 space-y-4">
                    <div className="flex flex-col gap-2.5">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Baris (Rows)</span>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => {
                            editor.chain().focus().addRowBefore().run();
                            setShowTableModal(false);
                          }}
                          className="py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
                        >
                          Sisipkan di Atas
                        </button>
                        <button
                          onClick={() => {
                            editor.chain().focus().addRowAfter().run();
                            setShowTableModal(false);
                          }}
                          className="py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
                        >
                          Sisipkan di Bawah
                        </button>
                      </div>
                      <button
                        onClick={() => {
                          editor.chain().focus().deleteRow().run();
                          setShowTableModal(false);
                        }}
                        className="w-full py-2 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg text-xs font-semibold text-red-700 transition-colors cursor-pointer"
                      >
                        Hapus Baris Ini
                      </button>
                    </div>

                    <div className="w-full h-px bg-slate-100" />

                    <div className="flex flex-col gap-2.5">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Kolom (Columns)</span>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => {
                            editor.chain().focus().addColumnBefore().run();
                            setShowTableModal(false);
                          }}
                          className="py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
                        >
                          Sisipkan Sebelum
                        </button>
                        <button
                          onClick={() => {
                            editor.chain().focus().addColumnAfter().run();
                            setShowTableModal(false);
                          }}
                          className="py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
                        >
                          Sisipkan Sesudah
                        </button>
                      </div>
                      <button
                        onClick={() => {
                          editor.chain().focus().deleteColumn().run();
                          setShowTableModal(false);
                        }}
                        className="w-full py-2 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg text-xs font-semibold text-red-700 transition-colors cursor-pointer"
                      >
                        Hapus Kolom Ini
                      </button>
                    </div>

                    <div className="w-full h-px bg-slate-100" />

                    {/* Lebar Tabel */}
                    <div className="flex flex-col gap-2.5">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Lebar Tabel</span>
                      <div className="grid grid-cols-4 gap-1.5">
                        {TABLE_WIDTH_PRESETS.map(p => (
                          <button
                            key={p.key}
                            onClick={() => {
                              setTableWidthPreset(p.key);
                              setTableWidthCustom('');
                            }}
                            className={`py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                              tableWidthPreset === p.key && !tableWidthCustom
                                ? 'bg-[#030C4D] text-white border-[#030C4D]'
                                : 'border-slate-200 text-slate-600 hover:border-[#030C4D]'
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500 font-semibold w-14 shrink-0">Kustom</span>
                        <input
                          type="text"
                          value={tableWidthCustom}
                          onChange={(e) => setTableWidthCustom(e.target.value)}
                          placeholder="mis. 500px / 60% / 30em"
                          className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-[#030C4D]"
                        />
                      </div>
                      <button
                        onClick={() => {
                          applyTableWidth();
                          setShowTableModal(false);
                        }}
                        className="w-full py-2 bg-[#030C4D] hover:bg-[#0a1a6e] text-white rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        Terapkan Lebar
                      </button>
                    </div>
                  </div>

                  {/* Right Column: Live Active-Table Preview */}
                  <div className="md:col-span-7 border border-slate-100 bg-slate-50 rounded-xl p-4 flex flex-col items-stretch justify-start min-h-[220px] relative">
                    <span className="text-[10px] font-bold text-slate-400 uppercase mb-3 block text-center">Pratinjau Tabel Aktif</span>

                    <div className="flex justify-center">
                      <div
                        className="tiptap-live-preview max-h-[260px] overflow-auto p-3 bg-white border border-slate-200 rounded-lg shadow-inner"
                        style={(() => {
                          const custom = tableWidthCustom.trim();
                          if (custom) return { width: custom, maxWidth: '100%' };
                          if (tableWidthPreset === 'auto') return { maxWidth: '100%' };
                          return { width: tableWidthPreset, maxWidth: '100%' };
                        })()}
                        dangerouslySetInnerHTML={{ __html: activeTablePreview }}
                      />
                    </div>

                    {activeTablePreview ? (
                      <p className="mt-3 text-[11px] text-slate-500 text-center leading-relaxed">
                        Tampilan di atas mengikuti tabel yang sedang dipilih di editor. Gunakan panel kiri untuk menambah atau menghapus baris/kolom.
                      </p>
                    ) : (
                      <p className="mt-3 text-[11px] text-slate-400 text-center italic leading-relaxed">
                        Letakkan kursor di dalam tabel pada editor untuk melihat pratinjau di sini.
                      </p>
                    )}

                    <button
                      onClick={() => {
                        if (confirm('Apakah Anda yakin ingin menghapus seluruh tabel ini?')) {
                          editor.chain().focus().deleteTable().run();
                          setShowTableModal(false);
                        }
                      }}
                      className="mt-4 w-full py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                    >
                      <Trash2 size={14} /> Hapus Seluruh Tabel
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex gap-3">
              <button 
                onClick={() => setShowTableModal(false)} 
                className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg font-semibold text-sm hover:bg-slate-200 transition-colors cursor-pointer text-center"
              >
                {isInTable ? 'Tutup' : 'Batal'}
              </button>
              {!isInTable && (
                <button 
                  onClick={() => {
                    addTable(tableRowsInput, tableColsInput, tableHeaderRow);
                    // Apply chosen width to the freshly inserted table.
                    requestAnimationFrame(() => applyTableWidth());
                    setShowTableModal(false);
                  }}
                  className="flex-1 py-2.5 bg-[#030C4D] text-white rounded-lg font-semibold text-sm hover:bg-[#0a1a6e] transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Plus size={16} /> Sisipkan Tabel
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .tiptap-live-preview table { border-collapse: collapse; width: 100%; margin: 0; }
        .tiptap-live-preview th,
        .tiptap-live-preview td {
          border: 1px solid #cbd5e1;
          padding: 0.5rem 0.75rem;
          font-size: 0.8125rem;
          text-align: left;
          background: #ffffff;
        }
        .tiptap-live-preview th {
          background-color: #f1f5f9;
          font-weight: 600;
          color: #0f172a;
        }
        .ProseMirror {
          min-height: 200px;
          padding: 1rem;
          outline: none;
          word-wrap: break-word;
          overflow-wrap: anywhere;
          word-break: normal;
          white-space: pre-wrap;
        }
        .ProseMirror p { margin: 0 0 0.75rem 0; }
        .ProseMirror p:last-child { margin-bottom: 0; }
        .ProseMirror h1, .ProseMirror h2, .ProseMirror h3 { font-weight: 700; margin: 1.5rem 0 0.75rem 0; color: #1e293b; }
        .ProseMirror h1:first-child, .ProseMirror h2:first-child, .ProseMirror h3:first-child { margin-top: 0; }
        .ProseMirror ul {
          list-style-type: disc !important;
          padding-left: 2rem !important;
          margin: 0.75rem 0 !important;
        }
        /* Custom bullet list styles */
        .ProseMirror ul[data-bullet-style="square"]  { list-style-type: square !important; }
        .ProseMirror ul[data-bullet-style="dash"]    { list-style-type: none !important; padding-left: 1.5rem !important; }
        .ProseMirror ul[data-bullet-style="dash"] > li::before { content: "– "; font-weight: bold; }
        .ProseMirror ul[data-bullet-style="arrow"]   { list-style-type: none !important; padding-left: 1.5rem !important; }
        .ProseMirror ul[data-bullet-style="arrow"] > li::before { content: "→ "; }
        .ProseMirror ul[data-bullet-style="check"]   { list-style-type: none !important; padding-left: 1.5rem !important; }
        .ProseMirror ul[data-bullet-style="check"] > li::before { content: "✔ "; color: #059669; }
        .ProseMirror ul[data-bullet-style="circle"] { list-style-type: circle !important; }
        .ProseMirror ul[data-bullet-style="disc"]    { list-style-type: disc !important; }
        .ProseMirror ol {
          list-style-type: decimal !important;
          padding-left: 2rem !important;
          margin: 0.75rem 0 !important;
        }
        /* Custom ordered list styles */
        .ProseMirror ol[data-list-style="paren"] { list-style-type: decimal !important; }
        .ProseMirror ol[data-list-style="roman-l"],
        .ProseMirror ol[data-list-style="alpha-l"],
        .ProseMirror ol[data-list-style="roman-u"],
        .ProseMirror ol[data-list-style="alpha-u"] {
          list-style-type: none !important;
          padding-left: 1.5rem !important;
        }
        .ProseMirror ol[data-list-style="roman-l"] > li::before { content: "(" counter(list-item, lower-roman) ") "; }
        .ProseMirror ol[data-list-style="roman-l"] > li         { counter-increment: list-item; }
        .ProseMirror ol[data-list-style="alpha-l"] > li::before { content: "(" counter(list-item, lower-alpha) ") "; }
        .ProseMirror ol[data-list-style="alpha-l"] > li         { counter-increment: list-item; }
        .ProseMirror ol[data-list-style="roman-u"] > li::before { content: counter(list-item, upper-roman) ". "; }
        .ProseMirror ol[data-list-style="roman-u"] > li         { counter-increment: list-item; }
        .ProseMirror ol[data-list-style="alpha-u"] > li::before { content: counter(list-item, upper-alpha) ". "; }
        .ProseMirror ol[data-list-style="alpha-u"] > li         { counter-increment: list-item; }
        .ProseMirror ol[data-list-style="paren"] > li::before { counter-increment: list-item; content: counter(list-item) ") "; }
        .ProseMirror ol[data-list-style="paren"] > li         { counter-increment: list-item; }
        .ProseMirror li {
          display: list-item !important;
          margin: 0.25rem 0 !important;
          overflow: visible !important;
        }
        .ProseMirror table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
        .ProseMirror th, .ProseMirror td { border: 1px solid #e2e8f0; padding: 0.5rem; min-width: 60px; }
        .ProseMirror th { background-color: #f8fafc; font-weight: 600; }
        .ProseMirror img { max-width: 100%; height: auto; border-radius: 0.5rem; margin: 0.5rem 0; display: block; }
        .ProseMirror .chart-container { margin: 1rem 0; }
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #94a3b8;
          pointer-events: none;
          height: 0;
        }
        /* Table selection highlight */
        .ProseMirror .selectedCell:after { background: #030C4D20; content: ''; left: 0; right: 0; top: 0; bottom: 0; pointer-events: none; position: absolute; z-index: 2; }
        .ProseMirror td, .ProseMirror th { position: relative; }
        .ProseMirror .math-node {
          display: inline;
          background-color: transparent;
          border: none;
          color: #1e40af;
          padding: 0;
          cursor: pointer;
          user-select: none;
          font-style: italic;
          vertical-align: baseline;
          line-height: inherit;
        }
        .ProseMirror .math-node .math-latex-text {
          display: none !important;
        }
        /* KaTeX rendering in editor */
        .ProseMirror .math-node .katex {
          display: inline !important;
          vertical-align: baseline !important;
          line-height: inherit !important;
        }
      `}</style>
    </div>
  );
}