"use client";
import TiptapHighlight from '@tiptap/extension-highlight';
import TiptapImage from '@tiptap/extension-image';
import TiptapLink from '@tiptap/extension-link';
import TiptapPlaceholder from '@tiptap/extension-placeholder';
import TiptapSubscript from '@tiptap/extension-subscript';
import TiptapSuperscript from '@tiptap/extension-superscript';
import TiptapTextAlign from '@tiptap/extension-text-align';
import TiptapUnderline from '@tiptap/extension-underline';
import { EditorContent,useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
AlignCenter,
AlignJustify,
AlignLeft,
AlignRight,
Bold,
Code,
Heading2,
Highlighter,
Image as ImageIcon,
Italic,
Link,
List,ListOrdered,
Minus,
Quote,
Redo,
Sigma,
Strikethrough,
Subscript,Superscript,
Underline,
Undo
} from 'lucide-react';
import React,{ useState } from 'react';

interface TiptapEditorProps {
    content: string;
    onChange: (html: string) => void;
    placeholder?: string;
}

const MenuButton = ({ onClick, active, disabled, children, title }: {
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
    children: React.ReactNode;
    title: string;
}) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={`p-2 rounded-lg transition-all ${
            active
                ? 'bg-[#3083FF] text-white'
                : 'text-[#64748b] hover:bg-[#f1f5f9] hover:text-[#3083FF]'
        } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
        {children}
    </button>
);

const ToolbarDivider = () => <div className="w-px h-6 bg-[#e2e8f0] mx-1" />;

// MathLive MathField component
function MathField({
    onInsert
}: {
    onInsert: (latex: string) => void
}) {
    const [, setLatex] = useState('');
    const [showMath, setShowMath] = useState(false);

    React.useEffect(() => {
        if (!showMath) return;
        const loadMathLive = async () => {
            const ML = await import('mathlive') as any;
            const field = document.getElementById('math-field');
            if (field && ML) {
                const mf = new ML.MathField(field, {
                    virtualKeyboardOnMobile: true,
                    virtualKeyboardTheme: 'material',
                });
                (window as any).__mathField = mf;
            }
        };
        loadMathLive();
    }, [showMath]);

    const handleInsert = () => {
        if ((window as any).__mathField) {
            const latex = (window as any).__mathField.latex();
            onInsert(`$$${latex}$$`);
            setShowMath(false);
            setLatex('');
        }
    };

    if (!showMath) {
        return (
            <MenuButton onClick={() => setShowMath(true)} title="Equation">
                <Sigma size={16} />
            </MenuButton>
        );
    }

    return (
        <div className="absolute top-full left-0 mt-1 bg-white border border-[#e2e8f0] rounded-xl shadow-xl z-50 p-4 w-80">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#64748b]">Equation Editor</span>
                <button onClick={() => setShowMath(false)} className="text-[#94a3b8] hover:text-[#3083FF]">×</button>
            </div>
            <div id="math-field" style={{ border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.5rem', minHeight: '48px', background: '#f8fafc' }} />
            <div className="flex gap-2 mt-2">
                <button onClick={handleInsert} className="flex-1 py-1.5 bg-[#3083FF] text-white text-sm rounded-lg font-semibold">
                    Insert
                </button>
                <button onClick={() => setShowMath(false)} className="px-3 py-1.5 bg-[#f1f5f9] text-[#64748b] text-sm rounded-lg">
                    Cancel
                </button>
            </div>
            <p className="text-xs text-[#94a3b8] mt-2">Type or click buttons to build equation</p>
        </div>
    );
}

export default function TiptapEditor({ content, onChange, placeholder = 'Tulis konten artikel di sini...' }: TiptapEditorProps) {
    const [showMathField, setShowMathField] = useState(false);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [2, 3] },
            }),
            TiptapImage.configure({
                HTMLAttributes: { class: 'max-w-full h-auto rounded-xl' },
            }),
            TiptapLink.configure({
                openOnClick: false,
                HTMLAttributes: { class: 'text-[#3083FF] underline hover:text-[#3083FF]' },
            }),
            TiptapTextAlign.configure({ types: ['heading', 'paragraph', 'listItem'] }),
            TiptapUnderline,
            TiptapHighlight.configure({ multicolor: true }),
            TiptapSubscript,
            TiptapSuperscript,
            TiptapPlaceholder.configure({
                placeholder,
                emptyEditorClass: 'is-editor-empty',
            }),
        ],
        content,
        immediatelyRender: false,
        onUpdate: ({ editor }) => {
            onChange(editor.getHTML());
        },
        editorProps: {
            attributes: {
                class: 'rich-content focus:outline-none min-h-[300px] p-4 text-base',
            },
        },
    });

    React.useEffect(() => {
        if (editor && content && content !== editor.getHTML()) {
            editor.commands.setContent(content);
        }
    }, [content, editor]);

    if (!editor) return null;

    const addImage = () => {
        const url = window.prompt('Masukkan URL gambar:');
        if (url) {
            editor.chain().focus().setImage({ src: url }).run();
        }
    };

    const addLink = () => {
        const url = window.prompt('Masukkan URL:');
        if (url) {
            editor.chain().focus().setLink({ href: url }).run();
        } else {
            editor.chain().focus().unsetLink().run();
        }
    };

    const insertEquation = (latex: string) => {
        editor.chain().focus().insertContent(latex).run();
        setShowMathField(false);
    };

    return (
        <div className="border border-[#e2e8f0] rounded-xl overflow-hidden bg-white">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-1 p-2 border-b border-[#e2e8f0] bg-[#f8fafc] relative">
                {/* Undo/Redo */}
                <MenuButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo">
                    <Undo size={16} />
                </MenuButton>
                <MenuButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo">
                    <Redo size={16} />
                </MenuButton>

                <ToolbarDivider />

                {/* Heading */}
                <MenuButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">
                    <Heading2 size={16} />
                </MenuButton>

                <ToolbarDivider />

                {/* Text formatting */}
                <MenuButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
                    <Bold size={16} />
                </MenuButton>
                <MenuButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
                    <Italic size={16} />
                </MenuButton>
                <MenuButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline">
                    <Underline size={16} />
                </MenuButton>
                <MenuButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
                    <Strikethrough size={16} />
                </MenuButton>
                <MenuButton onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Code">
                    <Code size={16} />
                </MenuButton>
                <MenuButton onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive('highlight')} title="Highlight">
                    <Highlighter size={16} />
                </MenuButton>
                <MenuButton onClick={() => editor.chain().focus().toggleSubscript().run()} active={editor.isActive('subscript')} title="Subscript">
                    <Subscript size={16} />
                </MenuButton>
                <MenuButton onClick={() => editor.chain().focus().toggleSuperscript().run()} active={editor.isActive('superscript')} title="Superscript">
                    <Superscript size={16} />
                </MenuButton>

                <ToolbarDivider />

                {/* Lists */}
                <MenuButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet List">
                    <List size={16} />
                </MenuButton>
                <MenuButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Ordered List">
                    <ListOrdered size={16} />
                </MenuButton>
                <MenuButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Quote">
                    <Quote size={16} />
                </MenuButton>

                <ToolbarDivider />

                {/* Alignment */}
                <MenuButton onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align Left">
                    <AlignLeft size={16} />
                </MenuButton>
                <MenuButton onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align Center">
                    <AlignCenter size={16} />
                </MenuButton>
                <MenuButton onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align Right">
                    <AlignRight size={16} />
                </MenuButton>
                <MenuButton onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justify">
                    <AlignJustify size={16} />
                </MenuButton>

                <ToolbarDivider />

                {/* Link & Image */}
                <MenuButton onClick={addLink} active={editor.isActive('link')} title="Add Link">
                    <Link size={16} />
                </MenuButton>
                <MenuButton onClick={addImage} title="Add Image">
                    <ImageIcon size={16} />
                </MenuButton>

                <ToolbarDivider />

                {/* Equation */}
                <div className="relative">
                    <MenuButton onClick={() => setShowMathField(!showMathField)} active={showMathField} title="Equation">
                        <Sigma size={16} />
                    </MenuButton>
                    {showMathField && (
                        <MathField onInsert={insertEquation} />
                    )}
                </div>

                {/* Horizontal rule */}
                <MenuButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal Rule">
                    <Minus size={16} />
                </MenuButton>
            </div>

            {/* Editor Content */}
            <style jsx global>{`
                .tiptap-editor .ProseMirror {
                    min-height: 300px;
                    outline: none;
                    padding: 1rem;
                }
                .tiptap-editor .ProseMirror p.is-editor-empty:first-child::before {
                    content: attr(data-placeholder);
                    float: left;
                    color: #94a3b8;
                    pointer-events: none;
                    height: 0;
                }
                .tiptap-editor .ProseMirror h2 {
                    font-size: 1.5rem;
                    font-weight: 700;
                    color: #3083FF;
                    margin: 1.5rem 0 0.75rem;
                }
                .tiptap-editor .ProseMirror h3 {
                    font-size: 1.25rem;
                    font-weight: 600;
                    color: #3083FF;
                    margin: 1rem 0 0.5rem;
                }
                .tiptap-editor .ProseMirror p {
                    margin: 0.75rem 0;
                    line-height: 1.75;
                    color: #334155;
                }
                .tiptap-editor .ProseMirror ul, .tiptap-editor .ProseMirror ol {
                    padding-left: 1.5rem;
                    margin: 0.75rem 0;
                }
                .tiptap-editor .ProseMirror li {
                    margin: 0.25rem 0;
                }
                /* Ordered list numbers */
                .tiptap-editor .ProseMirror ol {
                    counter-reset: list-counter;
                    list-style: none;
                }
                .tiptap-editor .ProseMirror ol li {
                    counter-increment: list-counter;
                    position: relative;
                    padding-left: 1.75rem;
                }
                .tiptap-editor .ProseMirror ol li::before {
                    content: counter(list-counter) ".";
                    position: absolute;
                    left: 0;
                    font-weight: 600;
                    color: #3083FF;
                }
                .tiptap-editor .ProseMirror blockquote {
                    border-left: 4px solid #3083FF;
                    padding-left: 1rem;
                    margin: 1rem 0;
                    font-style: italic;
                    color: #64748b;
                }
                .tiptap-editor .ProseMirror code {
                    background: #f1f5f9;
                    padding: 0.125rem 0.25rem;
                    border-radius: 0.25rem;
                    font-family: monospace;
                    font-size: 0.875rem;
                }
                .tiptap-editor .ProseMirror pre {
                    background: #1e293b;
                    color: #e2e8f0;
                    padding: 1rem;
                    border-radius: 0.5rem;
                    overflow-x: auto;
                    margin: 1rem 0;
                }
                .tiptap-editor .ProseMirror pre code {
                    background: none;
                    padding: 0;
                    color: inherit;
                }
                .tiptap-editor .ProseMirror hr {
                    border: none;
                    border-top: 2px solid #e2e8f0;
                    margin: 2rem 0;
                }
                .tiptap-editor .ProseMirror img {
                    max-width: 100%;
                    height: auto;
                    border-radius: 0.75rem;
                    margin: 1rem 0;
                }
                .tiptap-editor .ProseMirror a {
                    color: #3083FF;
                    text-decoration: underline;
                }
                /* Math equation in post content */
                .tiptap-editor .ProseMirror .math-equation,
                .tiptap-editor .ProseMirror p:has(> span[data-type="math"]),
                .tiptap-editor .ProseMirror p:contains("$$") {
                    display: inline-block;
                    padding: 0.25rem 0.5rem;
                    background: #f8fafc;
                    border: 1px dashed #e2e8f0;
                    border-radius: 0.375rem;
                    font-family: monospace;
                    font-size: 0.875rem;
                    color: #3083FF;
                }
                /* Justify text */
                .tiptap-editor .ProseMirror p,
                .tiptap-editor .ProseMirror li {
                    text-align: inherit;
                }
                .tiptap-editor .ProseMirror p[data-align="justify"] {
                    text-align: justify;
                }
                /* Highlight */
                .tiptap-editor .ProseMirror mark {
                    background-color: #fef08a;
                    padding: 0.1em 0.2em;
                    border-radius: 0.2em;
                }
            `}</style>
            <EditorContent editor={editor} className="tiptap-editor" />
        </div>
    );
}
