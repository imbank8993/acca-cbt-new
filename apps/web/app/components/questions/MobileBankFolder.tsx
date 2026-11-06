'use client';

import type { BankFolder, QuestionBank } from '@/lib/api/questions';
import { ChevronRight, Folder, Globe, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { FolderBankContents } from './FolderBankContents';

interface MobileBankFolderProps {
    folder: BankFolder;
    banks: QuestionBank[];
    expanded: boolean;
    onToggle: () => void;
    renderBank: (bank: QuestionBank) => ReactNode;
}

export function MobileBankFolder({ folder, banks, expanded, onToggle, renderBank }: MobileBankFolderProps) {
    return (
        <section className="space-y-2">
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                className="flex w-full items-center gap-2 rounded-lg border border-[#3083FF]/30 bg-[#3083FF]/5 px-3 py-3 text-left"
            >
                <ChevronRight size={16} className={`shrink-0 text-slate-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                <Folder size={18} className="shrink-0 text-[#3083FF]" />
                <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-semibold text-slate-700">{folder.name} <span className="font-normal text-slate-400">({banks.length})</span></span>
                    <span className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500">
                        {folder.is_public ? <><Globe size={11} /> Publik</> : <><Lock size={11} /> Pribadi</>}
                        {!folder.isOwner && folder.creator_name && <span>· oleh {folder.creator_name}</span>}
                    </span>
                </span>
            </button>
            {expanded && (banks.length > 0
                ? <FolderBankContents folderName={folder.name} banks={banks} renderBank={renderBank} />
                : <p className="pl-6 py-3 text-sm text-slate-400">Folder kosong</p>)}
        </section>
    );
}
