"use client";
import React, { useMemo, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { OrderedList } from '@tiptap/extension-list';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { VideoEmbed } from './video-embed';
import { AudioEmbed } from './audio-embed';
import { createRoot, Root } from 'react-dom/client';
import { CustomVideoPlayer } from './CustomVideoPlayer';
import DOMPurify from 'dompurify';

// Pure HTML renderer without contenteditable - for preview only
// Parses HTML and applies proper alignment styles

interface TipTapPreviewRendererProps {
    content: string;
    className?: string;
}

export function TipTapPreviewRenderer({ content, className = '' }: TipTapPreviewRendererProps) {
    const contentRef = useRef<HTMLDivElement>(null);

    // Process HTML to ensure proper alignment styling
    const processedContent = useMemo(() => {
        if (!content) return '';

        // Create a temporary container to parse HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = DOMPurify.sanitize(content, { ADD_TAGS: ['iframe'] });

        // Process all elements to ensure alignment is preserved
        const processElement = (el: Element) => {
            const textAlign = (el as HTMLElement).style?.textAlign;

            if (textAlign) {
                el.setAttribute('data-align', textAlign);
            }

            // Process child elements recursively
            Array.from(el.children).forEach(processElement);
        };

        Array.from(tempDiv.children).forEach(processElement);

        // Replace <div data-video-embed> placeholders with CustomVideoPlayer mount points.
        // The new format stores URL in data-src and width in data-width (from video-embed.ts renderHTML).
        const embedNodes = tempDiv.querySelectorAll('[data-video-embed]');
        embedNodes.forEach((node) => {
            // 1. Read data-src attribute (new format from video-embed.ts)
            let src = node.getAttribute('data-src') || '';
            const width = node.getAttribute('data-width') || '100%';

            // 2. Fallback: look for inner iframe (old format)
            if (!src) {
                const innerIframe = node.querySelector('iframe');
                if (innerIframe) src = innerIframe.getAttribute('src') || '';
            }

            if (!src) {
                node.remove();
                return;
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'cbt-custom-video-mount';
            wrapper.setAttribute('data-video-url', src);
            wrapper.setAttribute('data-video-width', width);
            node.replaceWith(wrapper);
        });

        // Wrap content to preserve structure
        return tempDiv.innerHTML;
    }, [content]);

    // Effect to mount CustomVideoPlayer into mount points
    useEffect(() => {
        if (!contentRef.current) return;
        const roots: { root: Root, el: Element }[] = [];
        
        const mountPoints = contentRef.current.querySelectorAll('.cbt-custom-video-mount');
        mountPoints.forEach(el => {
            const url = el.getAttribute('data-video-url');
            if (url && !el.hasAttribute('data-mounted')) {
                el.setAttribute('data-mounted', 'true');
                const root = createRoot(el);
                roots.push({ root, el });
                const width = el.getAttribute('data-video-width') || '100%';
                root.render(<CustomVideoPlayer url={url} width={width} />);
            }
        });

        return () => {
            roots.forEach(({ root, el }) => {
                setTimeout(() => {
                    try { root.unmount(); } catch (e) {}
                }, 0);
                el.removeAttribute('data-mounted');
            });
        };
    }, [processedContent]);

    return (
        <div
            ref={contentRef}
            className={`tiptap-preview ${className}`}
            dangerouslySetInnerHTML={{ __html: processedContent }}
        />
    );
}

// Read-only TipTap editor for preview
interface TipTapPreviewEditorProps {
    content: string;
    className?: string;
}

export function TipTapPreviewEditor({ content, className = '' }: TipTapPreviewEditorProps) {
    const editor = useEditor({
        immediatelyRender: false,
        editable: false,
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
                orderedList: false,
            }),
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
            Underline,
            Link.configure({
                openOnClick: false,
                HTMLAttributes: { class: 'text-blue-500 underline' },
            }),
            TextAlign.configure({
                types: ['heading', 'paragraph'],
                alignments: ['left', 'center', 'right', 'justify'],
            }),
            Placeholder.configure({ placeholder: '' }),
            VideoEmbed,
            AudioEmbed,
        ],
        content,
        editorProps: {
            attributes: {
                class: 'prose prose-slate max-w-none',
            },
        },
    });

    useEffect(() => {
        if (editor && content !== editor.getHTML()) {
            editor.commands.setContent(content);
        }
    }, [content, editor]);

    if (!editor) return null;

    return (
        <div className={`tiptap-preview-editor ${className}`}>
            <EditorContent editor={editor} />
            <style jsx global>{`
                .tiptap-preview-editor .ProseMirror ol {
                    list-style-type: decimal !important;
                    padding-left: 2rem !important;
                    margin: 0.75rem 0 !important;
                }
                .tiptap-preview-editor .ProseMirror ol[data-list-style="paren"] { list-style-type: decimal !important; }
                .tiptap-preview-editor .ProseMirror ol[data-list-style="roman-l"],
                .tiptap-preview-editor .ProseMirror ol[data-list-style="alpha-l"],
                .tiptap-preview-editor .ProseMirror ol[data-list-style="roman-u"],
                .tiptap-preview-editor .ProseMirror ol[data-list-style="alpha-u"] {
                    list-style-type: none !important;
                    padding-left: 1.5rem !important;
                }
                .tiptap-preview-editor .ProseMirror ol[data-list-style="roman-l"] > li::before { content: "(" counter(list-item, lower-roman) ") "; }
                .tiptap-preview-editor .ProseMirror ol[data-list-style="roman-l"] > li         { counter-increment: list-item; }
                .tiptap-preview-editor .ProseMirror ol[data-list-style="alpha-l"] > li::before { content: "(" counter(list-item, lower-alpha) ") "; }
                .tiptap-preview-editor .ProseMirror ol[data-list-style="alpha-l"] > li         { counter-increment: list-item; }
                .tiptap-preview-editor .ProseMirror ol[data-list-style="roman-u"] > li::before { content: counter(list-item, upper-roman) ". "; }
                .tiptap-preview-editor .ProseMirror ol[data-list-style="roman-u"] > li         { counter-increment: list-item; }
                .tiptap-preview-editor .ProseMirror ol[data-list-style="alpha-u"] > li::before { content: counter(list-item, upper-alpha) ". "; }
                .tiptap-preview-editor .ProseMirror ol[data-list-style="alpha-u"] > li         { counter-increment: list-item; }
                .tiptap-preview-editor .ProseMirror ol[data-list-style="paren"] > li::before { counter-increment: list-item; content: counter(list-item) ") "; }
                .tiptap-preview-editor .ProseMirror ol[data-list-style="paren"] > li         { counter-increment: list-item; }
            `}</style>
        </div>
    );
}

export default TipTapPreviewEditor;
