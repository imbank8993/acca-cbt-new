"use client";
import './question-editor-dark.css';
import { Modal, ModalBody, ModalFooter, ModalField } from '@/app/components/ui/modal';
import { Button } from '@/app/components/ui/button';
import { deleteConfirmDialog } from '@/lib/confirm-dialog';
import { Extension, Node, type Editor, type JSONContent } from '@tiptap/core';
import BulletList from '@tiptap/extension-bullet-list';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import ListItem from '@tiptap/extension-list-item';
import OrderedList from '@tiptap/extension-ordered-list';
import Placeholder from '@tiptap/extension-placeholder';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import type { QuestionChartData } from './ChartEditorModal';
import { ChartEmbed } from './chart-embed';
import { DOMSerializer } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { Decoration,DecorationSet } from '@tiptap/pm/view';
import { EditorContent,useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
AlignCenter,
AlignJustify,
AlignLeft,
AlignRight,
BarChart2,
Bold as BoldIcon,
Highlighter,
ImageIcon,
Indent,
Italic as ItalicIcon,
Languages,
LinkIcon,
List as ListIcon,
ListOrdered,
Mic,
Minus,
Outdent,
Redo2,
RemoveFormatting,
Sigma,
Strikethrough,
Subscript as SubscriptIcon,
Superscript as SuperscriptIcon,
Table as TableIcon,
Underline as UnderlineIcon,
Undo2,
Video,
} from 'lucide-react';
import { useCallback,useEffect,useRef,useState,useImperativeHandle, type Ref } from 'react';
import { normalizeHtmlStorageUrls, resolveStorageUrl } from '@/lib/safe-url';
import { uploadToHosting } from '@/lib/uploader';
import InlineSelect from '@/components/ui/InlineSelect';
import { AudioEmbed } from './audio-embed';
import AudioEditorModal from './AudioEditorModal';
import ChartEditorModal from './ChartEditorModal';
import ImageEditorModal from './ImageEditorModal';
import { renderLatex } from './math-utils';
import MathEditorModal from './MathEditorModal';
import TableEditorModal,{ TableWidthPreset } from './TableEditorModal';
import { VideoEmbed } from './video-embed';
import VideoEditorModal,{ VideoData,VideoModalMode } from './VideoEditorModal';
import { ImportedParagraphFormat } from './imported-paragraph-format';

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
  { key: 'disc',     label: '• Bulat Penuh' },
  { key: 'circle',   label: '○ Lingkaran' },
  { key: 'square',   label: '■ Kotak' },
  { key: 'diamond',  label: '◆ Belah Ketupat' },
  { key: 'dash',     label: '– Strip' },
  { key: 'asterisk', label: '⁎ Bintang' },
  { key: 'arrow',    label: '▸ Panah' },
  { key: 'checkmark',label: '✓ Centang' },
] as const;

type OrderedListStyleKey = typeof ORDERED_LIST_STYLES[number]['key'];
type BulletListStyleKey = typeof BULLET_LIST_STYLES[number]['key'];

function insertAdjacentBlocks(editor: Editor, nodes: JSONContent[]): boolean {
  const { selection } = editor.state;
  const { $from } = selection;
  const content = [...nodes, { type: 'paragraph' }];
  const command = editor.chain().focus();
  if (selection.empty && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0) {
    return command.insertContentAt(
      { from: $from.before(), to: $from.after() },
      content,
    ).run();
  }
  return command.insertContent(content).run();
}

/**
 * Normalizes HTML so that <br> inside paragraphs are split into independent <p> tags.
 * This guarantees that every line can have its own independent alignment (e.g. line 1 center, line 2 right).
 */
function normalizeParagraphs(html: string): string {
  if (!html) return '';
  return html.replace(/<p([^>]*)>([\s\S]*?)<\/p>/gi, (match, attrs, inner) => {
    if (inner.includes('<br')) {
      const parts = inner.split(/<br\s*[\/]?>/gi);
      return parts
        .filter((part: string) => part.trim().length > 0)
        .map((part: string) => `<p${attrs}>${part}</p>`)
        .join('');
    }
    return match;
  });
}

/**
 * Normalizes tab characters (\t) into structured tab spans that TipTap and LatexRenderer preserve.
 */
function normalizeTabs(html: string): string {
  if (!html) return '';
  return html.replace(/\t/g, '<span class="cbt-tab" style="white-space:pre;tab-size:8">&#9;</span>');
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
                        span.style.margin = '0.75rem 0';
                      } else {
                        span.style.display = 'inline-block';
                        span.style.margin = '0 0.25rem';
                        span.style.verticalAlign = 'middle';
                      }
                      span.dataset.latex = matchStr;
                      span.dataset.start = start.toString();
                      span.dataset.end = end.toString();
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

// Tab Node Extension for preserving tabulations (\t and [WORD_TAB] spans)
const Tab = Node.create({
  name: 'tab',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  parseHTML() {
    return [
      {
        tag: 'span.cbt-tab',
      },
      {
        tag: 'span',
        getAttrs: (element: HTMLElement) => {
          const style = (element.getAttribute('style') || '').toLowerCase();
          const text = element.textContent || '';
          if (
            element.classList.contains('cbt-tab') ||
            style.includes('tab-size') ||
            style.includes('white-space:pre') ||
            style.includes('white-space: pre') ||
            text === '\t'
          ) {
            return {};
          }
          return false;
        },
      },
    ];
  },
  renderHTML() {
    return ['span', { class: 'cbt-tab', style: 'white-space:pre;tab-size:8' }, '\t'];
  },
});

// Custom Keyboard Shortcuts Extension for Tab and Enter behavior
const CustomKeyboardShortcuts = Extension.create({
  name: 'customKeyboardShortcuts',
  addKeyboardShortcuts() {
    return {
      // TAB key handling: indent list or insert custom tab node with 8-char tab stop
      Tab: () => {
        if (this.editor.isActive('listItem')) {
          return this.editor.commands.sinkListItem('listItem');
        }
        if (this.editor.isActive('table')) {
          return false; // let table handle cell navigation
        }
        return this.editor.commands.insertContent({ type: 'tab' });
      },
      // SHIFT-TAB key handling: outdent list
      'Shift-Tab': () => {
        if (this.editor.isActive('listItem')) {
          return this.editor.commands.liftListItem('listItem');
        }
        if (this.editor.isActive('table')) {
          return false; // let table handle cell navigation
        }
        return false;
      },
      // SHIFT-ENTER key handling: create an independent paragraph block so each line can have its own alignment
      'Shift-Enter': () => {
        return this.editor.commands.splitBlock();
      },
    };
  },
});

