"use client";
import React from 'react';
import { motion } from 'framer-motion';

// ─── Base Skeleton Component ───────────────────────────────

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular' | 'rounded';
  width?: string | number;
  height?: string | number;
  animation?: 'pulse' | 'wave' | 'none';
}

const variantClasses = {
  text: 'rounded',
  circular: 'rounded-full',
  rectangular: 'rounded-none',
  rounded: 'rounded-xl',
};

export function Skeleton({
  className = '',
  variant = 'rounded',
  width,
  height,
  animation = 'pulse',
}: SkeletonProps) {
  const animationClass = animation === 'pulse'
    ? 'animate-pulse bg-slate-200'
    : animation === 'wave'
    ? 'skeleton-wave'
    : 'bg-slate-200';

  return (
    <div
      className={`${variantClasses[variant]} ${animationClass} ${className}`}
      style={{
        width: width ?? undefined,
        height: height ?? undefined,
      }}
    />
  );
}

// ─── Skeleton with Animation Variants ─────────────────────

export function SkeletonPulse({ className = '', ...props }: SkeletonProps) {
  return <Skeleton {...props} className={`animate-pulse bg-slate-200 ${className}`} />;
}

export function SkeletonWave({ className = '', ...props }: SkeletonProps) {
  return (
    <div className={`relative overflow-hidden ${className}`} {...props}>
      <Skeleton />
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
      <style jsx>{`
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
        .animate-\[shimmer_2s_infinite\] {
          animation: shimmer 2s infinite;
        }
      `}</style>
    </div>
  );
}

// ─── Text Skeleton Lines ──────────────────────────────────

interface SkeletonTextProps {
  lines?: number;
  className?: string;
  lastLineWidth?: string;
}

export function SkeletonText({ lines = 3, className = '', lastLineWidth = '60%' }: SkeletonTextProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          height={16}
          className={i === lines - 1 ? lastLineWidth : 'w-full'}
        />
      ))}
    </div>
  );
}

// ─── Utility Components ─────────────────────────────────────

export function SkeletonAvatar({ size = 40 }: { size?: number }) {
  return <Skeleton variant="circular" width={size} height={size} />;
}

export function SkeletonButton({ className = '' }: { className?: string }) {
  return <Skeleton variant="rounded" height={40} className={`w-24 ${className}`} />;
}

export function SkeletonBadge({ className = '' }: { className?: string }) {
  return <Skeleton variant="rounded" height={24} className={`w-16 ${className}`} />;
}