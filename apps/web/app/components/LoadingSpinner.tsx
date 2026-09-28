import { Spinner } from '@/app/components/ui/Spinner';
import { motion } from 'framer-motion';

interface LoadingSpinnerProps {
    size?: 'sm' | 'md' | 'lg';
    text?: string;
}

export default function LoadingSpinner({ size = 'md', text }: LoadingSpinnerProps) {
    const pixelSize = size === 'sm' ? 20 : size === 'lg' ? 40 : 32;

    return (
        <div className="flex flex-col items-center justify-center gap-4">
            <Spinner variant="buble" size={pixelSize} />
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
                    className="w-2 h-2 bg-[#3083FF] rounded-full"
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
                        className={`w-3 h-3 rounded-full ${i === 1 ? 'bg-[#3083FF]' : 'bg-[#3083FF]'}`}
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
