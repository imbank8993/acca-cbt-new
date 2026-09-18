"use client";
import React from 'react';
import { Skeleton, SkeletonText, SkeletonAvatar } from './Skeleton';

// ─── Card Skeletons ─────────────────────────────────────────

export function CardSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 p-5 space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <Skeleton variant="circular" width={40} height={40} />
        <div className="flex-1 space-y-2">
          <Skeleton height={14} className="w-3/4" />
          <Skeleton height={12} className="w-1/2" />
        </div>
      </div>
      {/* Content */}
      <SkeletonText lines={3} />
      {/* Footer */}
      <div className="flex gap-2 pt-2">
        <Skeleton height={32} className="w-20" variant="rounded" />
        <Skeleton height={32} className="w-24" variant="rounded" />
      </div>
    </div>
  );
}

export function StatCardSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 p-5 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <Skeleton variant="circular" width={40} height={40} />
        <Skeleton height={24} className="w-16" variant="rounded" />
      </div>
      <Skeleton height={32} className="w-1/2 mb-2" />
      <Skeleton height={12} className="w-2/3" />
    </div>
  );
}

// ─── List Skeletons ─────────────────────────────────────────

interface ListItemSkeletonProps {
  avatar?: boolean;
  lines?: number;
  className?: string;
}

export function ListItemSkeleton({ avatar = true, lines = 2, className = '' }: ListItemSkeletonProps) {
  return (
    <div className={`flex items-start gap-3 p-4 ${className}`}>
      {avatar && <SkeletonAvatar size={40} />}
      <div className="flex-1 space-y-2">
        <Skeleton height={14} className="w-3/4" />
        <Skeleton height={12} className={lines > 1 ? 'w-1/2' : 'w-1/3'} />
      </div>
      <Skeleton height={24} className="w-12" variant="rounded" />
    </div>
  );
}

export function ListSkeleton({ items = 5, ...props }: { items?: number } & ListItemSkeletonProps) {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: items }).map((_, i) => (
        <ListItemSkeleton key={i} {...props} />
      ))}
    </div>
  );
}

// ─── Table Skeletons ─────────────────────────────────────────

interface TableSkeletonProps {
  columns?: number;
  rows?: number;
  className?: string;
}

export function TableSkeleton({ columns = 4, rows = 5, className = '' }: TableSkeletonProps) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 overflow-hidden ${className}`}>
      {/* Header */}
      <div className="grid gap-4 px-5 py-4 border-b border-slate-100 bg-slate-50"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} height={14} className="w-full" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="grid gap-4 px-5 py-4 border-b border-slate-50 last:border-0"
          style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
        >
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton key={colIndex} height={14} className="w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Question Card Skeleton (for exam preview) ───────────────

export function QuestionCardSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 overflow-hidden ${className}`}>
      {/* Header */}
      <div className="p-5 border-b border-slate-100 bg-slate-50">
        <div className="flex items-center gap-3">
          <Skeleton height={24} className="w-20" variant="rounded" />
          <Skeleton height={16} className="w-16" />
          <Skeleton height={20} className="w-16" variant="rounded" />
        </div>
      </div>
      {/* Question */}
      <div className="p-5 space-y-3">
        <div className="flex items-start gap-3">
          <Skeleton variant="circular" width={36} height={36} />
          <div className="flex-1 space-y-2">
            <Skeleton height={14} className="w-full" />
            <Skeleton height={14} className="w-4/5" />
            <Skeleton height={14} className="w-2/3" />
          </div>
        </div>
      </div>
      {/* Options */}
      <div className="p-5 space-y-3 border-t border-slate-100">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton variant="rounded" width={32} height={32} />
            <Skeleton height={14} className="flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Exam Page Skeleton ──────────────────────────────────────

export function ExamPageSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`min-h-screen bg-slate-50 ${className}`}>
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton variant="circular" width={36} height={36} />
            <div className="space-y-2">
              <Skeleton height={16} className="w-40" />
              <Skeleton height={12} className="w-20" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Skeleton height={32} className="w-24" variant="rounded" />
            <Skeleton height={40} className="w-20" variant="rounded" />
          </div>
        </div>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <aside className="hidden lg:block w-64 bg-white border-r border-slate-200 p-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Skeleton height={12} className="w-1/2" />
              <div className="grid grid-cols-5 gap-1.5">
                {Array.from({ length: 15 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-square" />
                ))}
              </div>
            </div>
            <Skeleton height={40} className="w-full" variant="rounded" />
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-4 lg:p-6">
          <div className="max-w-2xl mx-auto space-y-4">
            {/* Progress */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <Skeleton height={12} className="w-20" />
                <Skeleton height={12} className="w-12" />
              </div>
              <Skeleton height={6} className="w-full rounded-full" />
            </div>

            {/* Question Cards */}
            <QuestionCardSkeleton />
            <QuestionCardSkeleton />

            {/* Navigation */}
            <div className="flex justify-between">
              <Skeleton height={40} className="w-32" variant="rounded" />
              <Skeleton height={40} className="w-32" variant="rounded" />
            </div>
          </div>
        </main>
      </div>

      {/* Mobile Bottom Bar */}
      <div className="lg:hidden bg-white border-t border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <Skeleton variant="circular" width={40} height={40} />
          <div className="text-center space-y-1">
            <Skeleton height={14} className="w-16" />
            <Skeleton height={10} className="w-12" />
          </div>
          <Skeleton variant="circular" width={40} height={40} />
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard Card Skeleton ────────────────────────────────

export function DashboardSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`space-y-6 ${className}`}>
      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <Skeleton height={16} className="w-1/2 mb-4" />
            <ListSkeleton items={5} avatar={false} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Empty States (with skeleton option) ──────────────────

export function EmptyStateSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center py-12 px-4 text-center ${className}`}>
      <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      </div>
      <Skeleton height={20} className="w-48 mb-2" />
      <Skeleton height={14} className="w-64" />
    </div>
  );
}