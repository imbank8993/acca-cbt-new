'use client';

import { useState } from 'react';
import { Clock } from 'lucide-react';
import { parseTypedTime } from '@/lib/time-input';

export function TimeTextField({ value, onChange, label, disabled, required }: {
    value: string;
    onChange: (value: string) => void;
    label: string;
    disabled?: boolean;
    required?: boolean;
}) {
    const [draft, setDraft] = useState(value);
    const [previousValue, setPreviousValue] = useState(value);
    const [invalid, setInvalid] = useState(false);
    if (value !== previousValue) {
        setPreviousValue(value);
        setDraft(value);
        setInvalid(false);
    }
    const validate = (input: HTMLInputElement) => {
        const parsed = parseTypedTime(input.value);
        const invalidTime = Boolean(input.value.trim()) && parsed === null;
        input.setCustomValidity(invalidTime ? 'Masukkan jam antara 00:00 dan 23:59.' : '');
        return parsed;
    };
    const commit = (input: HTMLInputElement) => {
        const parsed = validate(input);
        setInvalid(Boolean(input.value) && parsed === null);
        if (parsed !== null) {
            setDraft(parsed);
            if (parsed !== value) onChange(parsed);
        } else if (!input.value) onChange('');
    };
    return (
        <div className="relative">
            <Clock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#3083FF]" />
            <input
                ref={input => {
                    if (input) input.setCustomValidity(draft.trim() && parseTypedTime(draft) === null
                        ? 'Masukkan jam antara 00:00 dan 23:59.' : '');
                }}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                maxLength={5}
                value={draft}
                placeholder="HH:mm"
                aria-label={`${label} — jam`}
                aria-invalid={invalid || undefined}
                title="Ketik 0830 atau 08:30 (format 24 jam)"
                disabled={disabled}
                required={required}
                className={`h-[38px] w-full rounded-lg border bg-white pl-9 pr-3 font-mono text-sm tabular-nums outline-none transition-colors placeholder:text-slate-400 focus:border-[#3083FF] focus:ring-2 focus:ring-[#3083FF]/15 disabled:opacity-50 ${invalid ? 'border-red-400' : 'border-slate-200'}`}
                onFocus={event => { event.currentTarget.select(); validate(event.currentTarget); }}
                onChange={event => {
                    const input = event.currentTarget;
                    setDraft(input.value);
                    setInvalid(false);
                    const parsed = validate(input);
                    // Wait for a complete minute before publishing to avoid jumping the caret.
                    if (parsed && (/^\d{4}$/.test(input.value) || /^\d{1,2}[:.]\d{2}$/.test(input.value))) {
                        if (parsed !== value) onChange(parsed);
                    }
                }}
                onBlur={event => commit(event.currentTarget)}
                onInvalid={() => setInvalid(true)}
                onKeyDown={event => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        commit(event.currentTarget);
                        if (!event.currentTarget.checkValidity()) event.currentTarget.reportValidity();
                    }
                }}
            />
        </div>
    );
}
