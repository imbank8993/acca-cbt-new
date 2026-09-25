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

const AVAILABLE_ICONS = [
    { id: 'BookOpen', icon: BookOpen, label: 'Buku' },
    { id: 'Calculator', icon: BookOpen, label: 'Matematika' },
    { id: 'Languages', icon: BookOpen, label: 'Bahasa' },
    { id: 'Atom', icon: BookOpen, label: 'Sains' },
    { id: 'Globe', icon: BookOpen, label: 'Sosial' },
];

export default function ProktorQuestionBankPage() {
    const [banks, setBanks] = useMemoryState<any[]>('proktor_questions_banks', []);
    const [isLoading, setIsLoading] = useMemoryState('proktor_questions_isLoading', true);
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
    const [labels, setLabels] = useMemoryState<any[]>('proktor_questions_labels', []);
    const [orgSubjects, setOrgSubjects] = useMemoryState<any[]>('proktor_questions_orgSubjects', []);
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
    const [folders, setFolders] = useMemoryState<any[]>('proktor_questions_folders', []);
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
                        listQuestionBanks(organization.id),
                        listOrganizationLabels(organization.id),
                        listBankFolders(organization.id),
                        listSubjects(organization.id)
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
                result = await createQuestionBank(org.id, {
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
            const result = await createOrganizationLabel(org.id, labelName, randomColor);
            if (result.success) {
                const labelList = await listOrganizationLabels(org.id);
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
                result = await createBankFolder(org.id, newFolderName);
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
        <div key={bank.id} className="bg-white border border-[#030C4D]/30 rounded-lg p-4 flex items-center justify-between hover:border-[#030C4D] transition-all">
            <div className="flex items-center gap-4 min-w-0">
                <input
                    type="checkbox"
                    checked={selectedBankIds.has(bank.id)}
                    onChange={() => toggleSelectBank(bank.id)}
                    className="w-4 h-4 text-[#030C4D] border-[#0038A8]/30 rounded focus:ring-2 focus:ring-[#0038A8]/20 shrink-0 cursor-pointer"
                />
                <div className="w-12 h-12 bg-[#030C4D]/10 rounded-lg flex items-center justify-center shrink-0 border border-[#030C4D]/40">
                    <BookOpen size={20} className="text-[#030C4D]" />
                </div>
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-lg text-xs font-semibold ${bank.is_published ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-[#0038A8]/10 text-[#0038A8] border border-[#0038A8]/30'}`}>
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
            <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => handleTogglePublish(bank)} className={`px-3 py-1.5 text-xs rounded-lg font-semibold transition-all ${bank.is_published ? 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200' : 'bg-[#0038A8] text-white hover:bg-[#0038A8]'}`}>
                    {bank.is_published ? 'Unpublish' : 'Publish'}
                </button>
                <Link href={`/dashboard/admin/questions/${bank.id}`} className="px-3 py-1.5 text-xs bg-[#030C4D]/10 text-[#030C4D] hover:bg-[#030C4D] hover:text-white rounded-lg transition-all flex items-center gap-1 border border-[#030C4D]/30">
                    Lihat <ArrowRight size={12} />
                </Link>
                <button onClick={() => handleOpenMoveBank(bank)} className="p-2 text-slate-400 hover:text-[#030C4D] hover:bg-[#030C4D]/10 rounded-lg transition-all border border-transparent hover:border-[#030C4D]/30" title="Pindah ke folder">
                    <FolderOpen size={14} />
                </button>
                <button onClick={() => handleOpenEdit(bank)} className="p-2 text-slate-400 hover:text-[#030C4D] hover:bg-[#030C4D]/10 rounded-lg transition-all border border-transparent hover:border-[#030C4D]/30"><Edit3 size={14} /></button>
                <button onClick={() => { setBankToDelete(bank); setIsDeleteModalOpen(true); }} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all border border-transparent hover:border-red-200"><Trash2 size={14} /></button>
            </div>
        </div>
    );

    return (
        <div className="max-w-7xl mx-auto pb-24">

            {/* ── Hero Header — Navy Gradient ── */}
            {/* ── Stats Grid ── */}
            <div className="grid grid-cols-3 gap-x-2 mb-6">
                <div className="bg-white rounded-lg border border-[#030C4D]/30 text-center px-4 py-3">
                    <p className="text-2xl font-bold text-[#030C4D]">{allCount}</p>
                    <p className="text-xs text-slate-500">Total</p>
                </div>
                <div className="bg-white rounded-lg border border-[#030C4D]/30 text-center px-4 py-3">
                    <p className="text-2xl font-bold text-[#030C4D]">{draftCount}</p>
                    <p className="text-xs text-slate-500">Draft</p>
                </div>
                <div className="bg-white rounded-lg border border-[#030C4D]/30 text-center px-4 py-3">
                    <p className="text-2xl font-bold text-[#030C4D]">{publishedCount}</p>
                    <p className="text-xs text-slate-500">Published</p>
                </div>
            </div>

            {/* Search, Filters, and Actions Toolbar */}
            <div className="flex flex-col xl:flex-row gap-3 mb-6 items-start xl:items-center w-full justify-between">
                
                {/* Left Area: Search + Filters */}
                <div className="flex flex-col lg:flex-row gap-3 w-full xl:w-auto items-stretch lg:items-center flex-1">
                    {/* Search */}
                    <div className="relative w-full lg:w-64 shrink-0">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Cari bank soal..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-white border border-[#030C4D]/30 rounded-lg h-[38px] pl-9 pr-3 text-sm focus:ring-2 focus:ring-[#030C4D]/20 focus:border-[#030C4D] outline-none"
                        />
                    </div>
                    
                    {/* Filters (4 Dropdowns) */}
                    <div className="grid grid-cols-2 sm:flex sm:flex-row gap-2 w-full lg:w-auto flex-1 xl:flex-none">
                        {/* Filter Label */}
                        <div className="relative w-full sm:w-auto sm:min-w-[140px]" ref={labelDropdownRef}>
                            <button
                                type="button"
                                onClick={() => setIsLabelDropdownOpen(!isLabelDropdownOpen)}
                                className="bg-white w-full border border-[#030C4D]/30 rounded-lg py-2 px-3 text-xs focus:ring-2 focus:ring-[#030C4D]/20 outline-none text-slate-600 flex items-center justify-between gap-1.5 h-[38px] cursor-pointer"
                            >
                                <span className="truncate">{activeTagFilter ? activeTagFilter : 'Semua Label'}</span>
                                <ChevronDown size={14} className="text-slate-400 shrink-0" />
                            </button>
                            
                            {isLabelDropdownOpen && (
                                <div className="absolute left-0 mt-1.5 w-full sm:w-56 bg-white border border-[#030C4D]/30 rounded-lg shadow-xl z-50 p-2 space-y-2">
                                    <input type="text" placeholder="Cari label..." value={labelSearchQuery} onChange={e => setLabelSearchQuery(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-md py-1.5 px-3 text-xs outline-none focus:border-[#030C4D]" />
                                    <div className="max-h-48 overflow-y-auto space-y-0.5 scrollbar-thin">
                                        <button type="button" onClick={() => { setActiveTagFilter(null); setIsLabelDropdownOpen(false); setLabelSearchQuery(''); }} className={`w-full text-left px-3 py-1.5 text-xs rounded transition-colors cursor-pointer ${!activeTagFilter ? 'bg-[#030C4D]/10 text-[#030C4D] font-semibold' : 'hover:bg-slate-50 text-slate-600'}`}>Semua Label</button>
                                        {labels.filter(label => label.name.toLowerCase().includes(labelSearchQuery.toLowerCase())).map(label => (
                                            <button key={label.id} type="button" onClick={() => { setActiveTagFilter(label.name); setIsLabelDropdownOpen(false); setLabelSearchQuery(''); }} className={`w-full text-left px-3 py-1.5 text-xs rounded transition-colors flex items-center justify-between cursor-pointer ${activeTagFilter === label.name ? 'bg-[#030C4D]/10 text-[#030C4D] font-semibold' : 'hover:bg-slate-50 text-slate-600'}`}>
                                                <span className="truncate">{label.name}</span>
                                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Filter Mapel */}
                        <div className="relative w-full sm:w-auto sm:min-w-[140px]" ref={subjectDropdownRef}>
                            <button
                                type="button"
                                onClick={() => setIsSubjectDropdownOpen(!isSubjectDropdownOpen)}
                                className="bg-white w-full border border-[#030C4D]/30 rounded-lg py-2 px-3 text-xs focus:ring-2 focus:ring-[#030C4D]/20 outline-none text-slate-600 flex items-center justify-between gap-1.5 h-[38px] cursor-pointer"
                            >
                                <span className="truncate">{activeSubjectFilter ? activeSubjectFilter : 'Semua Mapel'}</span>
                                <ChevronDown size={14} className="text-slate-400 shrink-0" />
                            </button>
                            
                            {isSubjectDropdownOpen && (
                                <div className="absolute left-0 mt-1.5 w-full sm:w-56 bg-white border border-[#030C4D]/30 rounded-lg shadow-xl z-50 p-2 space-y-2">
                                    <input type="text" placeholder="Cari mapel..." value={subjectSearchQuery} onChange={e => setSubjectSearchQuery(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-md py-1.5 px-3 text-xs outline-none focus:border-[#030C4D]" />
                                    <div className="max-h-48 overflow-y-auto space-y-0.5 scrollbar-thin">
                                        <button type="button" onClick={() => { setActiveSubjectFilter(null); setIsSubjectDropdownOpen(false); setSubjectSearchQuery(''); }} className={`w-full text-left px-3 py-1.5 text-xs rounded transition-colors cursor-pointer ${!activeSubjectFilter ? 'bg-[#030C4D]/10 text-[#030C4D] font-semibold' : 'hover:bg-slate-50 text-slate-600'}`}>Semua Mapel</button>
                                        {subjects.filter(s => s.toLowerCase().includes(subjectSearchQuery.toLowerCase())).map(s => (
                                            <button key={s} type="button" onClick={() => { setActiveSubjectFilter(s); setIsSubjectDropdownOpen(false); setSubjectSearchQuery(''); }} className={`w-full text-left px-3 py-1.5 text-xs rounded transition-colors cursor-pointer ${activeSubjectFilter === s ? 'bg-[#030C4D]/10 text-[#030C4D] font-semibold' : 'hover:bg-slate-50 text-slate-600'}`}>
                                                <span className="truncate">{s}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Filter Pembuat */}
                        <div className="relative w-full sm:w-auto sm:min-w-[140px]" ref={creatorDropdownRef}>
                            <button
                                type="button"
                                onClick={() => setIsCreatorDropdownOpen(!isCreatorDropdownOpen)}
                                className="bg-white w-full border border-[#030C4D]/30 rounded-lg py-2 px-3 text-xs focus:ring-2 focus:ring-[#030C4D]/20 outline-none text-slate-600 flex items-center justify-between gap-1.5 h-[38px] cursor-pointer"
                            >
                                <span className="truncate">{activeCreatorFilter ? activeCreatorFilter : 'Semua Pembuat'}</span>
                                <ChevronDown size={14} className="text-slate-400 shrink-0" />
                            </button>
                            
                            {isCreatorDropdownOpen && (
                                <div className="absolute left-0 mt-1.5 w-full sm:w-56 bg-white border border-[#030C4D]/30 rounded-lg shadow-xl z-50 p-2 space-y-2">
                                    <input type="text" placeholder="Cari pembuat..." value={creatorSearchQuery} onChange={e => setCreatorSearchQuery(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-md py-1.5 px-3 text-xs outline-none focus:border-[#030C4D]" />
                                    <div className="max-h-48 overflow-y-auto space-y-0.5 scrollbar-thin">
                                        <button type="button" onClick={() => { setActiveCreatorFilter(null); setIsCreatorDropdownOpen(false); setCreatorSearchQuery(''); }} className={`w-full text-left px-3 py-1.5 text-xs rounded transition-colors cursor-pointer ${!activeCreatorFilter ? 'bg-[#030C4D]/10 text-[#030C4D] font-semibold' : 'hover:bg-slate-50 text-slate-600'}`}>Semua Pembuat</button>
                                        {creators.filter(c => c.toLowerCase().includes(creatorSearchQuery.toLowerCase())).map(c => (
                                            <button key={c} type="button" onClick={() => { setActiveCreatorFilter(c); setIsCreatorDropdownOpen(false); setCreatorSearchQuery(''); }} className={`w-full text-left px-3 py-1.5 text-xs rounded transition-colors cursor-pointer ${activeCreatorFilter === c ? 'bg-[#030C4D]/10 text-[#030C4D] font-semibold' : 'hover:bg-slate-50 text-slate-600'}`}>
                                                <span className="truncate">{c}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Filter Kelas */}
                        <div className="relative w-full sm:w-auto sm:min-w-[140px]" ref={classDropdownRef}>
                            <button
                                type="button"
                                onClick={() => setIsClassDropdownOpen(!isClassDropdownOpen)}
                                className="bg-white w-full border border-[#030C4D]/30 rounded-lg py-2 px-3 text-xs focus:ring-2 focus:ring-[#030C4D]/20 outline-none text-slate-600 flex items-center justify-between gap-1.5 h-[38px] cursor-pointer"
                            >
                                <span className="truncate">{activeClassFilter ? activeClassFilter : 'Semua Kelas'}</span>
                                <ChevronDown size={14} className="text-slate-400 shrink-0" />
                            </button>
                            
                            {isClassDropdownOpen && (
                                <div className="absolute left-0 mt-1.5 w-full sm:w-56 bg-white border border-[#030C4D]/30 rounded-lg shadow-xl z-50 p-2 space-y-2">
                                    <input type="text" placeholder="Cari kelas..." value={classSearchQuery} onChange={e => setClassSearchQuery(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-md py-1.5 px-3 text-xs outline-none focus:border-[#030C4D]" />
                                    <div className="max-h-48 overflow-y-auto space-y-0.5 scrollbar-thin">
                                        <button type="button" onClick={() => { setActiveClassFilter(null); setIsClassDropdownOpen(false); setClassSearchQuery(''); }} className={`w-full text-left px-3 py-1.5 text-xs rounded transition-colors cursor-pointer ${!activeClassFilter ? 'bg-[#030C4D]/10 text-[#030C4D] font-semibold' : 'hover:bg-slate-50 text-slate-600'}`}>Semua Kelas</button>
                                        {CLASS_LEVELS.filter(c => c.toLowerCase().includes(classSearchQuery.toLowerCase())).map(c => (
                                            <button key={c} type="button" onClick={() => { setActiveClassFilter(c); setIsClassDropdownOpen(false); setClassSearchQuery(''); }} className={`w-full text-left px-3 py-1.5 text-xs rounded transition-colors cursor-pointer ${activeClassFilter === c ? 'bg-[#030C4D]/10 text-[#030C4D] font-semibold' : 'hover:bg-slate-50 text-slate-600'}`}>
                                                <span className="truncate">{c}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Area: Action Buttons */}
                <div className="flex flex-row items-center gap-2 w-full sm:w-auto shrink-0 pt-2 xl:pt-0">
                    {isProctor && (
                        <button onClick={handleOpenCreateFolder} className="flex-1 sm:flex-none justify-center px-4 py-2 text-sm bg-white text-[#030C4D] border border-[#030C4D] rounded-lg hover:bg-[#030C4D]/5 flex items-center gap-1.5 h-[38px] cursor-pointer whitespace-nowrap font-medium transition-colors">
                            <FolderPlus size={15} /> Folder
                        </button>
                    )}
                    <button onClick={() => setIsAddModalOpen(true)} className="flex-1 sm:flex-none justify-center px-4 py-2 text-sm bg-[#030C4D] text-white border border-[#030C4D] rounded-lg hover:bg-[#020510] flex items-center gap-1.5 font-semibold h-[38px] cursor-pointer whitespace-nowrap transition-colors">
                        <Plus size={16} /> Buat
                    </button>
                </div>
            </div>

            {/* Bulk Actions Panel */}
            {selectedBankIds.size > 0 && (
                <div className="bg-[#030C4D]/5 border border-[#030C4D]/30 rounded-lg p-3.5 flex items-center justify-between mb-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-[#0038A8] rounded-full animate-pulse" />
                        <span className="text-xs font-bold text-[#030C4D] uppercase tracking-wider">{selectedBankIds.size} Bank Soal Terpilih</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={handleSelectAll} className="px-3.5 py-2 text-xs font-semibold bg-white border border-[#030C4D]/30 text-[#030C4D] hover:bg-[#030C4D]/5 rounded-lg transition-all cursor-pointer">
                            Pilih Semua
                        </button>
                        <button onClick={() => setIsBulkMoveModalOpen(true)} className="px-3.5 py-2 text-xs font-semibold bg-[#0038A8] text-white hover:bg-[#0038A8] rounded-lg flex items-center gap-1.5 transition-all cursor-pointer">
                            <FolderOpen size={13} /> Pindahkan ke Folder
                        </button>
                        <button onClick={handleClearSelection} className="px-3.5 py-2 text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg transition-all cursor-pointer">
                            Batal
                        </button>
                    </div>
                </div>
            )}

            {/* Mobile Card View */}
            <div className="block md:hidden space-y-3">
                {isLoading ? (
                    <div className="flex justify-center py-12">
                        <div className="w-8 h-8 border-2 border-[#0038A8]/20 border-t-[#030C4D] rounded-full animate-spin"></div>
                    </div>
                ) : filteredBanks.length === 0 ? (
                    <div className="py-12 text-center text-slate-400">
                        <BookOpen size={32} className="mx-auto mb-2 opacity-50" />
                        <p>Tidak ada bank soal</p>
                    </div>
                ) : (
                    paginatedBanks.map((bank) => (
                        <div key={bank.id} className="bg-white border border-[#030C4D]/30 rounded-lg p-4 shadow-sm">
                            <div className="flex items-center gap-3 mb-3">
                                <input
                                    type="checkbox"
                                    checked={selectedBankIds.has(bank.id)}
                                    onChange={() => toggleSelectBank(bank.id)}
                                    className="w-4 h-4 text-[#030C4D] border-[#0038A8]/30 rounded focus:ring-2 focus:ring-[#0038A8]/20 shrink-0 cursor-pointer"
                                />
                                <div className="w-12 h-12 bg-[#030C4D]/10 rounded-lg flex items-center justify-center shrink-0 border border-[#030C4D]/40">
                                    <BookOpen size={20} className="text-[#030C4D]" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-2 mb-1">
                                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold ${bank.is_published ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-[#0038A8]/10 text-[#0038A8] border border-[#0038A8]/30'}`}>
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
                            <div className="flex gap-2">
                                <button onClick={() => handleTogglePublish(bank)} className={`flex-1 px-3 py-2 text-xs rounded-lg font-semibold transition-all ${bank.is_published ? 'bg-slate-100 text-slate-600 border border-slate-200' : 'bg-[#0038A8] text-white'}`}>
                                    {bank.is_published ? 'Unpublish' : 'Publish'}
                                </button>
                                <Link href={`/dashboard/admin/questions/${bank.id}`} className="flex-1 px-3 py-2 text-xs bg-[#030C4D]/10 text-[#030C4D] hover:bg-[#030C4D] hover:text-white rounded-lg transition-all flex items-center justify-center gap-1 border border-[#030C4D]/30">
                                    Lihat <ArrowRight size={12} />
                                </Link>
                                <button onClick={() => handleOpenEdit(bank)} className="p-2 text-slate-400 hover:text-[#030C4D] hover:bg-[#030C4D]/10 rounded-lg transition-all border border-transparent hover:border-[#030C4D]/30"><Edit3 size={14} /></button>
                                <button onClick={() => { setBankToDelete(bank); setIsDeleteModalOpen(true); }} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all border border-transparent hover:border-red-200"><Trash2 size={14} /></button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Desktop List View - with folder support */}
            <div className="hidden md:block space-y-3">
                {isLoading ? (
                    <div className="flex justify-center py-16">
                        <div className="w-8 h-8 border-3 border-slate-200 border-t-primary rounded-full animate-spin"></div>
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
                                    <div className="flex items-center gap-2 px-4 py-3 bg-[#030C4D]/5 border border-[#030C4D]/30 rounded-lg mb-2">
                                        <button
                                            onClick={() => toggleFolderExpand(folder.id)}
                                            className="flex items-center gap-2 flex-1 hover:text-[#030C4D] transition-all"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={folderBanks.length > 0 && folderBanks.every(b => selectedBankIds.has(b.id))}
                                                onChange={() => toggleSelectAllInFolder(folderBanks)}
                                                onClick={(e) => e.stopPropagation()}
                                                className="w-4 h-4 text-[#030C4D] border-[#0038A8]/30 rounded focus:ring-2 focus:ring-[#0038A8]/20 cursor-pointer shrink-0"
                                            />
                                            {isExpanded ? <ChevronRight size={16} className="text-slate-400 rotate-90" /> : <ChevronRight size={16} className="text-slate-400" />}
                                            <Folder size={16} className="text-[#030C4D]" />
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
                                                <div className="absolute right-0 top-full mt-1 bg-white border border-[#030C4D]/30 rounded-lg shadow-lg py-1 z-20 min-w-[160px]">
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
                                                        className="w-full text-left px-3 py-2 text-xs text-slate-600 hover:bg-[#030C4D]/5 flex items-center gap-2"
                                                    >
                                                        <Plus size={12} /> Buat Baru
                                                    </button>
                                                    <button
                                                        onClick={() => handleOpenAddToFolder(folder)}
                                                        className="w-full text-left px-3 py-2 text-xs text-slate-600 hover:bg-[#030C4D]/5 flex items-center gap-2"
                                                    >
                                                        <BookOpen size={12} /> Pilih Existing
                                                    </button>
                                                    {folderBanks.length > 0 && (
                                                        <>
                                                            <div className="border-t border-[#0038A8]/20 my-1"></div>
                                                            <button
                                                                onClick={() => {
                                                                    setBulkMode(true);
                                                                    setSelectedBankIds(new Set());
                                                                    setExpandedFolders(prev => new Set([...prev, folder.id]));
                                                                    setFolderMenuId(null);
                                                                }}
                                                                className="w-full text-left px-3 py-2 text-xs text-slate-600 hover:bg-[#030C4D]/5 flex items-center gap-2"
                                                            >
                                                                <Check size={12} /> Pindahkan
                                                            </button>
                                                        </>
                                                    )}
                                                    <div className="border-t border-[#0038A8]/20 my-1"></div>
                                                    <button
                                                        onClick={() => handleOpenEditFolder(folder)}
                                                        className="w-full text-left px-3 py-2 text-xs text-slate-600 hover:bg-[#030C4D]/5 flex items-center gap-2"
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
                                                className="w-full py-2 border border-dashed border-[#030C4D]/30 rounded-lg text-xs text-slate-500 hover:border-[#030C4D] hover:text-[#030C4D] transition-all flex items-center justify-center gap-1"
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
            <AnimatePresence>
                {isFolderModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/30" onClick={() => setIsFolderModalOpen(false)} />
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-sm rounded-2xl p-6 relative z-10">
                            <button onClick={() => setIsFolderModalOpen(false)} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
                            <h3 className="text-lg font-semibold text-slate-900 mb-4">{editingFolder ? 'Edit Folder' : 'Buat Folder Baru'}</h3>
                            <form onSubmit={handleSaveFolder} className="space-y-4">
                                <input
                                    required
                                    type="text"
                                    placeholder="Nama Folder"
                                    value={newFolderName}
                                    onChange={e => setNewFolderName(e.target.value)}
                                    className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
                                />
                                <button type="submit" disabled={isSubmitting} className="w-full py-3 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                                    {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                                    {editingFolder ? 'Simpan' : 'Buat Folder'}
                                </button>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Move to Folder Modal */}
            <AnimatePresence>
                {isMoveModalOpen && bankToMove && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/30" onClick={() => setIsMoveModalOpen(false)} />
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-sm rounded-2xl p-6 relative z-10">
                            <button onClick={() => setIsMoveModalOpen(false)} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
                            <h3 className="text-lg font-semibold text-slate-900 mb-2">Pindahkan Bank Soal</h3>
                            <p className="text-sm text-slate-500 mb-4">Pilih folder untuk "{bankToMove.title}"</p>
                            <div className="space-y-2 mb-4">
                                <button
                                    onClick={() => handleMoveBank(null)}
                                    className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${!bankToMove.folder_id ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 hover:border-primary/40'}`}
                                >
                                    <div className="flex items-center gap-2">
                                        <Folder size={14} /> Tanpa Folder
                                    </div>
                                </button>
                                {folders.map(folder => (
                                    <button
                                        key={folder.id}
                                        onClick={() => handleMoveBank(folder.id)}
                                        className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${bankToMove.folder_id === folder.id ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 hover:border-primary/40'}`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <Folder size={14} /> {folder.name}
                                        </div>
                                    </button>
                                ))}
                                {folders.length === 0 && (
                                    <p className="text-xs text-slate-400 text-center py-4">Belum ada folder. Buat folder terlebih dahulu.</p>
                                )}
                            </div>
                            <button onClick={() => setIsMoveModalOpen(false)} className="w-full py-2.5 bg-slate-100 text-slate-700 rounded-xl font-medium">Batal</button>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Add Existing Banks to Folder Modal */}
            <AnimatePresence>
                {isAddToFolderModalOpen && targetFolder && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/30" onClick={() => setIsAddToFolderModalOpen(false)} />
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-lg rounded-2xl p-6 relative z-10 max-h-[80vh] flex flex-col">
                            <button onClick={() => setIsAddToFolderModalOpen(false)} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
                            <h3 className="text-lg font-semibold text-slate-900 mb-1">Tambah ke "{targetFolder.name}"</h3>
                            <p className="text-sm text-slate-500 mb-4">Pilih bank soal untuk ditambahkan:</p>
                            <div className="flex-1 overflow-y-auto space-y-2 mb-4">
                                {banks.filter(b => !b.folder_id || b.folder_id !== targetFolder.id).length === 0 ? (
                                    <div className="text-center text-slate-400 py-8">
                                        <BookOpen size={24} className="mx-auto mb-2 opacity-50" />
                                        <p className="text-sm">Semua bank soal sudah ada di folder ini</p>
                                        <p className="text-xs mt-1">atau belum ada bank soal</p>
                                    </div>
                                ) : (
                                    banks
                                        .filter(b => !b.folder_id || b.folder_id !== targetFolder.id)
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
                            </div>
                            <div className="flex gap-3">
                                <button onClick={() => setIsAddToFolderModalOpen(false)} className="flex-1 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-medium">Batal</button>
                                <button
                                    onClick={handleAddBanksToFolder}
                                    disabled={selectedAddToFolderIds.size === 0 || isSubmitting}
                                    className="flex-1 py-2.5 bg-primary text-white rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                                    Tambah {selectedAddToFolderIds.size > 0 ? `(${selectedAddToFolderIds.size})` : ''}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Bulk Move to Folder Modal */}
            <AnimatePresence>
                {isBulkMoveModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/30" onClick={() => setIsBulkMoveModalOpen(false)} />
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-sm rounded-2xl p-6 relative z-10">
                            <button onClick={() => setIsBulkMoveModalOpen(false)} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
                            <h3 className="text-lg font-semibold text-slate-900 mb-2">Pindahkan {selectedBankIds.size} Bank Soal</h3>
                            <p className="text-sm text-slate-500 mb-4">Pilih folder tujuan:</p>
                            <div className="space-y-2 mb-4">
                                <button
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
                                        onClick={() => handleBulkMove(folder.id)}
                                        className="w-full text-left px-4 py-3 rounded-xl border transition-all border-slate-200 hover:border-primary/40"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Folder size={14} /> {folder.name}
                                        </div>
                                    </button>
                                ))}
                                {folders.length === 0 && (
                                    <p className="text-xs text-slate-400 text-center py-4">Belum ada folder. Buat folder terlebih dahulu.</p>
                                )}
                            </div>
                            <button onClick={() => setIsBulkMoveModalOpen(false)} className="w-full py-2.5 bg-slate-100 text-slate-700 rounded-xl font-medium">Batal</button>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Add/Edit Modal */}
            <AnimatePresence>
                {isAddModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/30" onClick={() => { setIsAddModalOpen(false); setEditingBank(null); }} />
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-md rounded-2xl p-6 relative z-10">
                            <button onClick={() => { setIsAddModalOpen(false); setEditingBank(null); }} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
                            <h3 className="text-lg font-semibold text-slate-900 mb-4">{editingBank ? 'Edit Bank Soal' : 'Buat Bank Soal Baru'}</h3>
                            <form onSubmit={handleSaveBank} className="space-y-4">
                                <input required type="text" placeholder="Judul Bank Soal" value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none" />
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
                                {folders.length > 0 && (
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
                                )}
                                <select value={formData.classLevel} onChange={e => setFormData({ ...formData, classLevel: e.target.value })} className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none">
                                    <option value="">Pilih Tingkat</option>
                                    <option value="Kelas 10">Kelas 10 (SMA)</option>
                                    <option value="Kelas 11">Kelas 11 (SMA)</option>
                                    <option value="Kelas 12">Kelas 12 (SMA)</option>
                                    <option value="Umum">Umum (Guru/Trainer)</option>
                                </select>
                                <textarea placeholder="Deskripsi (opsional)" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none min-h-[80px]" />
                                <label className="flex items-center gap-3 p-4 border border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-primary/40">
                                    <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                                    <Upload size={18} className="text-slate-400" />
                                    <span className="text-sm text-slate-500">{formData.imageUrl ? 'Ganti Cover' : 'Upload Cover'}</span>
                                </label>
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
                                        <button
                                            type="button"
                                            onClick={handleCreateCustomLabel}
                                            className="px-3 py-2 bg-primary text-white text-xs font-medium rounded-xl hover:bg-primary-hover transition-colors"
                                        >
                                            Tambah
                                        </button>
                                    </div>
                                </div>
                                <button type="submit" disabled={isSubmitting || uploadingImage} className="w-full py-3 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                                    {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                                    {editingBank ? 'Simpan' : 'Buat Bank Soal'}
                                </button>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Delete Modal */}
            <AnimatePresence>
                {isDeleteModalOpen && bankToDelete && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/30" onClick={() => setIsDeleteModalOpen(false)} />
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-sm rounded-2xl p-6 relative z-10">
                            <button onClick={() => setIsDeleteModalOpen(false)} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
                            <h3 className="text-lg font-semibold text-slate-900 mb-2">Hapus Bank Soal</h3>
                            <p className="text-sm text-slate-500 mb-4">Yakin ingin menghapus "{bankToDelete.title}"? Tindakan ini tidak dapat dibatalkan.</p>
                            <div className="flex gap-3">
                                <button onClick={() => setIsDeleteModalOpen(false)} className="flex-1 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-medium">Batal</button>
                                <button onClick={handleDeleteBank} disabled={isSubmitting} className="flex-1 py-2.5 bg-red-500 text-white rounded-xl font-medium disabled:opacity-50">Hapus</button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}