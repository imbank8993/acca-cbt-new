"use client";
import React, { useEffect, useRef } from 'react';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    LineElement,
    PointElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
    Filler,
} from 'chart.js';
import { Bar, Pie, Line } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    LineElement,
    PointElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

interface ChartData {
    labels: string[];
    datasets: {
        label?: string;
        data: number[];
        backgroundColor?: string | string[];
        borderColor?: string | string[];
        borderWidth?: number;
        fill?: boolean;
        tension?: number;
    }[];
}

interface ChartRendererProps {
    data: ChartData;
    type: 'bar' | 'pie' | 'line';
    height?: number;
}

const getDefaultOptions = (type: 'bar' | 'pie' | 'line') => ({
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
        legend: {
            display: true,
            position: 'bottom' as const,
            labels: {
                boxWidth: 12,
                padding: 15,
                font: { size: 11, family: 'Inter, system-ui, sans-serif' },
                color: '#64748b',
            },
        },
        tooltip: {
            backgroundColor: '#1e293b',
            titleFont: { size: 12, weight: 'bold' as const },
            bodyFont: { size: 11 },
            padding: 10,
            cornerRadius: 8,
        },
    },
    scales: type === 'bar' || type === 'line' ? {
        x: {
            grid: { display: false },
            ticks: { color: '#94a3b8', font: { size: 11 } },
        },
        y: {
            grid: { color: '#f1f5f9' },
            ticks: { color: '#94a3b8', font: { size: 11 } },
        },
    } : undefined,
});

export default function ChartRenderer({ data, type, height = 300 }: ChartRendererProps) {
    if (!data?.labels?.length) {
        return (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm italic">
                Data grafik tidak tersedia
            </div>
        );
    }

    const chartData = {
        labels: data.labels,
        datasets: data.datasets.map((ds) => ({
            ...ds,
            backgroundColor: ds.backgroundColor || [
                '#030C4D', '#0038A8', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16',
            ],
            borderColor: ds.borderColor || ds.backgroundColor || '#030C4D',
            borderWidth: ds.borderWidth ?? (type === 'line' ? 2 : 1),
            tension: ds.tension ?? 0.4,
            fill: ds.fill ?? false,
        })),
    };

    const options = {
        ...getDefaultOptions(type),
        plugins: {
            ...getDefaultOptions(type).plugins,
            legend: {
                ...getDefaultOptions(type).plugins.legend,
                display: type === 'pie' || data.datasets.some(ds => ds.label),
            },
        },
    };

    return (
        <div style={{ height, maxHeight: height, minHeight: 200 }}>
            {type === 'bar' && <Bar data={chartData} options={options} />}
            {type === 'pie' && <Pie data={chartData} options={options} />}
            {type === 'line' && <Line data={chartData} options={options} />}
        </div>
    );
}

// Helper to parse chart data from HTML content
export function parseChartFromHTML(html: string): { type: 'bar' | 'pie' | 'line'; data: ChartData } | null {
    const chartMatch = html.match(/data-chart-type="([^"]+)"/);
    const dataMatch = html.match(/data-chart-labels="([^"]+)"/);
    const valuesMatch = html.match(/data-chart-values="([^"]+)"/);

    if (!chartMatch) return null;

    const type = chartMatch[1] as 'bar' | 'pie' | 'line';
    const labels = dataMatch ? JSON.parse(decodeURIComponent(dataMatch[1])) : [];
    const values = valuesMatch ? JSON.parse(decodeURIComponent(valuesMatch[1])) : [];

    return {
        type,
        data: {
            labels,
            datasets: [{ data: values }],
        },
    };
}

// Helper to generate chart HTML for editor
export function generateChartHTML(type: 'bar' | 'pie' | 'line', labels: string[], values: number[]): string {
    return `<div class="chart-embed" data-chart-type="${type}" data-chart-labels="${encodeURIComponent(JSON.stringify(labels))}" data-chart-values="${encodeURIComponent(JSON.stringify(values))}"><p style="text-align:center;color:#94a3b8;font-size:0.8rem">[Grafik ${type}]</p></div>`;
}