"use client";
/**
 * RichInput — Simple textarea for option inputs.
 * Plain text input with auto-resize.
 */
import React,{ forwardRef,useCallback,useEffect,useImperativeHandle,useRef,useState } from 'react';
import { extractMathExpressions,renderLatex } from '../math-utils';
import { TipTapEditor } from '../TipTapEditor';

export interface RichInputHandle {
    focus: () => void;
}

interface RichInputProps {
    value: string;
    onChange: (text: string) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
    placeholder?: string;
    className?: string;
    inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

function FormattedText({ text }: { text: string }) {
    if (!text) return null;
    const expressions = extractMathExpressions(text);
    if (expressions.length === 0) return <span>{text}</span>;

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    expressions.forEach((expr, i) => {
        if (expr.start > lastIndex) {
            parts.push(<span key={`text-${i}`}>{text.substring(lastIndex, expr.start)}</span>);
        }
        const html = renderLatex(expr.latex, expr.displayMode).html;
        parts.push(
            <span 
                key={`math-${i}`} 
                className={expr.displayMode ? "block my-2 text-center" : "inline-block mx-1"}
                dangerouslySetInnerHTML={{ __html: html }} 
            />
        );
        lastIndex = expr.end;
    });
    if (lastIndex < text.length) {
        parts.push(<span key="text-end">{text.substring(lastIndex)}</span>);
    }
    return <>{parts}</>;
}

export const RichInput = forwardRef<RichInputHandle, RichInputProps>(({
    value,
    onChange,
    onFocus,
    onBlur,
    onPaste,
    placeholder = '',
    className = '',
    inputRef: externalRef,
}, ref) => {
    const internalRef = useRef<HTMLTextAreaElement>(null);
    const textareaRef = (externalRef as React.RefObject<HTMLTextAreaElement>) || internalRef;
    const [isFocused, setIsFocused] = useState(false);
    // When the math preview is shown the textarea is display:none and cannot be
    // focused directly. Clicking the preview flips `editing` on, which reveals
    // the textarea; the effect below then moves focus into it.
    const [editing, setEditing] = useState(false);

    useImperativeHandle(ref, () => ({
        focus: () => { setEditing(true); },
    }));

    useEffect(() => {
        if (editing) textareaRef.current?.focus();
    }, [editing, textareaRef]);

    // Auto-resize textarea
    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.style.height = '26px';
        textarea.style.height = `${textarea.scrollHeight}px`;
    }, [value, textareaRef, isFocused]);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange(e.target.value);
    }, [onChange]);

    const handleFocus = () => {
        setIsFocused(true);
        onFocus?.();
    };

    const handleBlur = () => {
        setIsFocused(false);
        setEditing(false);
        onBlur?.();
    };

    const hasMath = value && value.match(/\$|\\\[|\\begin/);
    const showPreview = !isFocused && !editing && hasMath;

    // Media HTML needs a visual editor; a textarea exposes the image data URL.
    if (/<(?:img|video|audio|iframe)\b/i.test(value)) {
        return <div className="w-full min-w-0" onFocusCapture={onFocus} onBlurCapture={onBlur}>
            <TipTapEditor compact content={value} onChange={onChange} placeholder={placeholder} minHeight="72px" />
        </div>;
    }

    return (
        <div className="w-full relative">
            <div
                className={`${showPreview ? 'block' : 'hidden'} w-full px-2 py-1.5 min-h-[26px] text-[13px] leading-[1.4] text-slate-700 cursor-text rich-input-text ${className}`}
                onClick={() => setEditing(true)}
                style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
            >
                <FormattedText text={value} />
            </div>

            <textarea
                ref={textareaRef}
                value={value}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onPaste={onPaste}
                placeholder={placeholder}
                rows={1}
                className={`
                    ${showPreview ? 'hidden' : 'block'}
                    w-full resize-none outline-none bg-transparent
                    text-[13px] leading-[1.4] text-slate-700
                    placeholder:text-slate-300
                    border-none px-2 py-1.5 m-0
                    focus:ring-0 rich-input-textarea
                    ${className}
                `}
                style={{
                    minHeight: '26px',
                    height: '26px',
                    overflow: 'hidden',
                    boxSizing: 'border-box',
                }}
            />
        </div>
    );
});

RichInput.displayName = 'RichInput';
