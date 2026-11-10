"use client";
import '@/app/components/questions/bank-folder-menu.css';

import { CollaborationButton } from '@/app/components/CollaborationButton';
import { confirmDialog } from '@/lib/confirm-dialog';
import { getErrorMessage } from '@/lib/errors';
import { ActionButton } from '@/app/components/ui/actionbutton';
import { Button } from '@/app/components/ui/button';
import { FilterActions,FilterSearch,FilterSelect,FilterToolbar } from '@/app/components/ui/filtertoolbar';
import { Modal,ModalBody,ModalField,ModalFooter } from '@/app/components/ui/modal';
import { Spinner } from '@/app/components/ui/Spinner';
import { LIST_PAGE_SIZE, ListPagination } from '@/app/components/ui/list-pagination';
import { getProctorOrganization,hasUserDualRole,isUserProctor,listSubjects } from '@/lib/api/proctor';
import type { ProctorOrganization,SchoolSubject } from '@/lib/api/proctor';
import { bulkMoveBanksToFolder,createBankFolder,createQuestionBank,deleteBankFolder,deleteQuestionBank,listBankFolders,listOrganizationLabels,listQuestionBanks,moveBankToFolder,toggleQuestionBankPublishAction,updateBankFolder } from '@/lib/api/questions';
import type { BankFolder,OrganizationLabel,QuestionBank } from '@/lib/api/questions';
import { getSessionUser } from '@/lib/session';
import { useMemoryState } from '@/lib/useMemoryState';
import { useBankFolderMenu } from '@/lib/useBankFolderMenu';
import {
ArrowRight,
ArrowLeft,
CloudUpload,
CloudOff,
Eye,
BookOpen,
Check,
ChevronRight,
Edit3,
Folder,
Globe,
Lock,
MoreHorizontal,
Plus,
Trash2
} from 'lucide-react';
import Link from 'next/link';
import React,{ useCallback,useEffect,useRef,useState } from 'react';
import { CreateBankModal } from '@/components/questions/CreateBankModal';
import { ValidationBadge } from '@/app/components/validations/ValidationBadge';
import { QuestionBankCover } from '@/app/components/questions/QuestionBankCover';
import { registerPageFab, unregisterPageFab } from '@/app/components/mobile/page-fab';


