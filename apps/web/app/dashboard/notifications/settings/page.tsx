"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
    Bell,
    Mail,
    Smartphone,
    Clock,
    Check,
    AlertCircle,
    Loader2,
    Save,
    RefreshCw
} from 'lucide-react';
import { getSessionUser } from '@/lib/session';
import {
    getNotificationPreferences,
    updateNotificationPreferences
} from '@/lib/api/notifications';
import type { NotificationPreferences } from '@/app/types/notification';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/app/types/notification';
import { useMemoryState } from '@/lib/useMemoryState';

export default function NotificationSettingsPage() {
    const [user, setUser] = useState<any>(null);
    const [preferences, setPreferences] = useState<Partial<NotificationPreferences>>({});
    const [isLoading, setIsLoading] = useMemoryState('notifications_settings_isLoading', true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch user and preferences
    const fetchData = useCallback(async () => {
        const user = await getSessionUser();
        setUser(user);

        if (user) {
            const prefs = await getNotificationPreferences();
            if (prefs) {
                setPreferences(prefs);
            } else {
                setPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
            }
        }
        setIsLoading(false);
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Handle toggle
    const handleToggle = (key: keyof NotificationPreferences) => {
        setPreferences(prev => ({
            ...prev,
            [key]: !prev[key]
        }));
    };

    // Handle minutes change
    const handleMinutesChange = (value: number) => {
        setPreferences(prev => ({
            ...prev,
            exam_reminder_minutes: value
        }));
    };

    // Handle save
    const handleSave = async () => {
        if (!user) return;

        setIsSaving(true);
        setError(null);
        setSaveSuccess(false);

        try {
            const result = await updateNotificationPreferences(preferences);
            if (result.success) {
                setSaveSuccess(true);
                setTimeout(() => setSaveSuccess(false), 3000);
            } else {
                setError(result.error || 'Gagal menyimpan pengaturan');
            }
        } catch (err: any) {
            setError(err.message || 'Terjadi kesalahan');
        }

        setIsSaving(false);
    };

    // Quick time options
    const timeOptions = [
        { value: 15, label: '15 menit' },
        { value: 30, label: '30 menit' },
        { value: 60, label: '1 jam' },
        { value: 120, label: '2 jam' },
        { value: 1440, label: '1 hari' },
    ];

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 size={32} className="animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-2xl mx-auto px-4 py-6">
                    <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <Bell size={22} className="text-primary" />
                        Pengaturan Notifikasi
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Atur bagaimana Anda menerima notifikasi
                    </p>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
                {/* Success/Error Messages */}
                {saveSuccess && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl flex items-center gap-3"
                    >
                        <Check size={20} />
                        Pengaturan berhasil disimpan
                    </motion.div>
                )}

                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center gap-3"
                    >
                        <AlertCircle size={20} />
                        {error}
                    </motion.div>
                )}

                {/* Channel Preferences */}
                <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100">
                        <h2 className="font-bold text-slate-800">Saluran Notifikasi</h2>
                        <p className="text-sm text-slate-500 mt-1">Pilih bagaimana Anda ingin menerima notifikasi</p>
                    </div>
                    <div className="p-6 space-y-4">
                        {/* Email */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                                    <Mail size={20} className="text-blue-600" />
                                </div>
                                <div>
                                    <p className="font-medium text-slate-800">Email</p>
                                    <p className="text-sm text-slate-500">Terima notifikasi via email</p>
                                </div>
                            </div>
                            <button
                                onClick={() => handleToggle('email_enabled')}
                                className={`relative w-12 h-7 rounded-full transition-colors ${
                                    preferences.email_enabled ? 'bg-primary' : 'bg-slate-300'
                                }`}
                            >
                                <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                                    preferences.email_enabled ? 'translate-x-6' : 'translate-x-1'
                                }`} />
                            </button>
                        </div>

                        {/* Push */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                                    <Smartphone size={20} className="text-emerald-600" />
                                </div>
                                <div>
                                    <p className="font-medium text-slate-800">Push Notification</p>
                                    <p className="text-sm text-slate-500">Terima notifikasi di browser</p>
                                </div>
                            </div>
                            <button
                                onClick={() => handleToggle('push_enabled')}
                                className={`relative w-12 h-7 rounded-full transition-colors ${
                                    preferences.push_enabled ? 'bg-primary' : 'bg-slate-300'
                                }`}
                            >
                                <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                                    preferences.push_enabled ? 'translate-x-6' : 'translate-x-1'
                                }`} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Notification Types */}
                <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100">
                        <h2 className="font-bold text-slate-800">Jenis Notifikasi</h2>
                        <p className="text-sm text-slate-500 mt-1">Pilih notifikasi yang ingin Anda terima</p>
                    </div>
                    <div className="p-6 space-y-4">
                        {/* Exam Reminder */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                                    <Bell size={20} className="text-amber-600" />
                                </div>
                                <div>
                                    <p className="font-medium text-slate-800">Pengingat Ujian</p>
                                    <p className="text-sm text-slate-500">Notifikasi sebelum ujian dimulai</p>
                                </div>
                            </div>
                            <button
                                onClick={() => handleToggle('exam_reminder')}
                                className={`relative w-12 h-7 rounded-full transition-colors ${
                                    preferences.exam_reminder ? 'bg-primary' : 'bg-slate-300'
                                }`}
                            >
                                <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                                    preferences.exam_reminder ? 'translate-x-6' : 'translate-x-1'
                                }`} />
                            </button>
                        </div>

                        {/* Reminder Timing */}
                        {preferences.exam_reminder && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                className="ml-13 pl-4 border-l-2 border-primary/20"
                            >
                                <p className="text-sm text-slate-600 mb-2 flex items-center gap-2">
                                    <Clock size={14} />
                                    Kirim pengingat sebelum:
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {timeOptions.map(option => (
                                        <button
                                            key={option.value}
                                            onClick={() => handleMinutesChange(option.value)}
                                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                                preferences.exam_reminder_minutes === option.value
                                                    ? 'bg-primary text-white'
                                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                            }`}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            </motion.div>
                        )}

                        <div className="border-t border-slate-100 pt-4 space-y-4">
                            {/* Class Updates */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
                                        <RefreshCw size={20} className="text-purple-600" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-slate-800">Update Kelas</p>
                                        <p className="text-sm text-slate-500">Notifikasi perubahan di kelas</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleToggle('class_updates')}
                                    className={`relative w-12 h-7 rounded-full transition-colors ${
                                        preferences.class_updates ? 'bg-primary' : 'bg-slate-300'
                                    }`}
                                >
                                    <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                                        preferences.class_updates ? 'translate-x-6' : 'translate-x-1'
                                    }`} />
                                </button>
                            </div>

                            {/* Results */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-cyan-100 flex items-center justify-center">
                                        <Bell size={20} className="text-cyan-600" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-slate-800">Hasil Ujian</p>
                                        <p className="text-sm text-slate-500">Notifikasi saat hasil tersedia</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleToggle('results_notifications')}
                                    className={`relative w-12 h-7 rounded-full transition-colors ${
                                        preferences.results_notifications ? 'bg-primary' : 'bg-slate-300'
                                    }`}
                                >
                                    <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                                        preferences.results_notifications ? 'translate-x-6' : 'translate-x-1'
                                    }`} />
                                </button>
                            </div>

                            {/* Achievements */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-yellow-100 flex items-center justify-center">
                                        <Bell size={20} className="text-yellow-600" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-slate-800">Pencapaian</p>
                                        <p className="text-sm text-slate-500">Notifikasi prestasi dan badges</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleToggle('achievement_notifications')}
                                    className={`relative w-12 h-7 rounded-full transition-colors ${
                                        preferences.achievement_notifications ? 'bg-primary' : 'bg-slate-300'
                                    }`}
                                >
                                    <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                                        preferences.achievement_notifications ? 'translate-x-6' : 'translate-x-1'
                                    }`} />
                                </button>
                            </div>

                            {/* Marketing */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-pink-100 flex items-center justify-center">
                                        <Bell size={20} className="text-pink-600" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-slate-800">Promosi & Info</p>
                                        <p className="text-sm text-slate-500">Berita dan informasi terbaru</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleToggle('marketing_notifications')}
                                    className={`relative w-12 h-7 rounded-full transition-colors ${
                                        preferences.marketing_notifications ? 'bg-primary' : 'bg-slate-300'
                                    }`}
                                >
                                    <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                                        preferences.marketing_notifications ? 'translate-x-6' : 'translate-x-1'
                                    }`} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Save Button */}
                <div className="flex justify-end">
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-6 py-3 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-colors flex items-center gap-2 shadow-lg shadow-primary/25 disabled:opacity-50"
                    >
                        {isSaving ? (
                            <Loader2 size={18} className="animate-spin" />
                        ) : (
                            <Save size={18} />
                        )}
                        Simpan Pengaturan
                    </button>
                </div>
            </div>
        </div>
    );
}
