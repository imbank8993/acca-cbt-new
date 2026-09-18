"use client";
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearCbtSession, resetAndRetrySso } from '@/lib/session-reset';
import { getDashboardPath, setActiveRoleInStorage, lockActiveRole, type Role } from '@/lib/rbac';

type SsoFailure = { title: string; message: string };

export default function Home() {
    const router = useRouter();
    // Kegagalan SSO dulu ditulis lewat document.body.innerHTML — layar buntu
    // yang hanya menawarkan "Coba Lagi" ke `/` dan berputar kembali ke error
    // yang sama. Sekarang jadi state React dengan jalan keluar yang nyata.
    const [failure, setFailure] = useState<SsoFailure | null>(null);
    const [resetting, setResetting] = useState(false);

    useEffect(() => {
        let isRedirecting = false;
        let settled = false; // true begitu sesi CBT ditemukan

        // Authoritative role forwarded by the acca-app SSO hand-off (?sso_role=).
        // It is fresh (derived from acca-app's users table) and lets us skip the
        // slow DB role lookup entirely — the main cause of the long wait.
        const VALID_SSO_ROLES = ['Superadmin', 'Admin', 'Proktor', 'Guru', 'Pengawas', 'Siswa'];
        const ssoRoleParam = new URLSearchParams(window.location.search).get('sso_role') || '';
        const ssoRole = (VALID_SSO_ROLES.includes(ssoRoleParam) ? ssoRoleParam : null) as Role | null;

        const fail = (title: string, message: string) => {
            isRedirecting = true;
            setFailure({ title, message });
        };

        /**
         * Sesi CBT sendiri: cookie httpOnly `cbt_session` yang diterbitkan
         * `/api/auth/sso`. Tokennya tidak bisa dibaca JavaScript, jadi satu-
         * satunya cara memeriksanya adalah bertanya ke server.
         */
        const checkCbtSession = async (): Promise<boolean> => {
            try {
                const res = await fetch('/api/auth/me', { cache: 'no-store' });
                const body = await res.json().catch(() => null);
                if (!res.ok || !body?.success || !body?.id) return false;

                settled = true;
                isRedirecting = true;

                // `bestRole` dihitung ulang NestJS dari database pada tiap
                // permintaan, jadi ia lebih tepercaya daripada ?sso_role= di URL
                // maupun peran yang tersimpan di localStorage.
                const role = (body.bestRole || ssoRole || 'None') as Role;
                if (role === 'None') {
                    fail(
                        'Akses Ditolak',
                        'Anda belum memiliki peran aktif di CBT. Hubungi proktor atau admin sekolah.',
                    );
                    return true;
                }

                setActiveRoleInStorage(role === 'Superadmin' ? 'Admin' : role);
                lockActiveRole();
                router.push(getDashboardPath(role));
                return true;
            } catch {
                // Jaringan putus. Bukan berarti sesinya tidak ada, jadi jangan
                // langsung dipantulkan — percobaan kedua setelah jeda di bawah
                // yang memutuskan.
                return false;
            }
        };

        const checkSession = async () => {
            // Kesalahan yang dilaporkan route SSO (tiket kedaluwarsa, tidak lengkap, dll).
            if (window.location.search.includes('error=')) {
                const urlParams = new URLSearchParams(window.location.search);
                const msg = urlParams.get('msg') || urlParams.get('error') || 'Terjadi kesalahan pada proses masuk.';
                fail('Gagal Masuk ke CBT', msg);
                return;
            }

            // Satu-satunya pemeriksaan sesi. Cookie `cbt_session` sudah dipasang
            // `/api/auth/sso` sebelum pengguna sampai di halaman ini.
            if (await checkCbtSession()) return;

            // Hand-off gaya lama menaruh token Supabase di fragment URL
            // (`#token_hash=` / `#access_token=`). Tidak ada lagi yang bisa
            // menukarnya — acca-new sekarang memanggil `/api/auth/sso?token=`
            // dan NestJS yang menerbitkan sesinya. Tautan lama dari bookmark
            // atau tab yang belum di-refresh masih mungkin membawanya, jadi
            // fragmennya dibuang dari address bar supaya token tidak tertinggal
            // di riwayat browser, lalu alurnya dilanjutkan seperti tanpa sesi.
            if (window.location.hash.includes('token=')) {
                history.replaceState(null, '', window.location.pathname + window.location.search);
            }

            // Beri jeda singkat: cookie bisa saja baru mendarat sesaat setelah
            // pengalihan dari `/api/auth/sso`.
            setTimeout(async () => {
                if (settled || isRedirecting) return;
                if (await checkCbtSession()) return;

                // Benar-benar tidak ada sesi dan tidak ada hand-off — CBT dibuka
                // langsung tanpa login. Bersihkan sisa cookie yang mungkin rusak
                // dulu, baru arahkan ke acca-app untuk memulai dari awal.
                isRedirecting = true;
                await clearCbtSession();
                const accaUrl = process.env.NEXT_PUBLIC_ACCA_URL || 'http://localhost:3002';
                window.location.href = `${accaUrl}/login?error=cbt-no-session&v=3&hash=0`;
            }, 1500);
        };
        checkSession();
    }, [router]);

    if (failure) {
        const accaUrl = process.env.NEXT_PUBLIC_ACCA_URL || 'http://localhost:3002';
        return (
            <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
                <div className="bg-white p-8 rounded-lg shadow-sm border border-slate-100 max-w-md w-full text-center">
                    <h1 className="text-xl font-bold text-slate-800 mb-2">{failure.title}</h1>
                    <p className="text-slate-500 mb-6 text-sm leading-relaxed">{failure.message}</p>
                    <button
                        onClick={async () => { setResetting(true); await resetAndRetrySso(); }}
                        disabled={resetting}
                        className="w-full bg-[#030C4D] hover:bg-[#020510] disabled:opacity-50 text-white font-bold py-3 rounded-lg transition-all shadow-sm"
                    >
                        {resetting ? 'Membersihkan…' : 'Bersihkan Sesi & Coba Lagi'}
                    </button>
                    <a
                        href={`${accaUrl}/dashboard`}
                        className="mt-3 block w-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold py-3 rounded-lg transition-all text-sm"
                    >
                        Kembali ke acca-app
                    </a>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-slate-50 flex flex-col items-center justify-center font-sans">
            <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
            <p className="text-slate-600 font-medium animate-pulse">Memeriksa akses...</p>
        </main>
    );
}
