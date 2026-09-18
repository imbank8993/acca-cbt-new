"use client";
import React, { useState, InputHTMLAttributes } from 'react';
import { Lock, Eye, EyeOff } from 'lucide-react';

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
    iconSize?: number;
    iconClassName?: string;
}

export default function PasswordInput({
    iconSize = 16,
    iconClassName = '',
    className = '',
    ...props
}: PasswordInputProps) {
    const [show, setShow] = useState(false);

    return (
        <div className="relative group">
            <Lock
                className={`absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-indigo-400 transition-colors ${iconClassName}`}
                size={iconSize}
            />
            <input
                {...props}
                type={show ? 'text' : 'password'}
                className={className}
            />
            <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? 'Sembunyikan password' : 'Lihat password'}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-indigo-400 transition-colors p-1 rounded"
                tabIndex={-1}
            >
                {show ? <EyeOff size={iconSize} /> : <Eye size={iconSize} />}
            </button>
        </div>
    );
}