export default function ProktorQuestionBankPage() {
    const [banks, setBanks] = useMemoryState<QuestionBank[]>('proktor_questions_banks', []);
    const [isLoading, setIsLoading] = useMemoryState('proktor_questions_isLoading', true);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [bankToDelete, setBankToDelete] = useState<QuestionBank | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [org, setOrg] = useState<ProctorOrganization | null>(null);
    const [, setIsProctor] = useState(true);
    const [, setIsDualRole] = useState(false);
    const [, setCurrentUserId] = useState<string | null>(null);

    const [activeTab] = useState<'all' | 'draft' | 'published'>('all');
    const [editingBank, setEditingBank] = useState<QuestionBank | null>(null);
    const [targetFolderId, setTargetFolderId] = useState<string | undefined>(undefined);
    const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
    const [accessFilter, setAccessFilter] = useState('all');
    // Register Mobile Center FAB on BottomNav
    useEffect(() => {
        const token = {};
        registerPageFab(token, {
            label: 'Buat Bank Soal',
            icon: 'plus',
            run: () => {
                setEditingBank(null);
                setTargetFolderId(activeFolderId || undefined);
                setIsAddModalOpen(true);
            },
        });
        return () => {
            unregisterPageFab(token);
        };
    }, [activeFolderId]);

    const [searchQuery, setSearchQuery] = useState('');
    const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
    const [activeSubjectFilter, setActiveSubjectFilter] = useState<string | null>(null);
    const [activeCreatorFilter, setActiveCreatorFilter] = useState<string | null>(null);
    const PAGE_SIZE = LIST_PAGE_SIZE;
    const [currentPage, setCurrentPage] = useState(1);

    const [labels, setLabels] = useMemoryState<OrganizationLabel[]>('proktor_questions_labels', []);
    const [orgSubjects, setOrgSubjects] = useMemoryState<SchoolSubject[]>('proktor_questions_orgSubjects', []);

    const [, setIsLabelDropdownOpen] = useState(false);
    const [] = useState('');
    const labelDropdownRef = useRef<HTMLDivElement>(null);

    const [, setIsSubjectDropdownOpen] = useState(false);
    const [] = useState('');
    const subjectDropdownRef = useRef<HTMLDivElement>(null);

    const [, setIsCreatorDropdownOpen] = useState(false);
    const [] = useState('');
    const creatorDropdownRef = useRef<HTMLDivElement>(null);

    const [activeClassFilter, setActiveClassFilter] = useState<string | null>(null);
    const [, setIsClassDropdownOpen] = useState(false);
    const [] = useState('');
    const classDropdownRef = useRef<HTMLDivElement>(null);

    const CLASS_LEVELS = [
        "Kelas 10", "Kelas 11", "Kelas 12", "Umum"
    ];

    const handleSelectAll = () => {
        const allFilteredIds = (activeFolderId ? visibleBanks : filteredBanks).filter(bank => bank.canManage === true).map(b => b.id);
        setSelectedBankIds(new Set(allFilteredIds));
    };

    const handleClearSelection = () => {
        setSelectedBankIds(new Set());
    };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (labelDropdownRef.current && !labelDropdownRef.current.contains(event.target as Node)) {
                setIsLabelDropdownOpen(false);
            }
            if (subjectDropdownRef.current && !subjectDropdownRef.current.contains(event.target as Node)) {
                setIsSubjectDropdownOpen(false);
            }
            if (creatorDropdownRef.current && !creatorDropdownRef.current.contains(event.target as Node)) {
                setIsCreatorDropdownOpen(false);
            }
            if (classDropdownRef.current && !classDropdownRef.current.contains(event.target as Node)) {
                setIsClassDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Folder state
    const [folders, setFolders] = useMemoryState<BankFolder[]>('proktor_questions_folders', []);
    const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
    const [editingFolder, setEditingFolder] = useState<BankFolder | null>(null);
    const [newFolderName, setNewFolderName] = useState('');
    const [newFolderPublic, setNewFolderPublic] = useState(false);
    const [] = useState<string | null>(null);
    const { folderMenuId, setFolderMenuId, folderMenuRef } = useBankFolderMenu();
    const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
    const [bankToMove, setBankToMove] = useState<QuestionBank | null>(null);

    // Bulk selection state
    const [, setBulkMode] = useState(false);
    const [selectedBankIds, setSelectedBankIds] = useState<Set<string>>(new Set());

    // Bulk move modal
    const [isBulkMoveModalOpen, setIsBulkMoveModalOpen] = useState(false);

    // Add to folder modal (select existing banks)
    const [isAddToFolderModalOpen, setIsAddToFolderModalOpen] = useState(false);
    const [targetFolder, setTargetFolder] = useState<BankFolder | null>(null);
    const [selectedAddToFolderIds, setSelectedAddToFolderIds] = useState<Set<string>>(new Set());

    const loadData = useCallback(async () => {
        // setIsLoading(true); // Disabled for silent background sync
        try {
            const user = await getSessionUser();
            if (user) {
                const [organization, proctorStatus, dualRoleStatus] = await Promise.all([
                    getProctorOrganization(),
                    isUserProctor(),
                    hasUserDualRole()
                ]);
                if (organization) {
                    setOrg(organization);
                    setIsProctor(proctorStatus);
                    setIsDualRole(dualRoleStatus);
                    setCurrentUserId(user.id);
                    const [bankList, labelList, folderList, subjectList] = await Promise.all([
                        listQuestionBanks(),
                        listOrganizationLabels(),
                        listBankFolders(),
                        listSubjects()
                    ]);
                    setBanks(bankList || []);
                    setLabels(labelList || []);
                    setFolders(folderList || []);
                    setOrgSubjects(subjectList || []);
                }
            }
        } catch (err) {
            console.error('Bank: Load error:', err);
        } finally {
            setIsLoading(false);
        }
    }, [setBanks, setFolders, setIsLoading, setLabels, setOrgSubjects]);

    useEffect(() => {
        const timer = window.setTimeout(() => void loadData(), 0);
        const handleFocus = () => void loadData();
        window.addEventListener('focus', handleFocus);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('focus', handleFocus);
        };
    }, [loadData]);

    const handleOpenEdit = (bank: QuestionBank) => {
        setEditingBank(bank);
        setIsAddModalOpen(true);
    };

    const handleDeleteBank = async () => {
        if (!bankToDelete || !org) return;
        setIsSubmitting(true);
        try {
            const result = await deleteQuestionBank(bankToDelete.id);
            if (result.success) { setIsDeleteModalOpen(false); setBankToDelete(null); await loadData(); }
            else { alert('Gagal: ' + result.error); }
        } catch { alert('Error.'); }
        finally { setIsSubmitting(false); }
    };

    const handleTogglePublish = async (bank: QuestionBank) => {
        if (!org) return;
        const newStatus = !bank.is_published;
        if (!await confirmDialog({
            title: newStatus ? 'Publish Bank Soal?' : 'Unpublish Bank Soal?',
            text: newStatus
                ? `Publish bank soal "${bank.title}" agar dapat digunakan untuk menyusun ujian?`
                : `Unpublish bank soal "${bank.title}" dan kembalikan statusnya menjadi draf?`,
            confirmText: 'Ya', cancelText: 'Tidak', variant: 'warning',
        })) return;
        const result = await toggleQuestionBankPublishAction(bank.id, newStatus);
        if (result.success) await loadData();
        else alert('Gagal: ' + result.error);
    };


    // Folder actions
    const handleOpenCreateFolder = () => {
        setNewFolderName('');
        setNewFolderPublic(false);
        setEditingFolder(null);
        setIsFolderModalOpen(true);
    };

    const handleOpenEditFolder = (folder: BankFolder) => {
        setNewFolderName(folder.name);
        setNewFolderPublic(folder.is_public === true);
        setEditingFolder(folder);
        setIsFolderModalOpen(true);
        setFolderMenuId(null);
    };

    const handleSaveFolder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!org) return;
        setIsSubmitting(true);
        try {
            const user = await getSessionUser();
            if (!user) return;

            let result: Awaited<ReturnType<typeof createQuestionBank>>;
            if (editingFolder) {
                result = await updateBankFolder(editingFolder.id, newFolderName, newFolderPublic);
            } else {
                result = await createBankFolder(newFolderName, newFolderPublic);
            }

            if (result.success) {
                setIsFolderModalOpen(false);
                setNewFolderName('');
                setEditingFolder(null);
                await loadData();
            } else { alert('Gagal: ' + result.error); }
        } catch (err) { alert('Error: ' + getErrorMessage(err)); }
        finally { setIsSubmitting(false); }
    };

    const handleDeleteFolder = async (folder: BankFolder) => {
        if (!org) return;
        setFolderMenuId(null);
        if (folder.canDelete !== true) {
            alert('Folder masih berisi bank soal. Pindahkan semua bank soal keluar dari folder sebelum menghapusnya.');
            return;
        }
        setIsSubmitting(true);
        try {
            const result = await deleteBankFolder(folder.id);
            if (result.success) {
                setFolderMenuId(null);
                await loadData();
            } else { alert('Gagal: ' + result.error); }
        } catch (err) { alert('Error: ' + getErrorMessage(err)); }
        finally { setIsSubmitting(false); }
    };

    const handleOpenAddToFolder = (folder: BankFolder) => {
        setTargetFolder(folder);
        setSelectedAddToFolderIds(new Set());
        setIsAddToFolderModalOpen(true);
        setFolderMenuId(null);
    };

    const handleAddBanksToFolder = async () => {
        if (!org || !targetFolder || selectedAddToFolderIds.size === 0) return;
        setIsSubmitting(true);
        try {
            const result = await bulkMoveBanksToFolder(Array.from(selectedAddToFolderIds), targetFolder.id);
            if (result.success) {
                setIsAddToFolderModalOpen(false);
                setTargetFolder(null);
                setSelectedAddToFolderIds(new Set());
                await loadData();
            } else { alert('Gagal: ' + result.error); }
        } catch (err) { alert('Error: ' + getErrorMessage(err)); }
        finally { setIsSubmitting(false); }
    };

    const handleOpenMoveBank = (bank: QuestionBank) => {
        setBankToMove(bank);
        setIsMoveModalOpen(true);
        setFolderMenuId(null);
    };

    const handleMoveBank = async (folderId: string | null) => {
        if (!org || !bankToMove) return;
        setIsSubmitting(true);
        try {
            const result = await moveBankToFolder(bankToMove.id, folderId);
            if (result.success) {
                setIsMoveModalOpen(false);
                setBankToMove(null);
                await loadData();
            } else { alert('Gagal: ' + result.error); }
        } catch (err) { alert('Error: ' + getErrorMessage(err)); }
        finally { setIsSubmitting(false); }
    };

    // Bulk selection functions

    const toggleSelectBank = (bankId: string) => {
        setSelectedBankIds(prev => {
            const next = new Set(prev);
            if (next.has(bankId)) next.delete(bankId);
            else next.add(bankId);
            return next;
        });
    };

    const toggleSelectAllInFolder = (folderBanks: QuestionBank[]) => {
        folderBanks = folderBanks.filter(bank => bank.canManage === true);
        const allSelected = folderBanks.every(b => selectedBankIds.has(b.id));
        setSelectedBankIds(prev => {
            const next = new Set(prev);
            if (allSelected) {
                folderBanks.forEach(b => next.delete(b.id));
            } else {
                folderBanks.forEach(b => next.add(b.id));
            }
            return next;
        });
    };


    const handleBulkMove = async (folderId: string | null) => {
        if (!org || selectedBankIds.size === 0) return;
        setIsSubmitting(true);
        try {
            const result = await bulkMoveBanksToFolder(Array.from(selectedBankIds), folderId);
            if (result.success) {
                setIsBulkMoveModalOpen(false);
                setSelectedBankIds(new Set());
                setBulkMode(false);
                await loadData();
            } else { alert('Gagal: ' + result.error); }
        } catch (err) { alert('Error: ' + getErrorMessage(err)); }
        finally { setIsSubmitting(false); }
    };

    const openFolder = (folderId: string) => {
        setActiveFolderId(folderId);
        setCurrentPage(1);
        setSelectedBankIds(new Set());
        setFolderMenuId(null);
    };

    const closeFolder = () => {
        setActiveFolderId(null);
        setCurrentPage(1);
        setSelectedBankIds(new Set());
        setFolderMenuId(null);
    };

    const subjects = Array.from(new Set(banks.map(bank => bank.subject).filter((subject): subject is string => Boolean(subject)))).sort();
    const creators = Array.from(new Set(banks.map(bank => bank.creator_name).filter((creator): creator is string => Boolean(creator)))).sort();

    const filteredBanks = banks
        .filter(bank => accessFilter === 'all' || (accessFilter === 'mine' ? bank.isOwner : !!bank.collaborationPermission))
        .filter(bank => {
            const matchesTab = activeTab === 'all' || (activeTab === 'published' ? bank.is_published : !bank.is_published);
            const matchesSearch = bank.title.toLowerCase().includes(searchQuery.toLowerCase()) || (bank.subject || '').toLowerCase().includes(searchQuery.toLowerCase());
            const matchesTag = !activeTagFilter || bank.tags?.includes(activeTagFilter);
            const matchesSubject = !activeSubjectFilter || bank.subject === activeSubjectFilter;
            const matchesCreator = !activeCreatorFilter || bank.creator_name === activeCreatorFilter;
            const matchesClass = !activeClassFilter || bank.class_level === activeClassFilter;
            return matchesTab && matchesSearch && matchesTag && matchesSubject && matchesCreator && matchesClass;
        })
        .toSorted((a, b) => (b.created_at ? new Date(b.created_at).getTime() : 0) - (a.created_at ? new Date(a.created_at).getTime() : 0));

    const banksByFolder = (() => {
        const folderMap = new Map<string, QuestionBank[]>();
        const unfoldered: QuestionBank[] = [];
        // Bank di folder yang tidak terlihat (folder pribadi pengguna lain)
        // tetap tampil di akar, bukan hilang dari daftar.
        const visibleFolderIds = new Set(folders.map(folder => folder.id));
        for (const bank of filteredBanks) {
            if (bank.folder_id && visibleFolderIds.has(bank.folder_id)) {
                const entries = folderMap.get(bank.folder_id) || [];
                folderMap.set(bank.folder_id, [...entries, bank]);
            } else {
                unfoldered.push(bank);
            }
        }
        return { folderMap, unfoldered };
    })();
    const activeFolder = folders.find(folder => folder.id === activeFolderId) || null;
    const visibleBanks = activeFolder
        ? banksByFolder.folderMap.get(activeFolder.id) || []
        : banksByFolder.unfoldered;
    const hasBankFilters = Boolean(searchQuery.trim() || activeTagFilter || activeSubjectFilter || activeCreatorFilter || activeClassFilter || accessFilter !== 'all');

    useEffect(() => {
        const timer = window.setTimeout(() => setCurrentPage(1), 0);
        return () => window.clearTimeout(timer);
    }, [activeTab, searchQuery, activeTagFilter, activeSubjectFilter, activeCreatorFilter, activeClassFilter]);

    const totalPages = Math.max(1, Math.ceil(visibleBanks.length / PAGE_SIZE));
    const safePage = Math.min(currentPage, totalPages);
    const pagedBanks = visibleBanks.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
    const summaryBanks = activeFolder ? banks.filter(bank => bank.folder_id === activeFolder.id) : banks;
    const draftCount = summaryBanks.filter(bank => !bank.is_published).length;
    const publishedCount = summaryBanks.filter(bank => bank.is_published).length;
    const allCount = summaryBanks.length;

    const getLabelColor = (name: string) => labels.find(l => l.name === name)?.color || '#6366f1';

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    // Render bank card for desktop
    const renderBankCard = (bank: QuestionBank) => (
        <div key={bank.id} className="bank-library-card bg-white border border-[#3083FF]/30 rounded-lg p-4 flex items-center justify-between hover:border-[#3083FF] transition-all">
            <div className="flex items-center gap-4 min-w-0">
                <input
                    type="checkbox"
                    checked={selectedBankIds.has(bank.id)}
                    disabled={bank.canManage !== true}
                    onChange={() => toggleSelectBank(bank.id)}
                    className="bank-checkbox bg-transparent w-4 h-4 text-[#3083FF] border-[#3083FF]/30 rounded focus:ring-2 focus:ring-[#3083FF]/20 shrink-0 cursor-pointer"
                />
                <div className={`bank-library-cover w-12 h-12 rounded-lg overflow-hidden shrink-0 border flex items-center justify-center ${
                    bank.is_published
                        ? 'border-[#3083FF]/40 bg-[#3083FF]/10 text-[#3083FF]'
                        : 'border-red-200 bg-red-50 text-red-600'
                }`}>
                    <QuestionBankCover imageUrl={bank.image_url} title={bank.title} width={48} height={48} isPublished={bank.is_published} />
                </div>
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-lg text-xs font-semibold ${bank.is_published ? 'bg-[#3083FF]/10 text-[#3083FF] border border-[#3083FF]/30' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                            {bank.is_published ? 'Published' : 'Draft'}
                        </span>
                        <ValidationBadge summary={bank.validation_summary} />
                        {bank.subject && <span className="text-xs text-slate-400">{bank.subject}</span>}
                        {bank.class_level && <span className="text-xs text-slate-400">• {bank.class_level}</span>}
                    </div>
                    <h3 className="font-semibold text-slate-800 truncate">{bank.title}</h3>
                    <div className="flex items-center gap-2 text-xs text-slate-400 mt-1 flex-wrap">
                        <span>{bank.question_count || 0} soal</span>
                        {bank.created_at && <><span>•</span><span>{formatDate(bank.created_at)}</span></>}
                        <span>•</span><span>Oleh: {bank.creator_name}</span>
                        {bank.tags && bank.tags.length > 0 && bank.tags.map((tag: string) => (
                            <span
                                key={tag}
                                className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-sm text-[9px] font-bold text-white ml-1 leading-none"
                                style={{ backgroundColor: getLabelColor(tag) }}
                            >{tag}</span>
                        ))}
                    </div>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                {(bank.canShare || bank.collaborationPermission) && <CollaborationButton type="bank" resourceId={bank.id} collaboratorCount={bank.collaboratorCount} onChanged={() => void loadData()} />}
                <Button
                    size="sm"
                    variant={bank.is_published ? "warning" : "primary"}
                    disabled={bank.canManage !== true}
                    onClick={() => handleTogglePublish(bank)}
                >
                    {bank.is_published ? 'Unpublish' : 'Publish'}
                </Button>
                <Link href={`/dashboard/admin/questions/${bank.id}`}>
                    <Button size="sm" variant="secondary" rightIcon={<ArrowRight size={14} />}>
                        Lihat
                    </Button>
                </Link>
                <ActionButton
                    action="move"
                    iconOnly
                    tooltip="Pindah ke folder"
                    disabled={bank.canManage !== true}
                    onClick={() => handleOpenMoveBank(bank)}
                />
                <ActionButton
                    action="edit"
                    iconOnly
                    tooltip="Edit"
                    disabled={bank.canManage !== true}
                    onClick={() => handleOpenEdit(bank)}
                />
                <ActionButton
                    action="delete"
                    iconOnly
                    tooltip="Hapus"
                    disabled={bank.canDelete !== true}
                    onClick={() => { setBankToDelete(bank); setIsDeleteModalOpen(true); }}
                />
            </div>
        </div>
    );

    const renderMobileBankCard = (bank: QuestionBank) => (
        <div key={bank.id} className="bank-library-card bg-white border border-[#3083FF]/30 rounded-lg p-4 shadow-sm">
            <div className="flex items-start gap-3 mb-3">
                <input
                    type="checkbox"
                    checked={selectedBankIds.has(bank.id)}
                    disabled={bank.canManage !== true}
                    onChange={() => toggleSelectBank(bank.id)}
                    className="bank-checkbox bg-transparent w-4 h-4 text-[#3083FF] border-[#3083FF]/30 rounded focus:ring-2 focus:ring-[#3083FF]/20 shrink-0 cursor-pointer mt-0.5"
                />
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold ${bank.is_published ? 'bg-[#3083FF]/10 text-[#3083FF] border border-[#3083FF]/30' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                            {bank.is_published ? 'Published' : 'Draft'}
                        </span>
                        <ValidationBadge summary={bank.validation_summary} />
                        {bank.subject && <span className="text-xs text-slate-400">{bank.subject}</span>}
                        {bank.class_level && <span className="text-xs text-slate-400">• {bank.class_level}</span>}
                    </div>
                    <h3 className="font-semibold text-slate-800 text-sm leading-snug break-words">{bank.title}</h3>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                        <span>{bank.question_count || 0} soal</span>
                        {bank.created_at && <><span>•</span><span>{formatDate(bank.created_at)}</span></>}
                        <span>•</span><span>Oleh: {bank.creator_name}</span>
                        {bank.tags && bank.tags.length > 0 && bank.tags.map((tag: string) => (
                            <span
                                key={tag}
                                className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-sm text-[9px] font-bold text-white ml-1 leading-none"
                                style={{ backgroundColor: getLabelColor(tag) }}
                            >{tag}</span>
                        ))}
                    </div>
                </div>
            </div>
            <div className="bank-card-mobile-actions flex items-center gap-1.5">
                <Button
                    aria-label={bank.is_published ? 'Unpublish' : 'Publish'}
                    title={bank.is_published ? 'Unpublish' : 'Publish'}
                    leftIcon={bank.is_published ? <CloudOff size={15} /> : <CloudUpload size={15} />}
                    size="sm"
                    variant={bank.is_published ? "warning" : "primary"}
                    disabled={bank.canManage !== true}
                    onClick={() => handleTogglePublish(bank)}
                    className="bank-card-publish shrink-0"
                >
                    {bank.is_published ? 'Unpublish' : 'Publish'}
                </Button>
                <Link href={`/dashboard/admin/questions/${bank.id}`} className="shrink-0">
                    <Button mobileIconOnly aria-label="Lihat bank soal" title="Lihat bank soal" size="sm" variant="secondary" leftIcon={<Eye size={16} />} className="w-full">
                        Lihat
                    </Button>
                </Link>
                {(bank.canShare || bank.collaborationPermission) && <CollaborationButton mobileIconOnly className="shrink-0" type="bank" resourceId={bank.id} collaboratorCount={bank.collaboratorCount} onChanged={() => void loadData()} />}

                <Button mobileIconOnly aria-label="Edit bank soal" title="Edit bank soal" variant="outline" size="sm" leftIcon={<Edit3 size={16} />} disabled={bank.canManage !== true}
                    onClick={() => handleOpenEdit(bank)} />
                <Button mobileIconOnly aria-label="Hapus bank soal" title="Hapus bank soal" variant="danger" size="sm" leftIcon={<Trash2 size={16} />} disabled={bank.canDelete !== true}
                    onClick={() => { setBankToDelete(bank); setIsDeleteModalOpen(true); }} />
            </div>
        </div>
    );

    return (
        <div className="bank-library max-w-7xl mx-auto pb-24">

            {/* ── Hero Header — Navy Gradient ── */}
            {/* ── Stats Grid ── */}
            <div className="grid grid-cols-3 gap-x-2 mb-6">
                <div className="bg-white rounded-lg border border-[#3083FF]/30 text-center px-4 py-3">
                    <p className="text-2xl font-bold text-[#3083FF]">{allCount}</p>
                    <p className="text-xs text-slate-500">Total</p>
                </div>
                <div className="bg-white rounded-lg border border-[#3083FF]/30 text-center px-4 py-3">
                    <p className="text-2xl font-bold text-[#3083FF]">{draftCount}</p>
                    <p className="text-xs text-red-400 font-medium">Draft</p>
                </div>
                <div className="bg-white rounded-lg border border-[#3083FF]/30 text-center px-4 py-3">
                    <p className="text-2xl font-bold text-[#3083FF]">{publishedCount}</p>
                    <p className="text-xs text-slate-500">Published</p>
                </div>
            </div>

            {/* Search, Filters, and Actions Toolbar */}
            <div className="mb-6">
                <FilterToolbar actionsInline>
                    <FilterSelect label="Akses" value={accessFilter} onChange={value => { setAccessFilter(value || 'all'); setCurrentPage(1); }}
                        options={[{ value: 'all', label: 'Semua akses' }, { value: 'mine', label: 'Buatan saya' }, { value: 'shared', label: 'Dibagikan kepada saya' }]} />
                    <FilterSearch
                        value={searchQuery}
                        onChange={setSearchQuery}
                        placeholder="Cari bank soal..."
                    />

                    <FilterSelect
                        label="Label"
                        value={activeTagFilter || 'all'}
                        onChange={val => setActiveTagFilter(val === 'all' ? null : val)}
                        options={[
                            { value: 'all', label: 'Semua Label' },
                            ...labels.map(l => ({ value: l.name, label: l.name }))
                        ]}
                    />

                    <FilterSelect
                        label="Mata Pelajaran"
                        value={activeSubjectFilter || 'all'}
                        onChange={val => setActiveSubjectFilter(val === 'all' ? null : val)}
                        options={[
                            { value: 'all', label: 'Semua Mapel' },
                            ...subjects.map(s => ({ value: s, label: s }))
                        ]}
                    />

                    <FilterSelect
                        label="Pembuat"
                        value={activeCreatorFilter || 'all'}
                        onChange={val => setActiveCreatorFilter(val === 'all' ? null : val)}
                        options={[
                            { value: 'all', label: 'Semua Pembuat' },
                            ...creators.map(c => ({ value: c, label: c }))
                        ]}
                    />

                    <FilterSelect
                        label="Tingkat Kelas"
                        value={activeClassFilter || 'all'}
                        onChange={val => setActiveClassFilter(val === 'all' ? null : val)}
                        options={[
                            { value: 'all', label: 'Semua Kelas' },
                            ...CLASS_LEVELS.map(c => ({ value: c, label: c }))
                        ]}
                    />

                    <FilterActions>
                        {!activeFolder && <Button
                            variant="outline"
                            className="ftb-btn-icon-mobile rounded-full"
                            leftIcon={<Folder size={18} className="text-[#3083FF] dark:text-[#60a5fa]" />}
                            onClick={handleOpenCreateFolder}
                            title="Folder"
                            aria-label="Folder"
                        >
                            Folder
                        </Button>}
                        <Button
                            variant="primary"
                            icon="add"
                            className="hidden sm:inline-flex"
                            onClick={() => {
                                setEditingBank(null);
                                setTargetFolderId(activeFolder?.id);
                                setIsAddModalOpen(true);
                            }}
                        >
                            Buat Bank Soal
                        </Button>
                    </FilterActions>
                </FilterToolbar>
            </div>

            {activeFolder && (
                <nav aria-label="Lokasi bank soal" className="mb-4 flex flex-wrap items-center gap-2 text-sm">
                    <button type="button" onClick={closeFolder}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-semibold text-[#3083FF] hover:bg-[#3083FF]/10">
                        <ArrowLeft size={16} /> Semua Bank Soal
                    </button>
                    <ChevronRight size={15} className="text-slate-400" />
                    <span className="inline-flex items-center gap-2 font-semibold text-slate-700">
                        <Folder size={16} className="text-[#3083FF]" /> {activeFolder.name}
                    </span>
                </nav>
            )}

            {activeFolder && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#3083FF]/30 bg-[#3083FF]/5 px-4 py-3">
                    <span className="text-sm font-semibold text-slate-700">{activeFolder.name} <span className="font-normal text-slate-500">· {visibleBanks.length} bank soal</span></span>
                    <Button size="sm" variant="outline" leftIcon={<Plus size={15} />} onClick={() => handleOpenAddToFolder(activeFolder)}>
                        Tambah Bank yang Ada
                    </Button>
                </div>
            )}

            {/* Bulk Actions Panel */}
            {selectedBankIds.size > 0 && (
                <div className="bg-[#3083FF]/5 border border-[#3083FF]/30 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 bg-[#3083FF] rounded-full animate-pulse" />
                        <span className="text-xs font-bold text-[#3083FF] uppercase tracking-wider">{selectedBankIds.size} Bank Soal Terpilih</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <Button variant="outline" size="sm" onClick={handleSelectAll}>
                            Pilih Semua
                        </Button>
                        <Button variant="primary" size="sm" icon="folder" onClick={() => setIsBulkMoveModalOpen(true)}>
                            Pindahkan ke Folder
                        </Button>
                        <Button variant="cancel" size="sm" onClick={handleClearSelection} icon="cancel">
                            Batal
                        </Button>
                    </div>
                </div>
            )}

            {/* Mobile folder and bank list */}
            <div className="block md:hidden space-y-3">
                {isLoading ? (
                    <div className="flex justify-center py-12"><Spinner variant="buble" size={32} /></div>
                ) : !activeFolder && visibleBanks.length === 0 && folders.length === 0 ? (
                    <div className="py-12 text-center text-slate-400">
                        <BookOpen size={32} className="mx-auto mb-2 opacity-50" />
                        <p>Tidak ada bank soal</p>
                    </div>
                ) : (
                    <>
                        {!activeFolder && folders.map(folder => (
                            <button key={folder.id} type="button" onClick={() => openFolder(folder.id)}
                                className="flex w-full items-center gap-2 rounded-lg border border-[#3083FF]/30 bg-[#3083FF]/5 px-3 py-3 text-left hover:border-[#3083FF]">
                                <Folder size={18} className="shrink-0 text-[#3083FF]" />
                                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">{folder.name}</span>
                                <span className="text-xs text-slate-500">{(banksByFolder.folderMap.get(folder.id) || []).length}</span>
                                <ChevronRight size={16} className="shrink-0 text-slate-500" />
                            </button>
                        ))}
                        {!activeFolder && pagedBanks.length > 0 && <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bank Soal Tanpa Folder</p>}
                        {activeFolder && pagedBanks.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">{hasBankFilters ? 'Tidak ada bank soal yang cocok di folder ini.' : 'Folder ini belum berisi bank soal.'}</p>}
                        {pagedBanks.map(renderMobileBankCard)}
                    </>
                )}
                <ListPagination page={safePage} totalItems={visibleBanks.length} pageSize={PAGE_SIZE} onPageChange={setCurrentPage} />
            </div>

            {/* Desktop List View - with folder support */}
            <div className="hidden md:block space-y-3">
                {isLoading ? (
                    <div className="flex justify-center py-16">
                        <Spinner variant="buble" size={32} />
                    </div>
                ) : !activeFolder && visibleBanks.length === 0 && folders.length === 0 ? (
                    <div className="py-16 text-center text-slate-400">
                        <BookOpen size={32} className="mx-auto mb-2 opacity-50" />
                        <p>Tidak ada bank soal</p>
                    </div>
                ) : (
                    <>
                        {/* Folder yang terlihat sudah disaring server: milik sendiri, folder publik, atau semua folder bagi Admin. */}
                        {!activeFolder && folders.map(folder => {
                            const folderBanks = banksByFolder.folderMap.get(folder.id) || [];
                            const movableBanks = folderBanks.filter(bank => bank.canManage === true);
                            return (
                                <div key={folder.id} className="bank-folder-group">
                                    {/* Folder header */}
                                    <div className="bank-folder-row flex items-center gap-2 px-4 py-3 bg-[#3083FF]/5 border border-[#3083FF]/30 rounded-lg mb-2">
                                        <input
                                            type="checkbox"
                                            aria-label={`Pilih semua bank soal di folder ${folder.name}`}
                                            disabled={movableBanks.length === 0}
                                            checked={movableBanks.length > 0 && movableBanks.every(b => selectedBankIds.has(b.id))}
                                            onChange={() => toggleSelectAllInFolder(folderBanks)}
                                            className="bank-checkbox bg-transparent w-4 h-4 text-[#3083FF] border-[#3083FF]/30 rounded focus:ring-2 focus:ring-[#3083FF]/20 cursor-pointer shrink-0"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => openFolder(folder.id)}
                                            className="bank-folder-toggle flex items-center gap-2 flex-1 min-w-0 text-left hover:text-[#3083FF] transition-all"
                                        >
                                            <ChevronRight size={16} className="text-slate-400" />
                                            <Folder size={16} className="text-[#3083FF]" />
                                            <span className="bank-folder-identity">
                                                <span className="bank-folder-title">
                                                    <span className="font-semibold text-slate-700">{folder.name}</span>
                                                    <span className="text-xs text-slate-400">({folderBanks.length})</span>
                                                </span>
                                                <span className="bank-folder-meta">
                                                    {folder.is_public ? (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200" title="Terlihat oleh semua guru dan proktor">
                                                            <Globe size={10} /> Publik
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500 border border-slate-200" title="Hanya terlihat oleh pembuat dan Admin">
                                                            <Lock size={10} /> Pribadi
                                                        </span>
                                                    )}
                                                    {!folder.isOwner && folder.creator_name && (
                                                        <span className="text-[10px] text-slate-400">oleh {folder.creator_name}</span>
                                                    )}
                                                </span>
                                            </span>
                                        </button>
                                        <div className="relative" ref={folderMenuId === folder.id ? folderMenuRef : undefined}>
                                            <button
                                                aria-label={`Menu folder ${folder.name}`}
                                                aria-expanded={folderMenuId === folder.id}
                                                onClick={() => setFolderMenuId(folderMenuId === folder.id ? null : folder.id)}
                                                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-all"
                                            >
                                                <MoreHorizontal size={14} />
                                            </button>
                                            {folderMenuId === folder.id && (
                                                <div className="bank-folder-menu absolute right-0 top-full mt-1 bg-white border border-[#3083FF]/30 rounded-lg shadow-lg py-1 z-20 min-w-[160px]">
                                                    <div className="bank-folder-menu__heading px-3 py-1 text-[10px] text-slate-400 font-medium uppercase">Tambah Bank Soal</div>
                                                    <button
                                                        onClick={() => {
                                                            setEditingBank(null);
                                                            setTargetFolderId(folder.id);
                                                            setIsAddModalOpen(true);
                                                            setFolderMenuId(null);
                                                        }}
                                                        className="w-full text-left px-3 py-2 text-xs text-slate-600 hover:bg-[#3083FF]/5 flex items-center gap-2"
                                                    >
                                                        <Plus size={12} /> Buat Baru
                                                    </button>
                                                    <button
                                                        onClick={() => handleOpenAddToFolder(folder)}
                                                        className="w-full text-left px-3 py-2 text-xs text-slate-600 hover:bg-[#3083FF]/5 flex items-center gap-2"
                                                    >
                                                        <BookOpen size={12} /> Pilih Existing
                                                    </button>
                                                    {folderBanks.length > 0 && (
                                                        <>
                                                            <div className="bank-folder-menu__separator border-t border-[#3083FF]/20 my-1"></div>
                                                            <button
                                                                onClick={() => {
                                                                    setBulkMode(true);
                                                                    setSelectedBankIds(new Set());
                                                                    openFolder(folder.id);
                                                                    setFolderMenuId(null);
                                                                }}
                                                                className="w-full text-left px-3 py-2 text-xs text-slate-600 hover:bg-[#3083FF]/5 flex items-center gap-2"
                                                            >
                                                                <Check size={12} /> Pindahkan
                                                            </button>
                                                        </>
                                                    )}
                                                    {/* Ganti nama/visibilitas dan hapus: hanya pembuat folder atau Admin. */}
                                                    {folder.canManage === true && (
                                                        <>
                                                            <div className="bank-folder-menu__separator border-t border-[#3083FF]/20 my-1"></div>
                                                            <button
                                                                onClick={() => handleOpenEditFolder(folder)}
                                                                className="w-full text-left px-3 py-2 text-xs text-slate-600 hover:bg-[#3083FF]/5 flex items-center gap-2"
                                                            >
                                                                <Edit3 size={12} /> Edit Folder
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteFolder(folder)}
                                                                disabled={folder.canDelete !== true || isSubmitting}
                                                                title={folder.canDelete !== true ? 'Pindahkan semua bank soal keluar dari folder sebelum menghapusnya' : 'Hapus folder kosong'}
                                                                className="bank-folder-menu__danger w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-red-50 flex items-center gap-2"
                                                            >
                                                                <Trash2 size={12} /> Hapus Folder
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {/* Banks in the current Explorer location */}
                        {activeFolder && pagedBanks.length === 0 && (
                            <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500">
                                <Folder size={24} className="mx-auto mb-2 text-[#3083FF]/60" />
                                {hasBankFilters ? 'Tidak ada bank soal yang cocok di folder ini.' : 'Folder ini belum berisi bank soal.'}
                            </div>
                        )}
                        {pagedBanks.length > 0 && (
                            <div className="space-y-2">
                                {!activeFolder && <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bank Soal Tanpa Folder</p>}
                                {pagedBanks.map(bank => renderBankCard(bank))}
                            </div>
                        )}
                    </>
                )}

                {/* Pagination */}
                <ListPagination page={safePage} totalItems={visibleBanks.length} pageSize={PAGE_SIZE} onPageChange={setCurrentPage} />
            </div>

            {/* Folder Modal */}
            <Modal
                open={isFolderModalOpen}
                onClose={() => { setIsFolderModalOpen(false); setEditingFolder(null); }}
                size="sm"
                variant={editingFolder ? 'edit' : 'add'}
                title={editingFolder ? 'Edit Folder' : 'Buat Folder Baru'}
                subtitle={editingFolder ? 'Ubah nama dan visibilitas folder bank soal' : 'Kelompokkan bank soal dalam folder'}
                icon="folder"
            >
                <form onSubmit={handleSaveFolder}>
                    <ModalBody className="space-y-4">
                        <ModalField label="Nama Folder" required>
                            <input
                                required
                                type="text"
                                placeholder="Nama Folder"
                                value={newFolderName}
                                onChange={e => setNewFolderName(e.target.value)}
                                className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
                                autoFocus
                            />
                        </ModalField>
                        <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer hover:border-primary/40 transition-all">
                            <input
                                type="checkbox"
                                checked={newFolderPublic}
                                onChange={e => setNewFolderPublic(e.target.checked)}
                                className="bank-checkbox bg-transparent w-4 h-4 mt-0.5 text-[#3083FF] border-[#3083FF]/30 rounded focus:ring-2 focus:ring-[#3083FF]/20 shrink-0 cursor-pointer"
                            />
                            <span className="min-w-0">
                                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                                    <Globe size={14} className="text-emerald-600" /> Jadikan folder publik
                                </span>
                                <span className="block text-xs text-slate-500 mt-0.5">
                                    Folder publik terlihat oleh semua guru dan proktor. Jika tidak dicentang, folder hanya terlihat oleh Anda dan Admin.
                                </span>
                            </span>
                        </label>
                    </ModalBody>
                    <ModalFooter align="between">
                        <Button
                            type="button"
                            variant="cancel"
                            onClick={() => { setIsFolderModalOpen(false); setEditingFolder(null); }}
                            icon="cancel"
                        >
                            Batal
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            isLoading={isSubmitting}
                            icon="save"
                        >
                            {editingFolder ? 'Simpan' : 'Buat Folder'}
                        </Button>
                    </ModalFooter>
                </form>
            </Modal>

            {/* Move to Folder Modal */}
            <Modal
                open={isMoveModalOpen && !!bankToMove}
                onClose={() => { setIsMoveModalOpen(false); setBankToMove(null); }}
                size="sm"
                title="Pindahkan Bank Soal"
                subtitle={`Pilih folder tujuan untuk "${bankToMove?.title}"`}
                icon="folder"
            >
                <ModalBody className="space-y-2">
                    <button
                        type="button"
                        onClick={() => handleMoveBank(null)}
                        className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${!bankToMove?.folder_id ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 hover:border-primary/40'}`}
                    >
                        <div className="flex items-center gap-2">
                            <Folder size={14} /> Tanpa Folder
                        </div>
                    </button>
                    {folders.map(folder => (
                        <button
                            key={folder.id}
                            type="button"
                            onClick={() => handleMoveBank(folder.id)}
                            className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${bankToMove?.folder_id === folder.id ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 hover:border-primary/40'}`}
                        >
                            <div className="flex items-center gap-2">
                                <Folder size={14} /> {folder.name}
                            </div>
                        </button>
                    ))}
                    {folders.length === 0 && (
                        <p className="text-xs text-slate-400 text-center py-4">Belum ada folder. Buat folder terlebih dahulu.</p>
                    )}
                </ModalBody>
                <ModalFooter>
                    <Button
                        type="button"
                        variant="cancel"
                        onClick={() => { setIsMoveModalOpen(false); setBankToMove(null); }}
                        icon="cancel"
                    >
                        Batal
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Add Existing Banks to Folder Modal */}
            <Modal
                open={isAddToFolderModalOpen && !!targetFolder}
                onClose={() => setIsAddToFolderModalOpen(false)}
                size="md"
                title={`Tambah ke "${targetFolder?.name}"`}
                subtitle="Pilih bank soal untuk dimasukkan ke dalam folder ini"
                icon="folder-plus"
            >
                <ModalBody className="max-h-[60vh] overflow-y-auto space-y-2">
                    {banks.filter(b => !b.folder_id || b.folder_id !== targetFolder?.id).length === 0 ? (
                        <div className="text-center text-slate-400 py-8">
                            <BookOpen size={24} className="mx-auto mb-2 opacity-50" />
                            <p className="text-sm">Semua bank soal sudah ada di folder ini</p>
                            <p className="text-xs mt-1">atau belum ada bank soal</p>
                        </div>
                    ) : (
                        banks
                            .filter(b => !b.folder_id || b.folder_id !== targetFolder?.id)
                            .map(bank => (
                                <div
                                    key={bank.id}
                                    onClick={() => {
                                        setSelectedAddToFolderIds(prev => {
                                            const next = new Set(prev);
                                            if (next.has(bank.id)) next.delete(bank.id);
                                            else next.add(bank.id);
                                            return next;
                                        });
                                    }}
                                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${selectedAddToFolderIds.has(bank.id) ? 'border-primary bg-primary/5' : 'border-slate-200 hover:border-primary/40'}`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedAddToFolderIds.has(bank.id)}
                                        onChange={() => {}}
                                        className="bank-checkbox bg-transparent w-4 h-4 text-primary border-slate-300 rounded"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-slate-800 text-sm truncate">{bank.title}</p>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${bank.is_published ? 'bg-[#3083FF]/10 text-[#3083FF]' : 'bg-red-50 text-red-600'}`}>
                                                {bank.is_published ? 'Published' : 'Draft'}
                                            </span>
                                            <span className="text-xs text-slate-400">{bank.question_count || 0} soal</span>
                                            {bank.subject && <span className="text-xs text-slate-400">• {bank.subject}</span>}
                                            {bank.class_level && <span className="text-xs text-slate-400">• {bank.class_level}</span>}
                                        </div>
                                    </div>
                                </div>
                            ))
                    )}
                </ModalBody>
                <ModalFooter align="between">
                    <Button
                        type="button"
                        variant="cancel"
                        onClick={() => setIsAddToFolderModalOpen(false)}
                        icon="cancel"
                    >
                        Batal
                    </Button>
                    <Button
                        type="button"
                        variant="primary"
                        onClick={handleAddBanksToFolder}
                        disabled={selectedAddToFolderIds.size === 0 || isSubmitting}
                        isLoading={isSubmitting}
                        icon="add"
                    >
                        Tambah {selectedAddToFolderIds.size > 0 ? `(${selectedAddToFolderIds.size})` : ''}
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Bulk Move to Folder Modal */}
            <Modal
                open={isBulkMoveModalOpen}
                onClose={() => setIsBulkMoveModalOpen(false)}
                size="sm"
                title={`Pindahkan ${selectedBankIds.size} Bank Soal`}
                subtitle="Pilih folder tujuan untuk semua bank soal terpilih"
                icon="folder-symlink"
            >
                <ModalBody className="space-y-2">
                    <button
                        type="button"
                        onClick={() => handleBulkMove(null)}
                        className="w-full text-left px-4 py-3 rounded-xl border transition-all border-slate-200 hover:border-primary/40"
                    >
                        <div className="flex items-center gap-2">
                            <Folder size={14} /> Hapus dari Folder (Tanpa Folder)
                        </div>
                    </button>
                    {folders.map(folder => (
                        <button
                            key={folder.id}
                            type="button"
                            onClick={() => handleBulkMove(folder.id)}
                            className={`w-full text-left px-4 py-3 rounded-xl border transition-all border-slate-200 hover:border-primary/40`}
                        >
                            <div className="flex items-center gap-2">
                                <Folder size={14} /> {folder.name}
                            </div>
                        </button>
                    ))}
                    {folders.length === 0 && (
                        <p className="text-xs text-slate-400 text-center py-4">Belum ada folder. Buat folder terlebih dahulu.</p>
                    )}
                </ModalBody>
                <ModalFooter>
                    <Button
                        type="button"
                        variant="cancel"
                        onClick={() => setIsBulkMoveModalOpen(false)}
                        icon="cancel"
                    >
                        Batal
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Add/Edit Bank Soal Modal */}
            <CreateBankModal
                isOpen={isAddModalOpen}
                onClose={() => {
                    setIsAddModalOpen(false);
                    setEditingBank(null);
                    setTargetFolderId(undefined);
                }}
                onSuccess={loadData}
                editingBank={editingBank}
                defaultFolderId={targetFolderId}
                folders={folders}
                labels={labels}
                orgSubjects={orgSubjects}
                onLabelsUpdated={setLabels}
            />


            {/* Delete Modal */}
            <Modal
                open={isDeleteModalOpen && !!bankToDelete}
                onClose={() => { setIsDeleteModalOpen(false); setBankToDelete(null); }}
                size="sm"
                variant="delete"
                title="Hapus Bank Soal"
                subtitle="Tindakan ini permanen dan tidak dapat dibatalkan"
                icon="trash"
            >
                <ModalBody>
                    <p className="text-sm text-slate-600">
                        Yakin ingin menghapus <strong className="text-slate-900">&quot;{bankToDelete?.title}&quot;</strong> beserta seluruh soal di dalamnya?
                    </p>
                </ModalBody>
                <ModalFooter align="between">
                    <Button
                        type="button"
                        variant="cancel"
                        onClick={() => { setIsDeleteModalOpen(false); setBankToDelete(null); }}
                        icon="cancel"
                    >
                        Batal
                    </Button>
                    <Button
                        type="button"
                        variant="danger"
                        onClick={handleDeleteBank}
                        isLoading={isSubmitting}
                        icon="delete"
                    >
                        Hapus
                    </Button>
                </ModalFooter>
            </Modal>
        </div>
    );
}
