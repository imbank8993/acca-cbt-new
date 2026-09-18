"use client";
import React from 'react';
import { LatexRenderer } from './LatexRenderer';

export const StimulusViewer = ({ stimulus }: { stimulus: any }) => {
    if (!stimulus || !stimulus.content) return null;

    return (
        <div className="mb-3 pb-3 border-b border-slate-200">
            <h3 className="text-sm font-bold text-slate-800 mb-2">Stimulus</h3>
            <div className="text-sm leading-relaxed text-slate-700 [&_img]:max-w-full [&_img]:rounded-md [&_img]:mx-auto">
                <LatexRenderer text={stimulus.content} />
            </div>
        </div>
    );
};
