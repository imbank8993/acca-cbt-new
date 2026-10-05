"use client";
import { Spinner } from '@/app/components/ui/Spinner';
import { clearActiveRoleInStorage,getDashboardPath,lockActiveRole,setActiveRoleInStorage,type Role } from '@/lib/rbac';
import { clearCbtSession,resetAndRetrySso } from '@/lib/session-reset';
import { clearSessionCache,fetchSessionUser } from '@/lib/session';
import { clearMemoryCache } from '@/lib/useMemoryState';
import { useRouter } from 'next/navigation';
import { useEffect,useState } from 'react';

type SsoFailure = { title: string; message: string; retryOnly?: boolean };

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
        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;

        // Authoritative role forwarded by the acca-app SSO hand-off (?sso_role=).
        // It is fresh (derived from acca-app's users table) and lets us skip the
        // slow DB role lookup entirely — the main cause of the long wait.
        const VALID_SSO_ROLES = ['Superadmin', 'Admin', 'Proktor', 'Guru', 'Pengawas', 'Siswa'];
        const ssoRoleParam = new URLSearchParams(window.location.search).get('sso_role') || '';
        const ssoRole = (VALID_SSO_ROLES.includes(ssoRoleParam) ? ssoRoleParam : null) as Role | null;

        // Jika baru berpindah dari sistem induk via SSO, bersihkan seluruh jejak peran
        // dan memori pengguna sebelumnya di peramban ini agar akun tidak tertukar.
        if (ssoRoleParam) {
            clearSessionCache();
            try {
                clearActiveRoleInStorage();
                clearMemoryCache();
            } catch {}
        }

        const fail = (title: string, message: string, retryOnly = false) => {
            if (cancelled) return;
            isRedirecting = true;
            setFailure({ title, message, retryOnly });
        };

        /**
         * Sesi CBT sendiri: cookie httpOnly `cbt_session` yang diterbitkan
         * `/api/auth/sso`. Tokennya tidak bisa dibaca JavaScript, jadi satu-
         * satunya cara memeriksanya adalah bertanya ke server.
         */
        const checkCbtSession = async (): Promise<boolean> => {
            try {
                const body = await fetchSessionUser();
                if (cancelled) return true;
                if (!body) return false;

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
                fail('Sesi belum dapat diperiksa',
                    'Server atau koneksi sedang bermasalah. Sesi Anda tetap disimpan. Silakan coba lagi.', true);
                return true;
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

            // Konfirmasi respons 401 sebelum menghapus sesi. Gangguan sementara
            // pada percobaan mana pun menampilkan retry tanpa logout.
            retryTimer = setTimeout(async () => {
                if (cancelled || settled || isRedirecting) return;
                if (await checkCbtSession()) return;

                if (ssoRoleParam) {
                    fail('Sesi CBT belum tersimpan',
                        'Proses masuk dari ACCA selesai, tetapi cookie sesi CBT belum terbaca. Pastikan alamat menggunakan HTTPS dan cookie situs diizinkan, lalu coba masuk kembali.');
                    return;
                }

                // Benar-benar tidak ada sesi dan tidak ada hand-off — CBT dibuka
                // langsung tanpa login. Bersihkan sisa cookie yang mungkin rusak
                // dulu, baru arahkan ke acca-app untuk memulai dari awal.
                isRedirecting = true;
                await clearCbtSession();
                if (cancelled) return;
                const accaUrl = process.env.NEXT_PUBLIC_ACCA_URL || 'https://acca.icgowa.sch.id';
                window.location.href = `${accaUrl}/login?error=cbt-no-session&v=3&hash=0`;
            }, 1500);
        };
        checkSession();
        return () => {
            cancelled = true;
            if (retryTimer) clearTimeout(retryTimer);
        };
    }, [router]);

    if (failure) {
        const accaUrl = process.env.NEXT_PUBLIC_ACCA_URL || 'https://acca.icgowa.sch.id';
        return (
            <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
                <div className="bg-white p-8 rounded-lg shadow-sm border border-slate-100 max-w-md w-full text-center">
                    <h1 className="text-xl font-bold text-slate-800 mb-2">{failure.title}</h1>
                    <p className="text-slate-500 mb-6 text-sm leading-relaxed">{failure.message}</p>
                    <button
                        onClick={async () => {
                            if (failure.retryOnly) { window.location.reload(); return; }
                            setResetting(true);
                            await resetAndRetrySso();
                        }}
                        disabled={resetting}
                        className="w-full bg-[#3083FF] hover:bg-[#2563EB] disabled:opacity-50 text-white font-bold py-3 rounded-lg transition-all shadow-sm"
                    >
                        {failure.retryOnly ? 'Coba Lagi' : resetting ? 'Membersihkan…' : 'Bersihkan Sesi & Coba Lagi'}
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
            <Spinner variant="buble" size={32} />
            <p className="text-slate-600 font-medium mt-4">Memeriksa akses...</p>
        </main>
    );
}
