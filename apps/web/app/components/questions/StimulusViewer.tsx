"use client";
import type { QuestionStimulus } from '@/app/types';
import { LatexRenderer } from './LatexRenderer';
import './question-dark-surfaces.css';

export const StimulusViewer = ({ stimulus }: { stimulus: QuestionStimulus }) => {
    if (!stimulus || !stimulus.content) return null;

    return (
        <div className="question-stimulus mb-2.5 pb-2.5 border-b border-slate-200">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3083FF]" /> Stimulus
            </h3>
            <div className="text-xs sm:text-sm leading-relaxed text-slate-700 [&_img]:max-w-full [&_img]:rounded-md [&_img]:mx-auto">
                <LatexRenderer text={stimulus.content} />
            </div>
        </div>
    );
};
