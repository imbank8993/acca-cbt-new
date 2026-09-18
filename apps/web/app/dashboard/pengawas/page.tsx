"use client";
import React from 'react';
import { motion } from 'framer-motion';
import {
    ShieldAlert,
    Eye,
    MapPin,
    Activity,
    AlertTriangle,
    Radio
} from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function PengawasDashboard() {
    const router = useRouter();
    return (
        <div className="space-y-12">
            <header className="flex justify-between items-end">
                <div>
                    <h1 className="text-4xl font-black text-white tracking-tight mb-2">Live Supervision</h1>
                    <p className="text-slate-500 font-medium">Pemantauan Real-time Sesi Ujian.</p>
                </div>
                <div className="flex items-center gap-4 bg-rose-500/10 px-6 py-3 rounded-2xl border border-rose-500/20">
                    <Radio size={20} className="text-rose-500 animate-pulse" />
                    <span className="text-rose-500 font-black text-sm uppercase tracking-widest">Active Session</span>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                {[
                    { label: 'Active Students', value: '42', icon: Activity, color: 'text-primary-light' },
                    { label: 'Violations', value: '2', icon: AlertTriangle, color: 'text-rose-400' },
                    { label: 'Rooms', value: '2', icon: MapPin, color: 'text-emerald-400' },
                    { label: 'System Health', value: '98%', icon: ShieldAlert, color: 'text-amber-400' },
                ].map((stat, i) => (
                    <div key={i} className="bg-slate-900/50 border border-slate-800 p-8 rounded-3xl">
                        <stat.icon className={`${stat.color} mb-4`} size={24} />
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">{stat.label}</p>
                        <p className="text-3xl font-black text-white">{stat.value}</p>
                    </div>
                ))}
            </div>

            <div className="bg-slate-900/50 border border-slate-800 rounded-[2.5rem] p-10">
                <div className="flex items-center justify-between mb-10">
                    <h2 className="text-2xl font-black text-white">Security Feed</h2>
                    <button onClick={() => router.push('/dashboard/pengawas/monitoring')} className="bg-slate-800 hover:bg-slate-700 text-white font-bold px-6 py-3 rounded-xl transition-all">
                        <Eye size={18} className="inline mr-2" /> Show All
                    </button>
                </div>

                <div className="space-y-4">
                    {[
                        { user: 'Budi Santoso', event: 'Tab Switch Detected', time: '14:20:05', severity: 'High' },
                        { user: 'Siti Aminah', event: 'Connection Lost', time: '14:18:22', severity: 'Medium' },
                    ].map((log, i) => (
                        <div key={i} className="flex items-center justify-between p-6 bg-slate-800/30 rounded-3xl border border-white/5 group hover:bg-slate-800/50 transition-all">
                            <div className="flex items-center gap-6">
                                <div className={`w-3 h-3 rounded-full ${log.severity === 'High' ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]' : 'bg-amber-500'}`}></div>
                                <div>
                                    <p className="font-black text-white">{log.user}</p>
                                    <p className="text-sm text-slate-400 font-medium">{log.event}</p>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-xs font-black text-slate-500 uppercase mb-1">{log.time}</p>
                                <button onClick={() => router.push('/dashboard/pengawas/monitoring')} className="text-xs font-bold text-primary-light hover:underline">Investigate</button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
