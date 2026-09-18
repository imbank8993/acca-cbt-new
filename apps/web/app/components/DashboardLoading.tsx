"use client";
import React from 'react';

export default function DashboardLoading() {
    return (
        <div className="animate-pulse">
            {/* Header Banner Skeleton */}
            <div className="relative overflow-hidden bg-slate-200 rounded-2xl p-5 md:p-6 mb-8 h-36"></div>

            {/* Stats Grid Skeleton */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-white rounded-2xl p-6 border border-slate-100">
                        <div className="flex items-start justify-between mb-5">
                            <div className="w-12 h-12 bg-slate-100 rounded-xl"></div>
                            <div className="w-5 h-5 bg-slate-100 rounded"></div>
                        </div>
                        <div className="h-3 bg-slate-100 rounded w-24 mb-3"></div>
                        <div className="h-8 bg-slate-100 rounded w-20"></div>
                    </div>
                ))}
            </div>

            {/* Content Grid Skeleton */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
                {[1, 2].map((i) => (
                    <div key={i} className="bg-white rounded-2xl p-6 border border-slate-100">
                        <div className="h-4 bg-slate-100 rounded w-32 mb-4"></div>
                        <div className="space-y-3">
                            {[1, 2, 3].map((j) => (
                                <div key={j} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                                    <div className="w-10 h-10 bg-slate-200 rounded-lg"></div>
                                    <div className="flex-1">
                                        <div className="h-3 bg-slate-200 rounded w-3/4 mb-2"></div>
                                        <div className="h-2 bg-slate-200 rounded w-1/2"></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