export type OptionInsertAction = 'image' | 'math' | 'table' | 'audio' | 'video' | 'link';
export interface TipTapEditorControls { openInsert: (action: OptionInsertAction) => void }

interface TipTapEditorCoreProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  onImageUpload?: (file: File) => Promise<string>;
  onAudioUpload?: (file: File) => Promise<string>;
  minHeight?: string;
  compact?: boolean;
  controlsRef?: Ref<TipTapEditorControls>;
}

export default function TipTapEditorCore({
  content,
  onChange,
  placeholder = 'Tulis pertanyaan di sini...',
  editable = true,
  onImageUpload,
  onAudioUpload,
  minHeight = '200px',
  compact = false,
  controlsRef,
}: TipTapEditorCoreProps) {
  const lastContent = useRef('');
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const optionImageInputRef = useRef<HTMLInputElement>(null);

  const [linkDialog, setLinkDialog] = useState<{ url: string; editing: boolean } | null>(null);
  const [linkError, setLinkError] = useState('');

  // Modal States
  const [showImageModal, setShowImageModal] = useState(false);
  const [localImageSrc, setLocalImageSrc] = useState('');
  const [editingImagePos, setEditingImagePos] = useState<number | null>(null);
  const [imgWidth, setImgWidth] = useState('original');
  const [imgAlign, setImgAlign] = useState<'left' | 'center' | 'right'>('center');
  const pendingImageFiles = useRef<File[]>([]);
  const uploadedImageNodes = useRef<JSONContent[]>([]);
  const isImageBatch = useRef(false);
  const appliedImage = useRef(false);

  const [showMathModal, setShowMathModal] = useState(false);
  const [mathInput, setMathInput] = useState('');
  const [isMathBlock, setIsMathBlock] = useState(false);

  const [showChartModal, setShowChartModal] = useState(false);
  const [showTableModal, setShowTableModal] = useState(false);
  const [activeTablePreview, setActiveTablePreview] = useState<string>('');

  const [videoModal, setVideoModal] = useState<{
    isOpen: boolean;
    mode: VideoModalMode;
    url: string;
    width: string;
    pos: number | null;
  }>({
    isOpen: false,
    mode: 'insert',
    url: '',
    width: '100%',
    pos: null,
  });

  const [showAudioModal, setShowAudioModal] = useState(false);

  const [defaultListStyle, setDefaultListStyle] = useState<OrderedListStyleKey | null>(null);
  const [defaultBulletStyle, setDefaultBulletStyle] = useState<BulletListStyleKey | null>(null);

  const handleImageUploadToStorage = useCallback(
    async (file: File) => {
      if (onImageUpload) return onImageUpload(file);
      const res = await uploadToHosting(file, 'questions');
      if (res.success && res.url) return res.url;
      throw new Error(res.error || 'Gagal mengunggah gambar soal.');
    },
    [onImageUpload],
  );

  const handleAudioUploadToStorage = useCallback(
    async (file: File) => {
      if (onAudioUpload) return onAudioUpload(file);
      const res = await uploadToHosting(file, 'questions-audio');
      if (res.success && res.url) return res.url;
      throw new Error(res.error || 'Gagal mengunggah audio soal.');
    },
    [onAudioUpload],
  );

  const normalizedInitialContent = normalizeParagraphs(normalizeTabs(normalizeHtmlStorageUrls(content)));

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        orderedList: false,
        bulletList: false,
        hardBreak: false,
      }),
      CustomKeyboardShortcuts,
      Tab,
      ImportedParagraphFormat,
      Subscript,
      Superscript,
      Highlight.configure({ multicolor: true }),
      VideoEmbed,
      AudioEmbed,
      OrderedList.configure({
        addAttributes() {
          return {
            listStyle: {
              default: 'decimal',
              parseHTML: (element: HTMLElement) => element.getAttribute('data-list-style') || 'decimal',
              renderHTML: (attributes: { listStyle?: string }) => ({
                'data-list-style': attributes.listStyle || 'decimal',
              }),
            },
          };
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
      BulletList.configure({
        addAttributes() {
          return {
            bulletStyle: {
              default: 'disc',
              parseHTML: (element: HTMLElement) => element.getAttribute('data-bullet-style') || 'disc',
              renderHTML: (attributes: { bulletStyle?: string }) => ({
                'data-bullet-style': attributes.bulletStyle || 'disc',
              }),
            },
          };
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
      ListItem,
      TextStyle,
      Color,
      TextAlign.configure({
        types: ['heading', 'paragraph', 'tableCell', 'tableHeader', 'blockquote'],
        alignments: ['left', 'center', 'right', 'justify'],
        defaultAlignment: 'left',
      }),
      Image.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            width: {
              default: null,
              parseHTML: (element: HTMLElement) => element.getAttribute('width'),
            },
            height: {
              default: null,
              parseHTML: (element: HTMLElement) => element.getAttribute('height'),
            },
            style: {
              default: null,
              parseHTML: (element: HTMLElement) => element.getAttribute('style'),
              renderHTML: (attributes: { style?: string | null }) =>
                attributes.style ? { style: attributes.style } : {},
            },
          };
        },
      }).configure({
        allowBase64: true,
        inline: false,
        HTMLAttributes: {
          class: 'rounded-lg max-w-full my-2',
        },
      }),
      ChartEmbed,
      Table.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            style: {
              default: null,
              parseHTML: (element: HTMLElement) => element.getAttribute('style'),
              renderHTML: (attributes: { style?: string | null }) =>
                attributes.style ? { style: attributes.style } : {},
            },
          };
        },
      }).configure({
        resizable: true,
        HTMLAttributes: {
          class: 'border-collapse w-full my-4 border border-slate-300',
        },
      }),
      TableRow.configure({
        HTMLAttributes: {
          class: 'border-b border-slate-300',
        },
      }),
      TableHeader.configure({
        HTMLAttributes: {
          class: 'border border-slate-300 bg-slate-100 p-2 font-semibold text-left',
        },
      }),
      TableCell.configure({
        HTMLAttributes: {
          class: 'border border-slate-300 p-2',
        },
      }),
      Placeholder.configure({ placeholder }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-600 underline cursor-pointer',
        },
      }),
      MathHighlighter,
    ],
    content: normalizedInitialContent,
    editable,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      lastContent.current = html;
      onChange(html);
    },
  });

  // Keep editor content in sync with external prop changes
  useEffect(() => {
    if (editor && content !== lastContent.current) {
      const normalized = normalizeParagraphs(normalizeTabs(normalizeHtmlStorageUrls(content)));
      lastContent.current = normalized;
      editor.commands.setContent(normalized);
    }
  }, [content, editor]);

  // Keep list style dropdowns in sync with current cursor position
  useEffect(() => {
    if (!editor) return;
    const updateStyles = () => {
      if (editor.isActive('orderedList')) {
        const attrs = editor.getAttributes('orderedList');
        setDefaultListStyle(attrs.listStyle || 'decimal');
      } else {
        setDefaultListStyle(null);
      }
      if (editor.isActive('bulletList')) {
        const attrs = editor.getAttributes('bulletList');
        setDefaultBulletStyle(attrs.bulletStyle || 'disc');
      } else {
        setDefaultBulletStyle(null);
      }
    };
    editor.on('selectionUpdate', updateStyles);
    editor.on('transaction', updateStyles);
    return () => {
      editor.off('selectionUpdate', updateStyles);
      editor.off('transaction', updateStyles);
    };
  }, [editor]);

  // Read the current table width from the active table
  const readActiveTableWidth = useCallback((): { preset: TableWidthPreset; custom: string } => {
    if (!editor) return { preset: '100%', custom: '' };
    const { state } = editor;
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === 'table') {
        const attrs = node.attrs as Record<string, unknown>;
        const style = (attrs.style as string | null | undefined) || '';
        const widthAttr = attrs.width as string | null | undefined;
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

  // Extract active <table> HTML from editor for live preview
  const activeTableHTML = useCallback((): string => {
    if (!editor) return '';
    const { state } = editor;
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === 'table') {
        const serializer = DOMSerializer.fromSchema(editor.schema);
        const div = document.createElement('div');
        const serialized = serializer.serializeNode(node);
        div.appendChild(serialized);
        return div.innerHTML;
      }
    }
    return '';
  }, [editor]);

  // Refresh active-table preview when table modal is opened or table contents change
  useEffect(() => {
    if (!editor) return;
    const refresh = () => {
      if (!showTableModal || !editor.isActive('table')) {
        setActiveTablePreview('');
        return;
      }
      setActiveTablePreview(activeTableHTML());
    };
    editor.on('selectionUpdate', refresh);
    editor.on('transaction', refresh);
    refresh();
    return () => {
      editor.off('selectionUpdate', refresh);
      editor.off('transaction', refresh);
    };
  }, [showTableModal, editor, activeTableHTML]);

  // Insert math string with delimiters at current cursor position
  const insertMath = useCallback((latex: string, isBlock: boolean) => {
    if (!editor) return;
    const trimmed = latex.trim();
    if (!trimmed) return;
    const clean = trimmed
      .replace(/\\placeholder(?:\[[^\]]*\])?\{([^}]*)\}/g, (_, inner) => {
        const t = inner.trim();
        return t ? t : '\\dots';
      })
      .replace(/\\placeholder(?:\[[^\]]*\])?/g, '\\dots')
      .replace(/#\?/g, '\\dots');
    const formatted = isBlock ? `$$${clean}$$` : `$${clean}$`;
    editor.chain().focus().insertContent(formatted).run();
  }, [editor]);

  // Detect clicks on images, video embeds, and math nodes inside the editor
  useEffect(() => {
    if (!editor) return;
    const handleEditorClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      // Click on Image
      if (target.tagName === 'IMG') {
        const src = target.getAttribute('src') || '';
        const style = target.getAttribute('style') || '';
        if (src) {
          let pos: number | null = null;
          try {
            pos = editor.view.posAtDOM(target, 0);
          } catch {}
          setEditingImagePos(pos);
          setLocalImageSrc(resolveStorageUrl(src));
          const widthMatch = style.match(/(?:^|;)\s*width:\s*([^;]+)/);
          const savedWidth = widthMatch?.[1]?.trim() || target.getAttribute('width');
          setImgWidth(!savedWidth || savedWidth === 'auto' ? 'original' : /^\d+(?:\.\d+)?$/.test(savedWidth) ? `${savedWidth}px` : savedWidth);
          setShowImageModal(true);
        }
        return;
      }

      // Click on Video Embed Placeholder
      const videoWrapper = target.closest('.video-embed-editor-placeholder') as HTMLElement | null;
      if (videoWrapper) {
        const clickedPlayBtn = target.closest('.video-embed-play-btn');
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
          setVideoModal({ isOpen: true, mode: 'play', url: src, width, pos: null });
        } else {
          setVideoModal({ isOpen: true, mode: 'edit', url: src, width, pos });
        }
        return;
      }

      // Click on Math Node
      const mathWrapper = target.closest('.math-highlight-editor') as HTMLElement | null;
      if (mathWrapper) {
        const raw = mathWrapper.dataset.latex || '';
        const isBlock = raw.startsWith('$$');
        const latex = isBlock ? raw.slice(2, -2) : raw.slice(1, -1);
        setMathInput(latex);
        setIsMathBlock(isBlock);
        setShowMathModal(true);
        return;
      }
    };

    const dom = editor.view.dom;
    dom.addEventListener('click', handleEditorClick);
    return () => {
      dom.removeEventListener('click', handleEditorClick);
    };
  }, [editor]);

  // Handle local image file upload & modal trigger
  const openImageFile = useCallback((file: File) => {
    setEditingImagePos(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        const src = e.target.result as string;
        setLocalImageSrc(src);
        setImgWidth('original');
        setImgAlign(isImageBatch.current ? 'left' : 'center');
        setShowImageModal(true);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const handleImageUpload = useCallback((files: FileList | File[]) => {
    const selected = Array.from(files);
    if (selected.length === 0) return;
    isImageBatch.current = selected.length > 1;
    pendingImageFiles.current = selected.slice(1);
    openImageFile(selected[0]);
  }, [openImageFile]);

  // Apply edited or cropped image into editor
  const handleApplyImage = useCallback(
    async ({ src, width, align }: { src: string; width: string; align: 'left' | 'center' | 'right' }) => {
      if (!editor || !src) throw new Error('Editor soal tidak siap menerima gambar.');
      const resolvedSrc = resolveStorageUrl(src);

      // In-place update if editing existing image
      if (editingImagePos !== null) {
        const layoutStyle = `display:block;vertical-align:top;width:${width === 'original' ? 'auto' : width};max-width:100%;height:auto;margin:${align === 'left' ? '0.5rem auto 0.5rem 0' : align === 'right' ? '0.5rem 0 0.5rem auto' : '0.5rem auto'};border-radius:0.5rem`;
        editor.chain().focus().command(({ tr }) => {
          tr.setNodeMarkup(editingImagePos, undefined, {
            src: resolvedSrc,
            alt: 'Gambar Soal',
            title: 'Gambar Soal',
            width: width === 'original' ? null : width,
            style: layoutStyle,
          });
          return true;
        }).run();
        setEditingImagePos(null);
        return;
      }

      const layoutStyle = isImageBatch.current
        ? `display:inline-block;vertical-align:top;width:${width === 'original' ? 'auto' : width};max-width:100%;height:auto;margin:0.5rem 1%;border-radius:0.5rem`
        : `display:block;vertical-align:top;width:${width === 'original' ? 'auto' : width};max-width:100%;height:auto;margin:${align === 'left' ? '0.5rem auto 0.5rem 0' : align === 'right' ? '0.5rem 0 0.5rem auto' : '0.5rem auto'};border-radius:0.5rem`;
      uploadedImageNodes.current.push({
        type: 'image',
        attrs: {
          src: resolvedSrc,
          alt: 'Gambar Soal',
          title: 'Gambar Soal',
          width: width === 'original' ? null : width,
          style: layoutStyle,
        },
      });
      appliedImage.current = true;
    },
    [editor, editingImagePos],
  );

  const handleDeleteImage = useCallback(() => {
    if (editingImagePos !== null && editor) {
      const node = editor.state.doc.nodeAt(editingImagePos);
      if (node) {
        editor.chain().focus().deleteRange({ from: editingImagePos, to: editingImagePos + node.nodeSize }).run();
      }
      setEditingImagePos(null);
      setShowImageModal(false);
    }
  }, [editingImagePos, editor]);

  const closeImageModal = useCallback(() => {
    setShowImageModal(false);
    setLocalImageSrc('');
    setEditingImagePos(null);
    if (appliedImage.current) {
      appliedImage.current = false;
      const next = pendingImageFiles.current.shift();
      if (next) {
        openImageFile(next);
        return;
      }
    }
    if (uploadedImageNodes.current.length === 1 && isImageBatch.current) {
      const image = uploadedImageNodes.current[0];
      image.attrs = {
        ...image.attrs,
        style: String(image.attrs?.style || '').replace('display:inline-block', 'display:block'),
      };
    }
    if (editor && uploadedImageNodes.current.length > 0) {
      if (!insertAdjacentBlocks(editor, uploadedImageNodes.current)) {
        window.alert('Gambar sudah diunggah, tetapi gagal disisipkan ke editor. Silakan coba lagi.');
      }
      uploadedImageNodes.current = [];
    }
    pendingImageFiles.current = [];
    isImageBatch.current = false;
  }, [editor, openImageFile]);

  useEffect(() => {
    if (!editor) return;
    const handleImageFiles = (files: File[]) => {
      const images = files.filter(file => file.type.startsWith('image/'));
      if (images.length === 0) return false;
      handleImageUpload(images);
      return true;
    };
    const handlePaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.items || [])
        .map(item => item.kind === 'file' ? item.getAsFile() : null)
        .filter((file): file is File => file !== null);
      if (handleImageFiles(files)) event.preventDefault();
    };
    const handleDrop = (event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files || []);
      if (!handleImageFiles(files)) return;
      event.preventDefault();
      if (event.clientX || event.clientY) {
        const target = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (target) editor.commands.setTextSelection(target.pos);
      }
    };

    editor.view.dom.addEventListener('paste', handlePaste);
    editor.view.dom.addEventListener('drop', handleDrop);
    return () => {
      editor.view.dom.removeEventListener('paste', handlePaste);
      editor.view.dom.removeEventListener('drop', handleDrop);
    };
  }, [editor, handleImageUpload]);

  useImperativeHandle(controlsRef, () => ({
    openInsert(action) {
      if (!editor) return;
      if (action === 'image') optionImageInputRef.current?.click();
      if (action === 'math') { setMathInput(''); setIsMathBlock(false); setShowMathModal(true); }
      if (action === 'table') setShowTableModal(true);
      if (action === 'audio') setShowAudioModal(true);
      if (action === 'video') setVideoModal({ isOpen: true, mode: 'insert', url: '', width: '100%', pos: null });
      if (action === 'link') {
        setLinkError('');
        setLinkDialog({ url: editor.getAttributes('link').href || '', editing: editor.isActive('link') });
      }
    },
  }), [editor]);

  if (!editor) {
    return <div className="border border-slate-200 rounded-lg animate-pulse bg-slate-50" style={{ minHeight }} />;
  }

  const isInTable = editor.isActive('table');

  // Text Alignment State Detectors
  const isCenterAlign = editor.isActive({ textAlign: 'center' });
  const isRightAlign = editor.isActive({ textAlign: 'right' });
  const isJustifyAlign = editor.isActive({ textAlign: 'justify' });
  const isLeftAlign = editor.isActive({ textAlign: 'left' }) || (!isCenterAlign && !isRightAlign && !isJustifyAlign);

  // RTL direction detection — cek apakah paragraf/heading aktif punya dir="rtl"
  const currentDir = editor.getAttributes('paragraph').dir ||
    editor.getAttributes('heading').dir ||
    editor.getAttributes('blockquote').dir || 'ltr';
  const isRtlMode = currentDir === 'rtl';

  // Toggle RTL/LTR pada node aktif (paragraph / heading / blockquote)
  const toggleDirection = () => {
    const newDir = isRtlMode ? null : 'rtl';
    if (editor.isActive('heading')) {
      editor.chain().focus().updateAttributes('heading', { dir: newDir }).run();
    } else if (editor.isActive('blockquote')) {
      editor.chain().focus().updateAttributes('blockquote', { dir: newDir }).run();
    } else {
      editor.chain().focus().updateAttributes('paragraph', { dir: newDir }).run();
    }
  };

  return (
    <div className={compact ? 'option-content-editor min-w-0 w-full' : 'border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs'} ref={editorWrapRef}>
      <input ref={optionImageInputRef} type="file" accept="image/*" multiple className="hidden" aria-label="Pilih gambar opsi jawaban"
        onChange={event => { if (event.target.files?.length) handleImageUpload(event.target.files); event.target.value = ''; }} />
      {/* Sleek Pure-Icon Unified Segmented Toolbar */}
      {editable && !compact && (
        <div className="editor-toolbar flex w-full items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 bg-slate-50/80 border-b border-slate-200/80 select-none overflow-x-auto sm:flex-wrap scrollbar-hide">
          {/* Cluster 1: History (Undo / Redo) */}
          <div className="toolbar-group">
            <button
              type="button"
              onClick={() => editor.chain().focus().undo().run()}
              disabled={!editor.can().undo()}
              className="w-7 h-7 flex items-center justify-center rounded-md text-slate-600 hover:bg-white/80 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
              title="Urungkan / Undo (Ctrl+Z)"
            >
              <Undo2 size={14} />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().redo().run()}
              disabled={!editor.can().redo()}
              className="w-7 h-7 flex items-center justify-center rounded-md text-slate-600 hover:bg-white/80 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
              title="Ulangi / Redo (Ctrl+Y)"
            >
              <Redo2 size={14} />
            </button>
          </div>

          {/* Cluster 2: Heading Dropdown */}
          <InlineSelect
            onChange={(value) => {
              if (value === '0') editor.chain().focus().setParagraph().run();
              else editor.chain().focus().toggleHeading({ level: parseInt(value) as 1 | 2 | 3 }).run();
            }}
            value={
              editor.isActive('heading', { level: 1 }) ? '1' :
              editor.isActive('heading', { level: 2 }) ? '2' :
              editor.isActive('heading', { level: 3 }) ? '3' : '0'
            }
            options={[
              { value: '0', label: 'Normal' },
              { value: '1', label: 'Heading 1' },
              { value: '2', label: 'Heading 2' },
              { value: '3', label: 'Heading 3' },
            ]}
            minWidth="110px"
            height="32px"
            className="shrink-0"
            title="Tingkat Paragraf / Heading"
          />

          {/* Cluster 3: Basic Formatting (B, I, U, S) */}
          <div className="toolbar-group">
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all cursor-pointer ${
                editor.isActive('bold')
                  ? 'bg-white text-[#3083FF] shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
              }`}
              title="Tebal (Ctrl+B)"
            >
              <BoldIcon size={14} />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all cursor-pointer ${
                editor.isActive('italic')
                  ? 'bg-white text-[#3083FF] shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
              }`}
              title="Miring (Ctrl+I)"
            >
              <ItalicIcon size={14} />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all cursor-pointer ${
                editor.isActive('underline')
                  ? 'bg-white text-[#3083FF] shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
              }`}
              title="Garis Bawah (Ctrl+U)"
            >
              <UnderlineIcon size={14} />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleStrike().run()}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all cursor-pointer ${
                editor.isActive('strike')
                  ? 'bg-white text-[#3083FF] shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
              }`}
              title="Coret"
            >
              <Strikethrough size={14} />
            </button>
          </div>

          {/* Cluster 4: Scripts & Highlight */}
          <div className="toolbar-group">
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleSubscript().run()}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all cursor-pointer ${
                editor.isActive('subscript')
                  ? 'bg-white text-[#3083FF] shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
              }`}
              title="Subscript / Indeks Bawah (contoh: H₂O, v₀)"
            >
              <SubscriptIcon size={14} />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleSuperscript().run()}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all cursor-pointer ${
                editor.isActive('superscript')
                  ? 'bg-white text-[#3083FF] shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
              }`}
              title="Superscript / Pangkat (contoh: x², cm³, 10⁵)"
            >
              <SuperscriptIcon size={14} />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run()}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all cursor-pointer ${
                editor.isActive('highlight')
                  ? 'bg-amber-300 text-amber-950 shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
              }`}
              title="Sorot Teks / Stabilo Kuning"
            >
              <Highlighter size={14} />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
              className="w-7 h-7 flex items-center justify-center rounded-md text-xs text-slate-500 hover:bg-white/80 hover:text-red-600 transition-all cursor-pointer"
              title="Hapus Pemformatan Teks"
            >
              <RemoveFormatting size={14} />
            </button>
          </div>

          {/* Cluster 5: Alignment (4 Segments in 1 Unified Pill) */}
          <div className="toolbar-group">
            <button
              type="button"
              onClick={() => editor.chain().focus().setTextAlign('left').run()}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all cursor-pointer ${
                isLeftAlign
                  ? 'bg-white text-[#3083FF] shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
              }`}
              title="Rata Kiri (Ctrl+Shift+L)"
            >
              <AlignLeft size={14} />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().setTextAlign('center').run()}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all cursor-pointer ${
                isCenterAlign
                  ? 'bg-white text-[#3083FF] shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
              }`}
              title="Rata Tengah (Ctrl+Shift+E)"
            >
              <AlignCenter size={14} />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().setTextAlign('right').run()}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all cursor-pointer ${
                isRightAlign
                  ? 'bg-white text-[#3083FF] shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
              }`}
              title="Rata Kanan (Ctrl+Shift+R)"
            >
              <AlignRight size={14} />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().setTextAlign('justify').run()}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all cursor-pointer ${
                isJustifyAlign
                  ? 'bg-white text-[#3083FF] shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
              }`}
              title="Rata Kiri-Kanan / Justify (Ctrl+Shift+J)"
            >
              <AlignJustify size={14} />
            </button>
          </div>

          {/* Cluster 5b: RTL / Arab Mode — aktifkan untuk teks bahasa Arab */}
          <div className="toolbar-group">
            <button
              type="button"
              onClick={toggleDirection}
              className={`flex items-center justify-center gap-1 px-2 h-7 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                isRtlMode
                  ? 'bg-blue-100 text-blue-700 shadow-xs border border-blue-200'
                  : 'text-slate-500 hover:bg-white/80 hover:text-slate-800'
              }`}
              title={isRtlMode
                ? 'Mode Arab RTL aktif — klik untuk kembali ke mode Latin (LTR)'
                : 'Aktifkan mode Arab/RTL (Right-to-Left) untuk paragraf ini'}
            >
              <Languages size={12} />
              <span className="arab-mode-badge">{isRtlMode ? 'ع RTL' : 'ع'}</span>
            </button>
          </div>

          {/* Cluster 6: Lists & Indentation */}
          <div className="toolbar-group">
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all cursor-pointer ${
                editor.isActive('orderedList')
                  ? 'bg-white text-[#3083FF] shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
              }`}
              title="Daftar Bernomor (1, 2, 3)"
            >
              <ListOrdered size={14} />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all cursor-pointer ${
                editor.isActive('bulletList')
                  ? 'bg-white text-[#3083FF] shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
              }`}
              title="Daftar Simbol Poin (Bullet)"
            >
              <ListIcon size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (editor.isActive('listItem')) {
                  editor.chain().focus().liftListItem('listItem').run();
                }
              }}
              disabled={!editor.isActive('listItem')}
              className="w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all disabled:opacity-30 disabled:cursor-not-allowed text-slate-600 hover:bg-white/80 hover:text-slate-900 cursor-pointer"
              title="Kurangi Indentasi (Shift+Tab)"
            >
              <Outdent size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (editor.isActive('listItem')) {
                  editor.chain().focus().sinkListItem('listItem').run();
                } else {
                  editor.chain().focus().insertContent({ type: 'tab' }).run();
                }
              }}
              className="w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all text-slate-600 hover:bg-white/80 hover:text-slate-900 cursor-pointer"
              title="Tambah Indentasi / Tab (Tab)"
            >
              <Indent size={14} />
            </button>
          </div>

          {/* Cluster 7: Media & Component Inserts (Icons ONLY - Pure Segmented Pill) */}
          <div className="toolbar-group">
            {/* Image */}
            <label
              className="w-7 h-7 flex items-center justify-center rounded-md text-slate-600 hover:bg-white/80 hover:text-slate-900 transition-all cursor-pointer"
              title="Sisipkan satu atau beberapa gambar soal"
            >
              <ImageIcon size={14} />
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files?.length) handleImageUpload(files);
                  e.target.value = '';
                }}
              />
            </label>

            {/* Audio / Voice Note */}
            <button
              type="button"
              onClick={() => setShowAudioModal(true)}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all cursor-pointer ${
                showAudioModal
                  ? 'bg-white text-[#3083FF] shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
              }`}
              title="Sisipkan Audio MP3 / Rekam Suara (Voice Note)"
            >
              <Mic size={14} />
            </button>

            {/* Video */}
            <button
              type="button"
              onClick={() => setVideoModal({ isOpen: true, mode: 'insert', url: '', width: '100%', pos: null })}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all cursor-pointer ${
                videoModal.isOpen
                  ? 'bg-white text-[#3083FF] shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
              }`}
              title="Sisipkan Video (YouTube / Vimeo / File)"
            >
              <Video size={14} />
            </button>

            {/* Table */}
            <button
              type="button"
              onClick={() => setShowTableModal(true)}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all cursor-pointer ${
                isInTable || showTableModal
                  ? 'bg-white text-[#3083FF] shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
              }`}
              title={isInTable ? "Kelola Tabel Aktif" : "Sisipkan Tabel Baru"}
            >
              <TableIcon size={14} />
            </button>

            {/* Chart */}
            <button
              type="button"
              onClick={() => setShowChartModal(true)}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all cursor-pointer ${
                showChartModal
                  ? 'bg-white text-[#3083FF] shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
              }`}
              title="Sisipkan Grafik Statistik (Bar / Pie / Line)"
            >
              <BarChart2 size={14} />
            </button>

            {/* Math / LaTeX Formula */}
            <button
              type="button"
              onClick={() => {
                setMathInput('');
                setIsMathBlock(false);
                setShowMathModal(true);
              }}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all cursor-pointer ${
                showMathModal
                  ? 'bg-white text-[#3083FF] shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
              }`}
              title="Sisipkan Rumus Matematika (LaTeX & Visual)"
            >
              <Sigma size={14} />
            </button>

            {/* Link */}
            <button
              type="button"
              onClick={() => {
                setLinkError('');
                setLinkDialog({ url: editor.getAttributes('link').href || '', editing: editor.isActive('link') });
              }}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all cursor-pointer ${
                editor.isActive('link')
                  ? 'bg-white text-[#3083FF] shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
              }`}
              title="Sisipkan / Edit Link Tautan"
            >
              <LinkIcon size={14} />
            </button>

            {/* Horizontal Line */}
            <button
              type="button"
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
              className="w-7 h-7 flex items-center justify-center rounded-md text-xs text-slate-600 hover:bg-white/80 hover:text-slate-900 transition-all cursor-pointer"
              title="Garis Pembatas Horizontal Soal"
            >
              <Minus size={14} />
            </button>
          </div>

          {/* Contextual Helpers (Only shown when active) */}
          {editor.isActive('orderedList') && (
            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-200/80 shadow-2xs shrink-0 animate-in fade-in duration-150">
              <span className="text-[10px] font-semibold text-slate-400">Gaya:</span>
              <InlineSelect
                value={defaultListStyle ?? 'decimal'}
                onChange={(value) => {
                  const style = value as OrderedListStyleKey;
                  setDefaultListStyle(style);
                  editor.chain().focus().updateAttributes('orderedList', { listStyle: style }).run();
                }}
                options={ORDERED_LIST_STYLES.map((style) => ({ value: style.key, label: style.label }))}
                minWidth="110px"
                height="28px"
              />
            </div>
          )}

          {editor.isActive('bulletList') && (
            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-200/80 shadow-2xs shrink-0 animate-in fade-in duration-150">
              <span className="text-[10px] font-semibold text-slate-400">Poin:</span>
              <InlineSelect
                value={defaultBulletStyle ?? 'disc'}
                onChange={(value) => {
                  const style = value as BulletListStyleKey;
                  setDefaultBulletStyle(style);
                  editor.chain().focus().updateAttributes('bulletList', { bulletStyle: style }).run();
                }}
                options={BULLET_LIST_STYLES.map((style) => ({ value: style.key, label: style.label }))}
                minWidth="110px"
                height="28px"
              />
            </div>
          )}
        </div>
      )}

      {/* Editor Content Area */}
      <EditorContent editor={editor} />

      <Modal open={Boolean(linkDialog)} onClose={() => setLinkDialog(null)} size="sm"
        title={linkDialog?.editing ? 'Edit Tautan' : 'Sisipkan Tautan'} icon={<LinkIcon size={18} />}>
        <form onSubmit={event => {
          event.preventDefault();
          if (!linkDialog) return;
          const url = linkDialog.url.trim();
          if (!url && linkDialog.editing) {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
          } else {
            if (!/^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(url)) {
              setLinkError('Gunakan URL https://, http://, email, atau tautan halaman yang valid.');
              return;
            }
            if (editor.state.selection.empty && !linkDialog.editing) {
              editor.chain().focus().insertContent([
                { type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] },
                { type: 'text', text: ' ' },
              ]).run();
            } else {
              editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
            }
          }
          setLinkDialog(null);
        }}>
          <ModalBody>
            <ModalField label="URL tautan">
              <input autoFocus type="text" value={linkDialog?.url || ''} placeholder="https://contoh.com"
                onChange={event => { setLinkError(''); setLinkDialog(current => current ? { ...current, url: event.target.value } : null); }} />
            </ModalField>
            {linkDialog?.editing && <p className="text-xs text-slate-500">Kosongkan URL untuk menghapus tautan.</p>}
            {linkError && <p role="alert" className="text-xs text-red-500">{linkError}</p>}
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="cancel" onClick={() => setLinkDialog(null)}>Batal</Button>
            <Button type="submit" variant="primary">{linkDialog?.editing ? 'Simpan' : 'Sisipkan Tautan'}</Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Standalone Image Editor & Crop Modal */}
      <ImageEditorModal
        isOpen={showImageModal}
        onClose={closeImageModal}
        imageSrc={localImageSrc}
        initialWidth={imgWidth}
        initialAlign={imgAlign}
        onApply={handleApplyImage}
        onUpload={handleImageUploadToStorage}
        onDelete={editingImagePos !== null ? handleDeleteImage : undefined}
      />

      {/* Standalone Math / LaTeX Equation Modal */}
      <MathEditorModal
        isOpen={showMathModal}
        onClose={() => setShowMathModal(false)}
        initialLatex={mathInput}
        initialIsBlock={isMathBlock}
        onInsert={(latex, isBlock) => {
          insertMath(latex, isBlock);
          setShowMathModal(false);
        }}
      />

      {/* Standalone Chart Modal */}
      <ChartEditorModal
        isOpen={showChartModal}
        onClose={() => setShowChartModal(false)}
        onInsert={(chart: QuestionChartData) => {
          if (editor) {
            insertAdjacentBlocks(editor, [{
              type: 'chartEmbed',
              attrs: {
                chartType: chart.type,
                labels: chart.labels,
                values: chart.values,
                width: chart.width,
              },
            }]);
          }
          setShowChartModal(false);
        }}
      />

      {/* Standalone Table Modal */}
      <TableEditorModal
        isOpen={showTableModal}
        onClose={() => setShowTableModal(false)}
        isInTable={isInTable}
        activeTablePreview={activeTablePreview}
        currentTableWidth={readActiveTableWidth()}
        onInsertTable={(rows, cols, withHeader, width) => {
          if (!editor) return;
          if (editor.isActive('table')) {
            const { $from } = editor.state.selection;
            let tableDepth = $from.depth;
            while (tableDepth > 0 && $from.node(tableDepth).type.name !== 'table') tableDepth--;
            if (tableDepth === 0) return;
            const insertAt = $from.after(tableDepth);
            const schema = editor.schema;
            const rowsContent = Array.from({ length: rows }, (_, rowIndex) => {
              const cellType = withHeader && rowIndex === 0 ? 'tableHeader' : 'tableCell';
              const cells = Array.from({ length: cols }, () =>
                schema.nodes[cellType].createAndFill(),
              ).filter((cell): cell is NonNullable<typeof cell> => cell !== null);
              return schema.nodes.tableRow.create(null, cells);
            });
            const style = width
              ? `width:${width};display:${width === '100%' ? 'table' : 'inline-table'};vertical-align:top`
              : null;
            const newTable = schema.nodes.table.create({ style }, rowsContent);
            const content = [
              newTable,
              schema.nodes.paragraph.createAndFill(),
            ].filter((node): node is NonNullable<typeof node> => node !== null);
            editor.chain().focus().insertContentAt(insertAt, content).run();
          } else {
            editor.chain().focus().insertTable({ rows, cols, withHeaderRow: withHeader }).run();
            if (width) {
              requestAnimationFrame(() => {
                editor.chain().focus().updateAttributes('table', {
                  style: `width:${width};display:${width === '100%' ? 'table' : 'inline-table'};vertical-align:top`,
                }).run();
              });
            }
          }
          setShowTableModal(false);
        }}
        onAddRowBefore={() => {
          editor?.chain().focus().addRowBefore().run();
          setShowTableModal(false);
        }}
        onAddRowAfter={() => {
          editor?.chain().focus().addRowAfter().run();
          setShowTableModal(false);
        }}
        onDeleteRow={() => {
          editor?.chain().focus().deleteRow().run();
          setShowTableModal(false);
        }}
        onAddColumnBefore={() => {
          editor?.chain().focus().addColumnBefore().run();
          setShowTableModal(false);
        }}
        onAddColumnAfter={() => {
          editor?.chain().focus().addColumnAfter().run();
          setShowTableModal(false);
        }}
        onDeleteColumn={() => {
          editor?.chain().focus().deleteColumn().run();
          setShowTableModal(false);
        }}
        onApplyTableWidth={(width) => {
          if (!editor) return;
          editor.chain().focus().updateAttributes('table', {
            style: width
              ? `width:${width};display:${width === '100%' ? 'table' : 'inline-table'};vertical-align:top`
              : null,
          }).run();
          setShowTableModal(false);
        }}
        onDeleteTable={async () => {
          if (await deleteConfirmDialog('Hapus Tabel?', 'Apakah Anda yakin ingin menghapus seluruh tabel ini?')) {
            editor?.chain().focus().deleteTable().run();
            setShowTableModal(false);
          }
        }}
      />

      {/* Standalone Video Modal (Insert / Edit / Play) */}
      <VideoEditorModal
        isOpen={videoModal.isOpen}
        mode={videoModal.mode}
        initialUrl={videoModal.url}
        initialWidth={videoModal.width}
        playSrc={videoModal.url}
        onClose={() => setVideoModal((prev) => ({ ...prev, isOpen: false }))}
        onInsert={(data: VideoData) => {
          if (!editor) return;
          const containerStyle = `width: ${data.width}; max-width: 100%; margin: 0 auto;`;
          const iframeStyle = 'width: 100%; aspect-ratio: 16/9; border: 0; border-radius: 0.5rem; display: block;';
          const html =
            `<div class="video-embed" data-provider="${data.provider}" data-video-id="${data.id}" style="${containerStyle}">` +
            `<iframe src="${data.embedUrl}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy" style="${iframeStyle}"></iframe>` +
            `</div><p></p>`;
          editor.chain().focus().insertContent(html).run();
          setVideoModal((prev) => ({ ...prev, isOpen: false }));
        }}
        onUpdate={(data: VideoData) => {
          if (!editor || videoModal.pos === null) return;
          const node = editor.state.doc.nodeAt(videoModal.pos);
          if (node && node.type.name === 'videoEmbed') {
            editor.chain().focus().command(({ tr }) => {
              tr.setNodeMarkup(videoModal.pos!, undefined, {
                src: data.embedUrl,
                width: data.width,
              });
              return true;
            }).run();
          } else if (node) {
            editor.chain().focus()
              .deleteRange({ from: videoModal.pos, to: videoModal.pos + node.nodeSize })
              .insertContentAt(videoModal.pos, {
                type: 'videoEmbed',
                attrs: { src: data.embedUrl, width: data.width },
              })
              .run();
          }
          setVideoModal((prev) => ({ ...prev, isOpen: false }));
        }}
        onDelete={() => {
          if (!editor || videoModal.pos === null) return;
          const node = editor.state.doc.nodeAt(videoModal.pos);
          if (node) {
            editor.chain().focus().deleteRange({ from: videoModal.pos, to: videoModal.pos + node.nodeSize }).run();
          }
          setVideoModal((prev) => ({ ...prev, isOpen: false }));
        }}
      />

      {/* Standalone Audio & Voice Note Modal */}
      <AudioEditorModal
        isOpen={showAudioModal}
        onClose={() => setShowAudioModal(false)}
        onUpload={handleAudioUploadToStorage}
        onInsert={(audioUrl) => {
          if (editor && audioUrl) {
            editor.chain().focus().insertAudioEmbed(resolveStorageUrl(audioUrl)).run();
          }
        }}
      />

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
        .editor-toolbar .toolbar-group {
          display: inline-flex;
          align-items: center;
          gap: 0.125rem;
          flex: 0 0 auto;
          padding: 0.1875rem;
          border: 1px solid #e2e8f0;
          border-radius: 0.625rem;
          background-color: #f1f5f9;
        }
        .editor-toolbar button,
        .editor-toolbar label {
          box-sizing: border-box;
          width: 26px;
          height: 26px;
          flex: 0 0 26px;
          border: 0;
          border-radius: 0.375rem;
          background-color: transparent;
          box-shadow: none;
        }
        .editor-toolbar button:hover,
        .editor-toolbar label:hover {
          background-color: #fff;
        }
        .editor-toolbar button[class*="bg-white"] {
          background-color: #fff;
        }
        .editor-toolbar button[class*="bg-amber-300"] {
          background-color: #fcd34d;
        }
        .editor-toolbar button svg,
        .editor-toolbar label svg {
          width: 13px;
          height: 13px;
        }
        .editor-toolbar .uisel {
          flex-shrink: 0;
        }
        .ProseMirror {
          min-height: 200px;
          padding: 1.25rem;
          outline: none;
          word-wrap: break-word;
          overflow-wrap: anywhere;
          word-break: normal;
          white-space: pre-wrap;
          font-family: 'Merriweather', 'Source Serif 4', Georgia, serif;
          font-size: 15px;
          line-height: 1.85;
          letter-spacing: 0.01em;
          word-spacing: 0.08em;
          color: #1e293b;
          text-rendering: optimizeLegibility;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        .ProseMirror p {
          margin: 0 0 0.5rem 0;
          text-align: inherit;
          text-justify: inter-word;
        }
        .ProseMirror p:last-child {
          margin-bottom: 0;
        }
        .ProseMirror .katex {
          letter-spacing: normal;
          word-spacing: normal;
        }
        .ProseMirror h1 { font-size: 1.5rem; font-weight: 700; margin: 1.25rem 0 0.5rem 0; color: #0f172a; }
        .ProseMirror h2 { font-size: 1.25rem; font-weight: 700; margin: 1rem 0 0.5rem 0; color: #0f172a; }
        .ProseMirror h3 { font-size: 1.1rem; font-weight: 700; margin: 0.75rem 0 0.35rem 0; color: #0f172a; }
        .ProseMirror h1:first-child, .ProseMirror h2:first-child, .ProseMirror h3:first-child { margin-top: 0; }

        .ProseMirror {
          tab-size: 8 !important;
          -moz-tab-size: 8 !important;
        }
        .ProseMirror .cbt-tab,
        .ProseMirror span[style*="white-space:pre"],
        .ProseMirror span[style*="white-space: pre"] {
          display: inline;
          white-space: pre !important;
          tab-size: 8 !important;
          -moz-tab-size: 8 !important;
        }
        .ProseMirror sub { vertical-align: sub; font-size: smaller; line-height: 0; }
        .ProseMirror sup { vertical-align: super; font-size: smaller; line-height: 0; }
        .ProseMirror mark { background-color: #fef08a; padding: 0.05rem 0.25rem; border-radius: 0.25rem; }
        .ProseMirror hr { border: none; border-top: 2px dashed #cbd5e1; margin: 1.25rem 0; }
        .ProseMirror blockquote { border-left: 3px solid #3083FF; padding-left: 1rem; margin: 0.75rem 0; color: #475569; font-style: italic; }

        .ProseMirror ul {
          list-style-type: disc !important;
          padding-left: 2rem !important;
          margin: 0.5rem 0 !important;
        }
        /* Custom bullet list styles */
        .ProseMirror ul[data-bullet-style="square"]    { list-style-type: square !important; }
        .ProseMirror ul[data-bullet-style="dash"]      { list-style-type: none !important; padding-left: 1.5rem !important; }
        .ProseMirror ul[data-bullet-style="dash"] > li::before { content: "– "; font-weight: bold; }
        .ProseMirror ul[data-bullet-style="arrow"]     { list-style-type: none !important; padding-left: 1.5rem !important; }
        .ProseMirror ul[data-bullet-style="arrow"] > li::before { content: "▸ "; }
        .ProseMirror ul[data-bullet-style="checkmark"] { list-style-type: none !important; padding-left: 1.5rem !important; }
        .ProseMirror ul[data-bullet-style="checkmark"] > li::before { content: "✓ "; color: #3083FF; font-weight: bold; }
        .ProseMirror ul[data-bullet-style="circle"]   { list-style-type: circle !important; }
        .ProseMirror ul[data-bullet-style="diamond"]  { list-style-type: none !important; padding-left: 1.5rem !important; }
        .ProseMirror ul[data-bullet-style="diamond"] > li::before { content: "◆ "; }
        .ProseMirror ul[data-bullet-style="asterisk"] { list-style-type: none !important; padding-left: 1.5rem !important; }
        .ProseMirror ul[data-bullet-style="asterisk"] > li::before { content: "⁎ "; }
        .ProseMirror ul[data-bullet-style="disc"]      { list-style-type: disc !important; }

        .ProseMirror ol {
          list-style-type: decimal !important;
          padding-left: 2rem !important;
          margin: 0.5rem 0 !important;
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
        .ProseMirror ol[data-list-style="paren"] > li::before   { counter-increment: list-item; content: counter(list-item) ") "; }
        .ProseMirror ol[data-list-style="paren"] > li           { counter-increment: list-item; }

        .ProseMirror li {
          display: list-item !important;
          margin: 0.2rem 0 !important;
          overflow: visible !important;
        }
        .ProseMirror table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
        .ProseMirror th, .ProseMirror td { border: 1px solid #cbd5e1; padding: 0.5rem; min-width: 60px; }
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
        .ProseMirror .selectedCell:after { background: #3083FF20; content: ''; left: 0; right: 0; top: 0; bottom: 0; pointer-events: none; position: absolute; z-index: 2; }
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
