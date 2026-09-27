"use client";
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Plus, Search, BookOpen, Trash2, Edit3,
    ArrowRight, Loader2, X, Upload, Check, ChevronDown, Eye,
    FolderOpen, Folder, ChevronRight, MoreHorizontal, FolderPlus
} from 'lucide-react';
import { createQuestionBank, listQuestionBanks, deleteQuestionBank, toggleQuestionBankPublishAction, updateQuestionBankAction, listOrganizationLabels, listBankFolders, createBankFolder, updateBankFolder, deleteBankFolder, moveBankToFolder, bulkMoveBanksToFolder, createOrganizationLabel } from '@/lib/api/questions';
import { getProctorOrganization, isUserProctor, hasUserDualRole, listSubjects } from '@/lib/api/proctor';
import { getSessionUser } from '@/lib/session';
import { uploadToHosting } from '@/lib/uploader';
import Link from 'next/link';
import { useMemoryState } from '@/lib/useMemoryState';
import { Button } from '@/app/components/ui/button';
import { ActionButton } from '@/app/components/ui/actionbutton';
import { Modal, ModalHeader, ModalBody, ModalFooter, ModalField } from '@/app/components/ui/modal';
import { FilterToolbar, FilterSearch, FilterSelect, FilterActions } from '@/app/components/ui/filtertoolbar';
import { Spinner } from '@/app/components/ui/Spinner';

const AVAILABLE_ICONS = [
    { id: 'BookOpen', icon: BookOpen, label: 'Buku' },
    { id: 'Calculator', icon: BookOpen, label: 'Matematika' },
    { id: 'Languages', icon: BookOpen, label: 'Bahasa' },
    { id: 'Atom', icon: BookOpen, label: 'Sains' },
    { id: 'Globe', icon: BookOpen, label: 'Sosial' },
];

