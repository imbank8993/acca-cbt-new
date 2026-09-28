"use client";

import { useClientMounted } from '@/hooks/useClientMounted';
import { AlertCircle } from 'lucide-react';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { usePathname } from 'next/navigation';
import React from 'react';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400', '600', '800'] });

export default function MaintenanceProvider({ 
    isMaintenance, 
    children 
}: { 
    isMaintenance: boolean, 
    children: React.ReactNode 
}) {
    const pathname = usePathname() || '';
    const mounted = useClientMounted();

    // Prevent hydration mismatch by returning empty or children until mounted
    if (!mounted) {
        return <>{children}</>;
    }

    // Allow admins to login and access settings to turn off maintenance mode
    const isBypassRoute = pathname.startsWith('/dashboard/admin') || 
                          pathname === '/' || 
                          pathname.startsWith('/update-password') ||
                          pathname.startsWith('/api') ||
                          pathname.startsWith('/dashboard/settings'); // just in case

    if (isMaintenance && !isBypassRoute) {
        return (
            <div className={`min-h-screen flex items-center justify-center bg-[#f1f5f9] p-4 ${jakarta.className}`}>
                <div className="bg-white rounded-3xl shadow-xl p-10 max-w-lg w-full text-center border border-[#e2e8f0]">
                    <div className="w-20 h-20 bg-rose-50 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner">
                        <AlertCircle className="w-10 h-10 text-rose-500" />
                    </div>
                    <h1 className="text-3xl font-extrabold text-[#3083FF] mb-4">Under Maintenance</h1>
                    <p className="text-slate-500 mb-8 leading-relaxed">
                        Sistem kami saat ini sedang dalam pemeliharaan rutin untuk meningkatkan layanan. Silakan kembali beberapa saat lagi.
                    </p>
                    
                    <div className="w-full bg-slate-50 rounded-xl p-4 text-xs font-semibold text-slate-400 border border-slate-100 flex items-center justify-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></div>
                        Mohon maaf atas ketidaknyamanan ini
                    </div>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}
