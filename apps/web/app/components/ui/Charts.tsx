"use client";
import React from 'react';
import { TrendingUp, TrendingDown, Minus, Users, Clock, Target, Award, FileText } from 'lucide-react';
import { Skeleton } from './Skeleton';

// ─── Stat Card Component ─────────────────────────────────────

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: {
    value: number;
    direction: 'up' | 'down' | 'neutral';
  };
  className?: string;
  loading?: boolean;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  className = '',
  loading = false,
}: StatCardProps) {
  const trendColors = {
    up: 'text-emerald-600 bg-emerald-50',
    down: 'text-red-600 bg-red-50',
    neutral: 'text-slate-600 bg-slate-50',
  };

  const TrendIcon = trend?.direction === 'up' ? TrendingUp : trend?.direction === 'down' ? TrendingDown : Minus;

  if (loading) {
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

  return (
    <div className={`bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-md transition-shadow ${className}`}>
      <div className="flex items-center justify-between mb-3">
        {icon && (
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600">
            {icon}
          </div>
        )}
        {trend && (
          <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${trendColors[trend.direction]}`}>
            <TrendIcon size={12} />
            <span>{trend.value > 0 ? '+' : ''}{trend.value}%</span>
          </div>
        )}
      </div>
      <h3 className="text-2xl font-bold text-slate-800 mb-1">{value}</h3>
      <p className="text-sm text-slate-500">{title}</p>
      {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
    </div>
  );
}

// ─── Pre-built Stat Cards ──────────────────────────────────

export function TotalStudentsCard({ value, trend, loading }: StatCardProps) {
  return (
    <StatCard
      title="Total Siswa"
      value={value ?? 0}
      icon={<Users size={20} />}
      trend={trend}
      loading={loading}
    />
  );
}

export function ActiveExamsCard({ value, trend, loading }: StatCardProps) {
  return (
    <StatCard
      title="Ujian Aktif"
      value={value ?? 0}
      icon={<Clock size={20} />}
      trend={trend}
      loading={loading}
    />
  );
}

export function AverageScoreCard({ value, trend, loading }: StatCardProps) {
  return (
    <StatCard
      title="Rata-rata Nilai"
      value={`${value ?? 0}%`}
      icon={<Target size={20} />}
      trend={trend}
      loading={loading}
    />
  );
}

export function CompletionRateCard({ value, trend, loading }: StatCardProps) {
  return (
    <StatCard
      title="Tingkat Penyelesaian"
      value={`${value ?? 0}%`}
      icon={<Award size={20} />}
      trend={trend}
      loading={loading}
    />
  );
}

export function TotalAttemptsCard({ value, loading }: Omit<StatCardProps, 'title'>) {
  return (
    <StatCard
      title="Total Percobaan"
      value={value ?? 0}
      icon={<FileText size={20} />}
      loading={loading}
    />
  );
}

// ─── Stats Grid ─────────────────────────────────────────────

interface StatsGridProps {
  children: React.ReactNode;
  className?: string;
}

export function StatsGrid({ children, className = '' }: StatsGridProps) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 ${className}`}>
      {children}
    </div>
  );
}

// ─── Simple Bar Chart ────────────────────────────────────────

interface BarChartData {
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: BarChartData[];
  maxValue?: number;
  height?: number;
  showLabels?: boolean;
  className?: string;
}

export function BarChart({
  data,
  maxValue,
  height = 200,
  showLabels = true,
  className = '',
}: BarChartProps) {
  const max = maxValue ?? Math.max(...data.map(d => d.value), 1);

  return (
    <div className={`space-y-2 ${className}`}>
      {data.map((item, index) => {
        const percentage = (item.value / max) * 100;
        return (
          <div key={index} className="space-y-1">
            {showLabels && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-600">{item.label}</span>
                <span className="text-slate-400 font-medium">{item.value}</span>
              </div>
            )}
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  item.color ?? 'bg-primary'
                }`}
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Horizontal Bar Chart (for score distribution) ──────────

interface HorizontalBarChartProps {
  data: { range: string; count: number; percentage: number }[];
  className?: string;
}

export function HorizontalBarChart({ data, className = '' }: HorizontalBarChartProps) {
  const maxCount = Math.max(...data.map(d => d.count), 1);

  return (
    <div className={`space-y-2 ${className}`}>
      {data.map((item, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-12 text-xs text-slate-500 font-medium">{item.range}</div>
          <div className="flex-1 h-6 bg-slate-100 rounded-lg overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary to-primary/70 rounded-lg transition-all duration-500 flex items-center justify-end pr-2"
              style={{ width: `${(item.count / maxCount) * 100}%` }}
            >
              <span className="text-xs text-white font-medium">{item.count}</span>
            </div>
          </div>
          <div className="w-12 text-xs text-slate-400 text-right">{item.percentage}%</div>
        </div>
      ))}
    </div>
  );
}

// ─── Pie Chart (Simple) ─────────────────────────────────────

interface PieChartData {
  label: string;
  value: number;
  color: string;
}

interface PieChartProps {
  data: PieChartData[];
  size?: number;
  className?: string;
}

export function PieChart({ data, size = 200, className = '' }: PieChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  let currentAngle = -90;

  const getCoordinatesForAngle = (angle: number, radius: number) => {
    const rad = (angle * Math.PI) / 180;
    return {
      x: radius * Math.cos(rad) + radius,
      y: radius * Math.sin(rad) + radius,
    };
  };

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <svg width={size * 2} height={size * 2} className="transform -rotate-90">
        {data.map((item, i) => {
          const percentage = item.value / total;
          const angle = percentage * 360;
          const startAngle = currentAngle;
          const endAngle = currentAngle + angle;

          const start = getCoordinatesForAngle(startAngle, size);
          const end = getCoordinatesForAngle(endAngle, size);

          const largeArcFlag = angle > 180 ? 1 : 0;

          const pathD = [
            `M ${size} ${size}`,
            `L ${start.x} ${start.y}`,
            `A ${size} ${size} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`,
            'Z',
          ].join(' ');

          currentAngle = endAngle;

          return (
            <path
              key={i}
              d={pathD}
              fill={item.color}
              className="transition-all duration-300 hover:opacity-80 cursor-pointer"
            >
              <title>{item.label}: {item.value} ({Math.round(percentage * 100)}%)</title>
            </path>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-4 mt-4 justify-center">
        {data.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="text-xs text-slate-600">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Score Distribution Chart ────────────────────────────────

interface ScoreDistributionChartProps {
  data: {
    range: string;
    count: number;
    percentage: number;
  }[];
  className?: string;
}

export function ScoreDistributionChart({ data, className = '' }: ScoreDistributionChartProps) {
  const maxCount = Math.max(...data.map(d => d.count), 1);

  return (
    <div className={`space-y-1 ${className}`}>
      <div className="h-40 flex items-end gap-1">
        {data.map((item, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full bg-gradient-to-t from-primary to-primary/60 rounded-t transition-all duration-500 hover:from-primary/80"
              style={{ height: `${(item.count / maxCount) * 100}%`, minHeight: item.count > 0 ? '4px' : '0' }}
              title={`${item.range}: ${item.count} siswa (${item.percentage}%)`}
            />
            <span className="text-[10px] text-slate-400">{item.range}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Progress Ring ──────────────────────────────────────────

interface ProgressRingProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  bgColor?: string;
  showLabel?: boolean;
  className?: string;
}

export function ProgressRing({
  value,
  max = 100,
  size = 80,
  strokeWidth = 8,
  color = '#6366f1',
  bgColor = '#e2e8f0',
  showLabel = true,
  className = '',
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const percentage = Math.min((value / max) * 100, 100);
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={bgColor}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      {showLabel && (
        <span className="absolute text-sm font-bold text-slate-800">
          {Math.round(percentage)}%
        </span>
      )}
    </div>
  );
}

// ─── Legend Component ────────────────────────────────────────

interface LegendItem {
  label: string;
  color: string;
  value?: number;
}

interface LegendProps {
  items: LegendItem[];
  className?: string;
}

export function Legend({ items, className = '' }: LegendProps) {
  return (
    <div className={`flex flex-wrap gap-4 ${className}`}>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: item.color }} />
          <span className="text-xs text-slate-600">
            {item.label}
            {item.value !== undefined && <span className="text-slate-400 ml-1">({item.value})</span>}
          </span>
        </div>
      ))}
    </div>
  );
}