export default function GuruQuestionBankPage() {
    const [banks, setBanks] = useMemoryState<any[]>('guru_questions_banks', []);
    const [isLoading, setIsLoading] = useMemoryState('guru_questions_isLoading', true);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [bankToDelete, setBankToDelete] = useState<any>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [org, setOrg] = useState<any>(null);
    const [isProctor, setIsProctor] = useState(false);
    const [isDualRole, setIsDualRole] = useState(false);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);

    const [activeTab, setActiveTab] = useState<'all' | 'draft' | 'published'>('all');
    const [editingBank, setEditingBank] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [uploadingImage, setUploadingImage] = useState(false);
    const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
    const [activeSubjectFilter, setActiveSubjectFilter] = useState<string | null>(null);
    const [activeCreatorFilter, setActiveCreatorFilter] = useState<string | null>(null);
    const PAGE_SIZE = 20;
    const [currentPage, setCurrentPage] = useState(1);

    const [formData, setFormData] = useState({
        title: '', description: '', subject: '', classLevel: '',
        iconIdentifier: 'BookOpen', imageUrl: '', tags: [] as string[], folderId: undefined as string | undefined
    });
    const [labels, setLabels] = useMemoryState<any[]>('guru_questions_labels', []);
    const [orgSubjects, setOrgSubjects] = useMemoryState<any[]>('guru_questions_orgSubjects', []);
    const [newCustomLabel, setNewCustomLabel] = useState('');
    const [isLabelDropdownOpen, setIsLabelDropdownOpen] = useState(false);
    const [labelSearchQuery, setLabelSearchQuery] = useState('');
    const labelDropdownRef = useRef<HTMLDivElement>(null);

    const [isSubjectDropdownOpen, setIsSubjectDropdownOpen] = useState(false);
    const [subjectSearchQuery, setSubjectSearchQuery] = useState('');
    const subjectDropdownRef = useRef<HTMLDivElement>(null);

    const [isCreatorDropdownOpen, setIsCreatorDropdownOpen] = useState(false);
    const [creatorSearchQuery, setCreatorSearchQuery] = useState('');
    const creatorDropdownRef = useRef<HTMLDivElement>(null);

    const [activeClassFilter, setActiveClassFilter] = useState<string | null>(null);
    const [isClassDropdownOpen, setIsClassDropdownOpen] = useState(false);
    const [classSearchQuery, setClassSearchQuery] = useState('');
    const classDropdownRef = useRef<HTMLDivElement>(null);

    const CLASS_LEVELS = [
        "Kelas 10", "Kelas 11", "Kelas 12", "Umum"
    ];

    const handleSelectAll = () => {
        const allFilteredIds = filteredBanks.map(b => b.id);
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
    const [folders, setFolders] = useMemoryState<any[]>('guru_questions_folders', []);
    const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
    const [editingFolder, setEditingFolder] = useState<any>(null);
    const [newFolderName, setNewFolderName] = useState('');
    const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
    const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
    const [bankToMove, setBankToMove] = useState<any>(null);

    // Bulk selection state
    const [bulkMode, setBulkMode] = useState(false);
    const [selectedBankIds, setSelectedBankIds] = useState<Set<string>>(new Set());

    // Bulk move modal
    const [isBulkMoveModalOpen, setIsBulkMoveModalOpen] = useState(false);

    // Add to folder modal (select existing banks)
    const [isAddToFolderModalOpen, setIsAddToFolderModalOpen] = useState(false);
    const [targetFolder, setTargetFolder] = useState<any>(null);
    const [selectedAddToFolderIds, setSelectedAddToFolderIds] = useState<Set<string>>(new Set());

    useEffect(() => { loadData();
        // Auto-injected smart sync (Window Focus)
        const handleFocus = () => { if (typeof loadData === 'function') loadData(); };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus); }, []);

    const loadData = async () => {
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
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !org) return;
        setUploadingImage(true);
        try {
            const result = await uploadToHosting(file, 'banks', formData.imageUrl);
            if (result.success && result.url) {
                setFormData(prev => ({ ...prev, imageUrl: result.url || '', iconIdentifier: '' }));
            }
        } catch (error: any) { alert('Gagal upload: ' + error.message); }
        finally { setUploadingImage(false); }
    };

    const handleOpenEdit = (bank: any) => {
        setEditingBank(bank);
        setFormData({
            title: bank.title, description: bank.description || '',
            subject: bank.subject || '', classLevel: bank.class_level || '',
            iconIdentifier: bank.icon_identifier || 'BookOpen', imageUrl: bank.image_url || '',
            tags: bank.tags || [], folderId: bank.folder_id || undefined
        });
        setIsAddModalOpen(true);
    };

    const handleSaveBank = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!org) return;
        setIsSubmitting(true);
        try {
            const user = await getSessionUser();
            if (!user) return;

            let result: any;
            if (editingBank) {
                result = await updateQuestionBankAction(editingBank.id, {
                    title: formData.title, description: formData.description,
                    subject: formData.subject, classLevel: formData.classLevel,
                    iconIdentifier: formData.iconIdentifier, imageUrl: formData.imageUrl,
                    tags: formData.tags, folderId: formData.folderId
                });
            } else {
                result = await createQuestionBank({
                    title: formData.title,
                    description: formData.description,
                    subject: formData.subject,
                    classLevel: formData.classLevel,
                    iconIdentifier: formData.iconIdentifier,
                    imageUrl: formData.imageUrl,
                    tags: formData.tags,
                    folderId: formData.folderId,
                });
            }

            if (result.success) {
                setIsAddModalOpen(false);
                setEditingBank(null);
                setFormData({ title: '', description: '', subject: '', classLevel: '', iconIdentifier: 'BookOpen', imageUrl: '', tags: [], folderId: undefined });
                await loadData();
            } else { alert('Gagal: ' + result.error); }
        } catch (err: any) { alert('Error: ' + err.message); }
        finally { setIsSubmitting(false); }
    };

    const handleDeleteBank = async () => {
        if (!bankToDelete || !org) return;
        setIsSubmitting(true);
        try {
            const result = await deleteQuestionBank(bankToDelete.id);
            if (result.success) { setIsDeleteModalOpen(false); setBankToDelete(null); await loadData(); }
            else { alert('Gagal: ' + result.error); }
        } catch (err) { alert('Error.'); }
        finally { setIsSubmitting(false); }
    };

    const handleTogglePublish = async (bank: any) => {
        if (!org) return;
        const newStatus = !bank.is_published;
        const result = await toggleQuestionBankPublishAction(bank.id, newStatus);
        if (result.success) await loadData();
        else alert('Gagal: ' + result.error);
    };

    const toggleTag = (tag: string) => {
        setFormData(prev => ({
            ...prev,
            tags: prev.tags.includes(tag)
                ? prev.tags.filter(t => t !== tag)
                : [...prev.tags, tag]
        }));
    };

    const handleCreateCustomLabel = async () => {
        if (!newCustomLabel.trim() || !org) return;
        
        const labelName = newCustomLabel.trim();
        const existingLabel = labels.find(l => l.name.toLowerCase() === labelName.toLowerCase());
        
        if (existingLabel) {
            if (!formData.tags.includes(existingLabel.name)) {
                setFormData(prev => ({ ...prev, tags: [...prev.tags, existingLabel.name] }));
            }
            setNewCustomLabel('');
            return;
        }

        const colors = ['#6366f1', '#ec4899', '#f43f5e', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#06b6d4'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        try {
            const result = await createOrganizationLabel(labelName, randomColor);
            if (result.success) {
                const labelList = await listOrganizationLabels();
                setLabels(labelList || []);
                setFormData(prev => ({ ...prev, tags: [...prev.tags, labelName] }));
                setNewCustomLabel('');
            } else {
                alert('Gagal membuat label: ' + result.error);
            }
        } catch (err: any) {
            alert('Error: ' + err.message);
        }
    };

    // Folder actions
    const handleOpenCreateFolder = () => {
        setNewFolderName('');
        setEditingFolder(null);
        setIsFolderModalOpen(true);
    };

    const handleOpenEditFolder = (folder: any) => {
        setNewFolderName(folder.name);
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

            let result: any;
            if (editingFolder) {
                result = await updateBankFolder(editingFolder.id, newFolderName);
            } else {
                result = await createBankFolder(newFolderName);
            }

            if (result.success) {
                setIsFolderModalOpen(false);
                setNewFolderName('');
                setEditingFolder(null);
                await loadData();
            } else { alert('Gagal: ' + result.error); }
        } catch (err: any) { alert('Error: ' + err.message); }
        finally { setIsSubmitting(false); }
    };

    const handleDeleteFolder = async (folder: any) => {
        if (!org) return;
        setIsSubmitting(true);
        try {
            const result = await deleteBankFolder(folder.id);
            if (result.success) {
                setFolderMenuId(null);
                await loadData();
            } else { alert('Gagal: ' + result.error); }
        } catch (err: any) { alert('Error: ' + err.message); }
        finally { setIsSubmitting(false); }
    };

    const handleOpenAddToFolder = (folder: any) => {
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
        } catch (err: any) { alert('Error: ' + err.message); }
        finally { setIsSubmitting(false); }
    };

    const handleOpenMoveBank = (bank: any) => {
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
        } catch (err: any) { alert('Error: ' + err.message); }
        finally { setIsSubmitting(false); }
    };

    // Bulk selection functions
    const toggleBulkMode = () => {
        setBulkMode(prev => !prev);
        if (bulkMode) {
            setSelectedBankIds(new Set());
        }
    };

    const toggleSelectBank = (bankId: string) => {
        setSelectedBankIds(prev => {
            const next = new Set(prev);
            if (next.has(bankId)) next.delete(bankId);
            else next.add(bankId);
            return next;
        });
    };

    const toggleSelectAllInFolder = (folderBanks: any[]) => {
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

    const toggleSelectAllUnfoldered = () => {
        const allSelected = banksByFolder.unfoldered.every(b => selectedBankIds.has(b.id));
        setSelectedBankIds(prev => {
            const next = new Set(prev);
            if (allSelected) {
                banksByFolder.unfoldered.forEach(b => next.delete(b.id));
            } else {
                banksByFolder.unfoldered.forEach(b => next.add(b.id));
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
        } catch (err: any) { alert('Error: ' + err.message); }
        finally { setIsSubmitting(false); }
    };

    const toggleFolderExpand = (folderId: string) => {
        setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(folderId)) next.delete(folderId);
            else next.add(folderId);
            return next;
        });
    };

    const subjects = useMemo(() => {
        const set = new Set<string>();
        banks.forEach(b => { if (b.subject) set.add(b.subject); });
        return Array.from(set).sort();
    }, [banks]);

    const creators = useMemo(() => {
        const set = new Set<string>();
        banks.forEach(b => { set.add(b.creator_name); });
        return Array.from(set).sort();
    }, [banks]);

    const filteredBanks = useMemo(() => {
        let filtered = banks.filter(bank => {
            const matchesTab = activeTab === 'all' ? true : (activeTab === 'published' ? bank.is_published : !bank.is_published);
            const matchesSearch = (bank.title || '').toLowerCase().includes(searchQuery.toLowerCase()) || (bank.subject || '').toLowerCase().includes(searchQuery.toLowerCase());
            const matchesTag = !activeTagFilter || (bank.tags && bank.tags.includes(activeTagFilter));
            const matchesSubject = !activeSubjectFilter || bank.subject === activeSubjectFilter;
            const matchesCreator = !activeCreatorFilter || (bank.creator_name) === activeCreatorFilter;
            const matchesClass = !activeClassFilter || bank.class_level === activeClassFilter;
            return matchesTab && matchesSearch && matchesTag && matchesSubject && matchesCreator && matchesClass;
        });

        // Sort: newest to oldest by created_at
        filtered.sort((a, b) => {
            const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
            const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
            return dateB - dateA;
        });

        return filtered;
    }, [banks, searchQuery, activeTab, activeTagFilter, activeSubjectFilter, activeCreatorFilter, activeClassFilter]);

    // Group banks by folder - handles dual role logic
    const banksByFolder = useMemo(() => {
        const folderMap = new Map<string, any[]>();
        let unfoldered: any[] = [];

        for (const bank of filteredBanks) {
            // In the Proktor dashboard, if a bank has a folder_id, it should ALWAYS appear in that folder.
            if (isProctor && bank.folder_id) {
                if (!folderMap.has(bank.folder_id)) {
                    folderMap.set(bank.folder_id, []);
                }
                folderMap.get(bank.folder_id)!.push(bank);
            } else {
                unfoldered.push(bank);
            }
        }

        return { folderMap, unfoldered };
    }, [filteredBanks, folders, isProctor]);

    // Reset page when filters change
    useEffect(() => { setCurrentPage(1); }, [activeTab, searchQuery, activeTagFilter, activeSubjectFilter, activeCreatorFilter, activeClassFilter]);

    const totalPages = Math.max(1, Math.ceil(filteredBanks.length / PAGE_SIZE));
    const safePage = Math.min(currentPage, totalPages);
    const paginatedBanks = useMemo(() => {
        const start = (safePage - 1) * PAGE_SIZE;
        return filteredBanks.slice(start, start + PAGE_SIZE);
    }, [filteredBanks, safePage]);

    const draftCount = useMemo(() => banks.filter(b => !b.is_published).length, [banks]);
    const publishedCount = useMemo(() => banks.filter(b => b.is_published).length, [banks]);
    const allCount = useMemo(() => banks.length, [banks]);

    const getLabelColor = (name: string) => labels.find(l => l.name === name)?.color || '#6366f1';

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    // Render bank card for desktop
    const renderBankCard = (bank: any) => (
        <div key={bank.id} className="bg-white border border-[#3083FF]/30 rounded-lg p-4 flex items-center justify-between hover:border-[#3083FF] transition-all">
            <div className="flex items-center gap-4 min-w-0">
                <input
                    type="checkbox"
                    checked={selectedBankIds.has(bank.id)}
                    onChange={() => toggleSelectBank(bank.id)}
                    className="w-4 h-4 text-[#3083FF] border-[#3083FF]/30 rounded focus:ring-2 focus:ring-[#3083FF]/20 shrink-0 cursor-pointer"
                />
                <div className="w-12 h-12 bg-[#3083FF]/10 rounded-lg flex items-center justify-center shrink-0 border border-[#3083FF]/40">
                    <BookOpen size={20} className="text-[#3083FF]" />
                </div>
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-lg text-xs font-semibold ${bank.is_published ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-[#3083FF]/10 text-[#3083FF] border border-[#3083FF]/30'}`}>
                            {bank.is_published ? 'Published' : 'Draft'}
                        </span>
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
            <div className="flex items-center gap-1.5 shrink-0">
                <Button
                    size="sm"
                    variant={bank.is_published ? "outline" : "primary"}
                    onClick={() => handleTogglePublish(bank)}
                >
                    {bank.is_published ? 'Unpublish' : 'Publish'}
                </Button>
                <Link href={`/dashboard/guru/questions/${bank.id}`}>
                    <Button size="sm" variant="secondary" rightIcon={<ArrowRight size={14} />}>
                        Lihat
                    </Button>
                </Link>
                <ActionButton
                    action="move"
                    iconOnly
                    tooltip="Pindah ke folder"
                    onClick={() => handleOpenMoveBank(bank)}
                />
                <ActionButton
                    action="edit"
                    iconOnly
                    tooltip="Edit"
                    onClick={() => handleOpenEdit(bank)}
                />
                <ActionButton
                    action="delete"
                    iconOnly
                    tooltip="Hapus"
                    onClick={() => { setBankToDelete(bank); setIsDeleteModalOpen(true); }}
                />
            </div>
        </div>
    );

    return (
        <div className="max-w-7xl mx-auto pb-24">

            {/* ── Hero Header — Navy Gradient ── */}
            {/* ── Stats Grid ── */}
            <div className="grid grid-cols-3 gap-x-2 mb-6">
                <div className="bg-white rounded-lg border border-[#3083FF]/30 text-center px-4 py-3">
                    <p className="text-2xl font-bold text-[#3083FF]">{allCount}</p>
                    <p className="text-xs text-slate-500">Total</p>
                </div>
                <div className="bg-white rounded-lg border border-[#3083FF]/30 text-center px-4 py-3">
                    <p className="text-2xl font-bold text-[#3083FF]">{draftCount}</p>
                    <p className="text-xs text-slate-500">Draft</p>
                </div>
                <div className="bg-white rounded-lg border border-[#3083FF]/30 text-center px-4 py-3">
                    <p className="text-2xl font-bold text-[#3083FF]">{publishedCount}</p>
                    <p className="text-xs text-slate-500">Published</p>
                </div>
            </div>

            {/* Search, Filters, and Actions Toolbar */}
            <div className="mb-6">
                <FilterToolbar>
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
                        label="Kelas"
                        value={activeClassFilter || 'all'}
                        onChange={val => setActiveClassFilter(val === 'all' ? null : val)}
                        options={[
                            { value: 'all', label: 'Semua Kelas' },
                            ...CLASS_LEVELS.map(c => ({ value: c, label: c }))
                        ]}
                    />

                    <FilterActions>
                        {isProctor && (
                            <Button
                                variant="secondary"
                                onClick={handleOpenCreateFolder}
                                leftIcon={<FolderPlus size={15} />}
                            >
                                Folder
                            </Button>
                        )}
                        <Button
                            variant="primary"
                            onClick={() => setIsAddModalOpen(true)}
                            icon="add"
                        >
                            Buat Bank Soal
                        </Button>
                    </FilterActions>
                </FilterToolbar>
            </div>

            {/* Bulk Actions Panel */}
            {selectedBankIds.size > 0 && (
                <div className="bg-[#3083FF]/5 border border-[#3083FF]/30 rounded-xl p-3.5 flex items-center justify-between mb-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                        <span className="text-xs font-bold text-[#3083FF] uppercase tracking-wider">{selectedBankIds.size} Bank Soal Terpilih</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button size="sm" variant="secondary" onClick={handleSelectAll}>
                            Pilih Semua
                        </Button>
                        <Button size="sm" variant="primary" onClick={() => setIsBulkMoveModalOpen(true)} leftIcon={<FolderOpen size={13} />}>
                            Pindahkan ke Folder
                        </Button>
                        <Button size="sm" variant="cancel" onClick={handleClearSelection} icon="cancel">
                            Batal
                        </Button>
                    </div>
                </div>
            )}

            {/* Mobile Card View */}
            <div className="block md:hidden space-y-3">
                {isLoading ? (
                    <div className="flex justify-center py-12">
                        <Spinner variant="buble" size={32} />
                    </div>
                ) : filteredBanks.length === 0 ? (
                    <div className="py-12 text-center text-slate-400">
                        <BookOpen size={32} className="mx-auto mb-2 opacity-50" />
                        <p>Tidak ada bank soal</p>
                    </div>
                ) : (
                    paginatedBanks.map((bank) => (
                        <div key={bank.id} className="bg-white border border-[#3083FF]/30 rounded-lg p-4 shadow-sm">
                            <div className="flex items-center gap-3 mb-3">
                                <input
                                    type="checkbox"
                                    checked={selectedBankIds.has(bank.id)}
                                    onChange={() => toggleSelectBank(bank.id)}
                                    className="w-4 h-4 text-[#3083FF] border-[#3083FF]/30 rounded focus:ring-2 focus:ring-[#3083FF]/20 shrink-0 cursor-pointer"
                                />
                                <div className="w-12 h-12 bg-[#3083FF]/10 rounded-lg flex items-center justify-center shrink-0 border border-[#3083FF]/40">
                                    <BookOpen size={20} className="text-[#3083FF]" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-2 mb-1">
                                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold ${bank.is_published ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-[#3083FF]/10 text-[#3083FF] border border-[#3083FF]/30'}`}>
                                            {bank.is_published ? 'Published' : 'Draft'}
                                        </span>
                                        {bank.subject && <span className="text-xs text-slate-400">{bank.subject}</span>}
                                        {bank.class_level && <span className="text-xs text-slate-400">• {bank.class_level}</span>}
                                    </div>
                                    <h3 className="font-semibold text-slate-800 truncate text-sm">{bank.title}</h3>
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
                            <div className="flex items-center gap-2">
                                <Button
                                    size="sm"
                                    variant={bank.is_published ? "outline" : "primary"}
                                    onClick={() => handleTogglePublish(bank)}
                                    className="flex-1"
                                >
                                    {bank.is_published ? 'Unpublish' : 'Publish'}
                                </Button>
                                <Link href={`/dashboard/guru/questions/${bank.id}`} className="flex-1">
                                    <Button size="sm" variant="secondary" rightIcon={<ArrowRight size={14} />} className="w-full">
                                        Lihat
                                    </Button>
                                </Link>
                                <ActionButton action="edit" iconOnly tooltip="Edit" onClick={() => handleOpenEdit(bank)} />
                                <ActionButton action="delete" iconOnly tooltip="Hapus" onClick={() => { setBankToDelete(bank); setIsDeleteModalOpen(true); }} />
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Desktop List View - with folder support */}
            <div className="hidden md:block space-y-3">
                {isLoading ? (
                    <div className="flex justify-center py-16">
                        <Spinner variant="buble" size={32} />
                    </div>
                ) : filteredBanks.length === 0 ? (
                    <div className="py-16 text-center text-slate-400">
                        <BookOpen size={32} className="mx-auto mb-2 opacity-50" />
                        <p>Tidak ada bank soal</p>
                    </div>
                ) : (
                    <>
                        {/* Render folders with their banks - ONLY FOR PROCTOR */}
                        {/* For dual role: show only folders with banks added by others */}
                        {isProctor && folders
                            .filter(folder => {
                                // For dual role users, only show folders that have banks NOT created by them
                                // For pure proctors, show all folders
                                if (isDualRole) {
                                    return banksByFolder.folderMap.has(folder.id) && banksByFolder.folderMap.get(folder.id)!.length > 0;
                                }
                                return true;
                            })
                            .map(folder => {
                            const folderBanks = banksByFolder.folderMap.get(folder.id) || [];
                            const isExpanded = expandedFolders.has(folder.id);
                            return (
                                <div key={folder.id}>
                                    {/* Folder header */}
                                    <div className="flex items-center gap-2 px-4 py-3 bg-[#3083FF]/5 border border-[#3083FF]/30 rounded-lg mb-2">
                                        <button
                                            onClick={() => toggleFolderExpand(folder.id)}
                                            className="flex items-center gap-2 flex-1 hover:text-[#3083FF] transition-all"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={folderBanks.length > 0 && folderBanks.every(b => selectedBankIds.has(b.id))}
                                                onChange={() => toggleSelectAllInFolder(folderBanks)}
                                                onClick={(e) => e.stopPropagation()}
                                                className="w-4 h-4 text-[#3083FF] border-[#3083FF]/30 rounded focus:ring-2 focus:ring-[#3083FF]/20 cursor-pointer shrink-0"
                                            />
                                            {isExpanded ? <ChevronRight size={16} className="text-slate-400 rotate-90" /> : <ChevronRight size={16} className="text-slate-400" />}
                                            <Folder size={16} className="text-[#3083FF]" />
                                            <span className="font-semibold text-slate-700">{folder.name}</span>
                                            <span className="text-xs text-slate-400">({folderBanks.length})</span>
                                        </button>
                                        <div className="relative">
                                            {isProctor && (
                                                <button
                                                    onClick={() => setFolderMenuId(folderMenuId === folder.id ? null : folder.id)}
                                                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-all"
                                                >
                                                    <MoreHorizontal size={14} />
                                                </button>
                                            )}
                                            {folderMenuId === folder.id && (
                                                <div className="absolute right-0 top-full mt-1 bg-white border border-[#3083FF]/30 rounded-lg shadow-lg py-1 z-20 min-w-[160px]">
                                                    <div className="px-3 py-1 text-[10px] text-slate-400 font-medium uppercase">Tambah Bank Soal</div>
                                                    <button
                                                        onClick={() => {
                                                            setEditingBank(null);
                                                            setFormData({
                                                                title: '', description: '', subject: '',
                                                                classLevel: '', iconIdentifier: 'BookOpen',
                                                                imageUrl: '', tags: [], folderId: folder.id
                                                            });
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
                                                            <div className="border-t border-[#3083FF]/20 my-1"></div>
                                                            <button
                                                                onClick={() => {
                                                                    setBulkMode(true);
                                                                    setSelectedBankIds(new Set());
                                                                    setExpandedFolders(prev => new Set([...prev, folder.id]));
                                                                    setFolderMenuId(null);
                                                                }}
                                                                className="w-full text-left px-3 py-2 text-xs text-slate-600 hover:bg-[#3083FF]/5 flex items-center gap-2"
                                                            >
                                                                <Check size={12} /> Pindahkan
                                                            </button>
                                                        </>
                                                    )}
                                                    <div className="border-t border-[#3083FF]/20 my-1"></div>
                                                    <button
                                                        onClick={() => handleOpenEditFolder(folder)}
                                                        className="w-full text-left px-3 py-2 text-xs text-slate-600 hover:bg-[#3083FF]/5 flex items-center gap-2"
                                                    >
                                                        <Edit3 size={12} /> Edit Nama
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteFolder(folder)}
                                                        className="w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-red-50 flex items-center gap-2"
                                                    >
                                                        <Trash2 size={12} /> Hapus Folder
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    {/* Folder banks */}
                                    {isExpanded && folderBanks.length > 0 && (
                                        <div className="pl-6 space-y-2">
                                            {folderBanks.map(bank => renderBankCard(bank))}
                                        </div>
                                    )}
                                    {isExpanded && folderBanks.length === 0 && (
                                        <div className="pl-6 py-4">
                                            <div className="text-center text-slate-400 text-sm mb-3">
                                                <Folder size={20} className="mx-auto mb-1 opacity-50" />
                                                Folder kosong
                                            </div>
                                            <button
                                                onClick={() => {
                                                    setEditingBank(null);
                                                    setFormData({
                                                        title: '', description: '', subject: '',
                                                        classLevel: '', iconIdentifier: 'BookOpen',
                                                        imageUrl: '', tags: [], folderId: folder.id
                                                    });
                                                    setIsAddModalOpen(true);
                                                }}
                                                className="w-full py-2 border border-dashed border-[#3083FF]/30 rounded-lg text-xs text-slate-500 hover:border-[#3083FF] hover:text-[#3083FF] transition-all flex items-center justify-center gap-1"
                                            >
                                                <Plus size={12} /> Tambah Bank Soal
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {/* Unfoldered banks */}
                        {banksByFolder.unfoldered.length > 0 && (
                            <div className="space-y-2">
                                {banksByFolder.unfoldered.map(bank => renderBankCard(bank))}
                            </div>
                        )}
                    </>
                )}

                {/* Pagination */}
                {filteredBanks.length > PAGE_SIZE && (
                    <div className="flex items-center justify-between pt-3">
                        <p className="text-xs text-slate-400">
                            Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredBanks.length)} of {filteredBanks.length}
                        </p>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={safePage === 1}
                                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                            >
                                <ChevronDown size={14} className="rotate-90" />
                            </button>
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                                <button
                                    key={page}
                                    onClick={() => setCurrentPage(page)}
                                    className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${safePage === page ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                                >
                                    {page}
                                </button>
                            ))}
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={safePage === totalPages}
                                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                            >
                                <ChevronDown size={14} className="-rotate-90" />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Folder Modal */}
            <Modal
                open={isFolderModalOpen}
                onClose={() => { setIsFolderModalOpen(false); setEditingFolder(null); }}
                size="sm"
                variant={editingFolder ? 'edit' : 'add'}
                title={editingFolder ? 'Edit Folder' : 'Buat Folder Baru'}
                subtitle={editingFolder ? 'Ubah nama folder bank soal' : 'Kelompokkan bank soal dalam folder'}
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
                                        className="w-4 h-4 text-primary border-slate-300 rounded"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-slate-800 text-sm truncate">{bank.title}</p>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${bank.is_published ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
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

            {/* Add/Edit Modal */}
            <Modal
                open={isAddModalOpen}
                onClose={() => { setIsAddModalOpen(false); setEditingBank(null); }}
                size="md"
                variant={editingBank ? 'edit' : 'add'}
                title={editingBank ? 'Edit Bank Soal' : 'Buat Bank Soal Baru'}
                subtitle={editingBank ? 'Perbarui informasi bank soal' : 'Isi formulir untuk membuat paket bank soal baru'}
                icon={editingBank ? 'pencil-square' : 'journal-plus'}
            >
                <form onSubmit={handleSaveBank}>
                    <ModalBody className="space-y-4 max-h-[70vh] overflow-y-auto">
                        <ModalField label="Judul Bank Soal" required>
                            <input
                                required
                                type="text"
                                placeholder="Judul Bank Soal"
                                value={formData.title}
                                onChange={e => setFormData({ ...formData, title: e.target.value })}
                                className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
                            />
                        </ModalField>
                        <ModalField label="Mata Pelajaran">
                            <input
                                type="text"
                                list="subject-suggestions"
                                placeholder="Ketik nama mapel..."
                                value={formData.subject}
                                onChange={e => setFormData({ ...formData, subject: e.target.value })}
                                className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
                            />
                            <datalist id="subject-suggestions">
                                {orgSubjects.map((sub, idx) => (
                                    <option key={idx} value={sub.name} />
                                ))}
                            </datalist>
                        </ModalField>
                        {folders.length > 0 && (
                            <ModalField label="Folder">
                                <select
                                    value={formData.folderId || ''}
                                    onChange={e => setFormData({ ...formData, folderId: e.target.value || undefined })}
                                    className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
                                >
                                    <option value="">Pilih Folder (opsional)</option>
                                    {folders.map(folder => (
                                        <option key={folder.id} value={folder.id}>{folder.name}</option>
                                    ))}
                                </select>
                            </ModalField>
                        )}
                        <ModalField label="Tingkat Kelas">
                            <select
                                value={formData.classLevel}
                                onChange={e => setFormData({ ...formData, classLevel: e.target.value })}
                                className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
                            >
                                <option value="">Pilih Tingkat</option>
                                <option value="Kelas 10">Kelas 10 (SMA)</option>
                                <option value="Kelas 11">Kelas 11 (SMA)</option>
                                <option value="Kelas 12">Kelas 12 (SMA)</option>
                                <option value="Umum">Umum (Guru/Trainer)</option>
                            </select>
                        </ModalField>
                        <ModalField label="Deskripsi">
                            <textarea
                                placeholder="Deskripsi (opsional)"
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                                className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none min-h-[80px]"
                            />
                        </ModalField>
                        <ModalField label="Cover Bank Soal">
                            <label className="flex items-center gap-3 p-4 border border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-primary/40">
                                <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                                <Upload size={18} className="text-slate-400" />
                                <span className="text-sm text-slate-500">{formData.imageUrl ? 'Ganti Cover' : 'Upload Cover'}</span>
                            </label>
                        </ModalField>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">Label</label>
                            <div className="flex flex-wrap gap-2 mb-2">
                                {labels.map(label => (
                                    <button
                                        key={label.id}
                                        type="button"
                                        onClick={() => toggleTag(label.name)}
                                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${formData.tags.includes(label.name) ? 'text-white' : 'bg-white text-slate-600 border-slate-200 hover:border-primary/40'}`}
                                        style={formData.tags.includes(label.name) ? { backgroundColor: label.color, borderColor: label.color } : {}}
                                    >
                                        {label.name}
                                    </button>
                                ))}
                            </div>
                            <div className="flex gap-2 mt-3">
                                <input
                                    type="text"
                                    placeholder="Tulis & tambah label baru..."
                                    value={newCustomLabel}
                                    onChange={e => setNewCustomLabel(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleCreateCustomLabel();
                                        }
                                    }}
                                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-primary/10 outline-none"
                                />
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    onClick={handleCreateCustomLabel}
                                >
                                    Tambah
                                </Button>
                            </div>
                        </div>
                    </ModalBody>
                    <ModalFooter align="between">
                        <Button
                            type="button"
                            variant="cancel"
                            onClick={() => { setIsAddModalOpen(false); setEditingBank(null); }}
                            icon="cancel"
                        >
                            Batal
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            isLoading={isSubmitting || uploadingImage}
                            icon="save"
                        >
                            {editingBank ? 'Simpan' : 'Buat Bank Soal'}
                        </Button>
                    </ModalFooter>
                </form>
            </Modal>

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
                        Yakin ingin menghapus <strong className="text-slate-900">"{bankToDelete?.title}"</strong> beserta seluruh soal di dalamnya?
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