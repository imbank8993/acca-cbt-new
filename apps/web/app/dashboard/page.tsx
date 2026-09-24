"use client";

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { resolveActiveRole, getDashboardPath } from '@/lib/rbac';
import DashboardLoading from '@/app/components/DashboardLoading';

/**
 * Pengarah rute root /dashboard.
 *
 * Mengarahkan pengguna langsung ke dasbor sesuai peran aktifnya
 * (mis. /dashboard/siswa, /dashboard/guru, /dashboard/admin),
 * sehingga pengguna tidak menemui halaman kosong atau 404 ketika
 * membuka URL /dashboard secara langsung.
 */
export default function DashboardRootPage() {
    const router = useRouter();

    useEffect(() => {
        let mounted = true;

        resolveActiveRole().then(({ role }) => {
            if (!mounted) return;
            if (role && role !== 'None') {
                router.replace(getDashboardPath(role));
            } else {
                router.replace('/');
            }
        }).catch(() => {
            if (mounted) router.replace('/');
        });

        return () => {
            mounted = false;
        };
    }, [router]);

    return <DashboardLoading />;
}
