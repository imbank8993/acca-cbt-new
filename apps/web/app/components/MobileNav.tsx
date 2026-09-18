"use client";
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import {
    LayoutDashboard,
    ClipboardCheck,
    Activity,
    Settings,
    BookOpen,
    Users,
    BarChart3,
    Calendar,
    Bell
} from 'lucide-react';

const MobileNav = () => {
    const pathname = usePathname();

    const getRole = () => {
        if (pathname.includes('/admin')) return 'Admin';
        if (pathname.includes('/proktor')) return 'Proktor';
        if (pathname.includes('/guru')) return 'Guru';
        if (pathname.includes('/pengawas')) return 'Pengawas';
        if (pathname.includes('/siswa')) return 'Siswa';
        return 'User';
    };

    const role = getRole();

    // Setiap href di bawah menunjuk halaman yang benar-benar ada.
    //
    // Sebelumnya menu ini diwarisi dari produk asalnya dan separuh tautannya
    // mati — yang terburuk /dashboard/settings, yang muncul di SETIAP peran,
    // sehingga tombol "Set" tidak pernah berfungsi untuk siapa pun.
    const navConfig: Record<string, any[]> = {
        'Admin': [
            { icon: LayoutDashboard, label: 'Dash', href: '/dashboard/admin' },
            { icon: ClipboardCheck, label: 'Ujian', href: '/dashboard/admin/exams' },
            { icon: Activity, label: 'Monitor', href: '/dashboard/admin/monitoring' },
            { icon: BookOpen, label: 'Bank', href: '/dashboard/admin/questions' },
            { icon: Users, label: 'Kelas', href: '/dashboard/admin/classes' },
        ],
        'Proktor': [
            { icon: LayoutDashboard, label: 'Dash', href: '/dashboard/proktor' },
            { icon: ClipboardCheck, label: 'Ujian', href: '/dashboard/proktor/exams' },
            { icon: Activity, label: 'Monitor', href: '/dashboard/proktor/monitoring' },
            { icon: BookOpen, label: 'Bank', href: '/dashboard/proktor/questions' },
            { icon: Users, label: 'Kelas', href: '/dashboard/proktor/classes' },
        ],
        'Guru': [
            { icon: LayoutDashboard, label: 'Dash', href: '/dashboard/guru' },
            { icon: ClipboardCheck, label: 'Ujian', href: '/dashboard/guru/exams' },
            { icon: Activity, label: 'Monitor', href: '/dashboard/guru/monitoring' },
            { icon: BarChart3, label: 'Nilai', href: '/dashboard/guru/grading' },
            { icon: BookOpen, label: 'Bank', href: '/dashboard/guru/questions' },
        ],
        'Pengawas': [
            { icon: LayoutDashboard, label: 'Dash', href: '/dashboard/pengawas' },
            { icon: Activity, label: 'Monitor', href: '/dashboard/pengawas/monitoring' },
            { icon: Bell, label: 'Notif', href: '/dashboard/notifications' },
        ],
        'Siswa': [
            { icon: LayoutDashboard, label: 'Dash', href: '/dashboard/siswa' },
            { icon: Calendar, label: 'Jadwal', href: '/dashboard/siswa/schedule' },
            { icon: BarChart3, label: 'Hasil', href: '/dashboard/siswa/results' },
            { icon: Users, label: 'Kelas', href: '/dashboard/siswa/classes' },
            { icon: Activity, label: 'Analisis', href: '/dashboard/siswa/analytics' },
        ],
        'User': [
            { icon: Bell, label: 'Notif', href: '/dashboard/notifications' },
            { icon: Settings, label: 'Set', href: '/dashboard/notifications/settings' },
        ]
    };

    const navItems = navConfig[role] || navConfig['User'];

    return (
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 h-20 bg-white border-t border-slate-100 z-40 px-6 pb-2">
            <div className="flex items-center justify-between h-full">
                {navItems.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                        <Link key={item.label} href={item.href} className="flex flex-col items-center justify-center gap-1 min-w-[60px] relative">
                            <motion.div
                                animate={isActive ? { scale: 1.1 } : { scale: 1 }}
                                className={`w-12 h-8 flex items-center justify-center rounded-2xl transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'text-slate-400'}`}
                            >
                                <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                                {isActive && (
                                    <motion.div
                                        layoutId="mobile-nav-pill"
                                        className="absolute inset-0 bg-primary/10 rounded-2xl -z-10"
                                    />
                                )}
                            </motion.div>
                            <span className={`text-[9px] font-black uppercase tracking-widest ${isActive ? 'text-primary' : 'text-slate-400'}`}>
                                {item.label}
                            </span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
};

export default MobileNav;
