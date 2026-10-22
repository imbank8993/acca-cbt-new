'use client';
import { useEffect } from 'react';
import { clearSessionCache } from '@/lib/session';
import { clearActiveRoleInStorage } from '@/lib/rbac';

/** A public cookie is only an event signal; never a credential or a permission. */
export function SingleLogoutListener() {
    useEffect(() => {
        const read = () => document.cookie.split('; ').find(part => part.startsWith('acca_logout_at=')) || '';
        const previous = read();
        let closing = false;
        const check = async () => {
            if (!window.location.pathname.startsWith('/dashboard')) return;
            if (!read() || read() === previous || closing) return;
            closing = true;
            try {
                const response = await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(10000) });
                if (!response.ok) throw new Error('Logout failed');
                clearSessionCache();
                try { clearActiveRoleInStorage(); } catch { /* Browser storage may be blocked. */ }
                window.location.replace(new URL('/login?logged_out=1', process.env.NEXT_PUBLIC_ACCA_URL || 'https://acca.icgowa.sch.id').toString());
            } catch { closing = false; }
        };
        const timer = setInterval(check, 2000);
        window.addEventListener('focus', check);
        document.addEventListener('visibilitychange', check);
        return () => { clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
    }, []);
    return null;
}
