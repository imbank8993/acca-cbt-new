'use client';

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

type GradientTone = 'indigo' | 'teal' | 'sunset' | 'sky';

const toneClasses: Record<GradientTone, string> = {
    indigo: 'from-blue-500 via-indigo-500 to-violet-500 shadow-indigo-500/20',
    teal: 'from-emerald-500 via-teal-500 to-cyan-500 shadow-teal-500/20',
    sunset: 'from-amber-400 via-orange-500 to-rose-500 shadow-orange-500/20',
    sky: 'from-sky-500 via-blue-500 to-indigo-500 shadow-blue-500/20',
};

type GradientStatCardProps = {
    label: string;
    value: number | string;
    description?: string;
    icon?: LucideIcon;
    tone: GradientTone;
    onClick?: () => void;
    delay?: number;
};

export function GradientStatCard({ label, value, description, icon: Icon, tone, onClick, delay }: GradientStatCardProps) {
    const displayedValue = typeof value === 'number' ? value.toLocaleString('id-ID') : value;
    return <motion.div
        initial={delay === undefined ? false : { opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: delay ?? 0, duration: 0.35 }}
        whileHover={onClick ? { y: -2 } : undefined}
        whileTap={onClick ? { scale: 0.98 } : undefined}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        aria-label={onClick ? `${label}: ${displayedValue}${description ? ` — ${description}` : ''}` : undefined}
        onClick={onClick}
        onKeyDown={onClick ? event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
            }
        } : undefined}
        className={`relative isolate flex min-w-0 flex-col overflow-hidden rounded-2xl bg-gradient-to-br ${toneClasses[tone]} ${description ? 'min-h-[130px]' : 'min-h-[112px]'} p-3.5 text-left text-white shadow-md sm:p-4 ${onClick ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2' : ''}`}
    >
        <span aria-hidden="true" className="pointer-events-none absolute -right-6 -top-6 z-0 h-24 w-24 rounded-full bg-white/10" />
        <div className="relative z-10 flex min-w-0 items-center gap-2.5">
            {Icon && <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/15 sm:h-9 sm:w-9"><Icon size={17} aria-hidden="true" /></span>}
            <span className="min-w-0 text-xs font-semibold leading-snug text-white/90 sm:text-sm">{label}</span>
        </div>
        <strong className="relative z-10 mt-auto pt-3 text-[1.75rem] font-bold leading-none tabular-nums tracking-tight text-white sm:text-3xl">{displayedValue}</strong>
        {description && <span className="relative z-10 mt-1.5 text-[11px] font-medium leading-snug text-white/85 sm:text-xs">{description}</span>}
    </motion.div>;
}
