import React from 'react';
import { motion } from 'framer-motion';

interface LoadingSpinnerProps {
    size?: 'sm' | 'md' | 'lg';
    text?: string;
}

export default function LoadingSpinner({ size = 'md', text }: LoadingSpinnerProps) {
    const sizeClasses = {
        sm: 'w-6 h-6',
        md: 'w-10 h-10',
        lg: 'w-14 h-14'
    };

    return (
        <div className="flex flex-col items-center justify-center gap-4">
            <div className={`relative flex items-center justify-center ${sizeClasses[size]}`}>
                <motion.div
                    className="absolute inset-0 rounded-full border-[2.5px] border-[#030C4D]/10"
                />
                <motion.div
                    className="absolute inset-0 rounded-full border-[2.5px] border-transparent border-t-[#030C4D]"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.div
                    className="absolute inset-[4px] rounded-full border-[2.5px] border-transparent border-b-[#0038A8]"
                    animate={{ rotate: -360 }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.div 
                    className="absolute bg-[#030C4D] rounded-full w-1.5 h-1.5"
                    animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                />
            </div>
            {text && (
                <motion.p 
                    className="text-sm font-medium text-slate-500 tracking-wide"
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                >
                    {text}
                </motion.p>
            )}
        </div>
    );
}

export function LoadingDots() {
    return (
        <div className="flex items-center justify-center gap-1.5">
            {[0, 1, 2].map((i) => (
                <motion.div
                    key={i}
                    className="w-2 h-2 bg-[#030C4D] rounded-full"
                    animate={{ y: ["0%", "-50%", "0%"] }}
                    transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut", delay: i * 0.15 }}
                />
            ))}
        </div>
    );
}

export function LoadingPulse({ text }: { text?: string }) {
    return (
        <div className="flex flex-col items-center justify-center gap-4">
            <div className="flex items-center justify-center gap-2">
                {[0, 1, 2].map((i) => (
                    <motion.div
                        key={i}
                        className={`w-3 h-3 rounded-full ${i === 1 ? 'bg-[#0038A8]' : 'bg-[#030C4D]'}`}
                        animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                        transition={{ duration: 1, repeat: Infinity, ease: "easeInOut", delay: i * 0.2 }}
                    />
                ))}
            </div>
            {text && (
                <motion.p 
                    className="text-sm font-medium text-slate-500 tracking-wide"
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                >
                    {text}
                </motion.p>
            )}
        </div>
    );
}
