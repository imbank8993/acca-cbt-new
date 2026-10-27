'use client';

import { ShieldCheck, UserCheck } from 'lucide-react';
import { Tabs, type TabItem } from '@/app/components/ui/tabs';

interface ValidationTabsProps {
    activeTab: 'tasks' | 'manage';
    manageRole?: 'Admin' | 'Proktor';
    tasksCount?: number;
    sessionLoading?: boolean;
}

export function ValidationTabs({ activeTab, manageRole, tasksCount, sessionLoading = false }: ValidationTabsProps) {
    const tabs: TabItem<'tasks' | 'manage'>[] = [{
        key: 'tasks',
        label: 'Tugas Validasi Saya',
        shortLabel: 'Tugas Saya',
        href: '/dashboard/guru/validations',
        icon: <UserCheck size={16} />,
        badge: tasksCount === undefined ? '…' : tasksCount,
    }];

    if (manageRole || sessionLoading) {
        tabs.push({
            key: 'manage',
            label: 'Kelola Sesi Validasi',
            shortLabel: 'Kelola Sesi',
            href: manageRole === 'Admin' ? '/dashboard/admin/questions/validations' : '/dashboard/proktor/questions/validations',
            icon: <ShieldCheck size={16} />,
            disabled: sessionLoading,
        });
    }

    return <Tabs tabs={tabs} activeTab={activeTab} ariaLabel="Navigasi validasi soal" className="validation-tabs" />;
}
