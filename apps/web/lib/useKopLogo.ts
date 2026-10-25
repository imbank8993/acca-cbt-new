"use client";

import { useEffect, useState } from 'react';
import { loadKopLogo, type KopLogo } from './school-logo';

/** Logo kop sebagai PNG data URL untuk pratinjau dan halaman cetak; `null` selama dimuat atau bila tidak ada. */
export function useKopLogo(logoUrl: string | null | undefined): KopLogo | null {
    const url = (logoUrl || '').trim();
    const [loaded, setLoaded] = useState<{ url: string; logo: KopLogo | null }>({ url: '', logo: null });

    useEffect(() => {
        if (!url) return;
        let active = true;
        void loadKopLogo(url).then(logo => { if (active) setLoaded({ url, logo }); });
        return () => { active = false; };
    }, [url]);

    return loaded.url === url ? loaded.logo : null;
}
