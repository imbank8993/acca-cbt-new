"use client";
import dynamic from 'next/dynamic';
import type { ChartRendererProps } from './ChartRenderer';

type DynamicChartProps = ChartRendererProps;

// Skeleton loading component
function ChartSkeleton({ height = 300 }: { height?: number }) {
    return (
        <div className="animate-pulse" style={{ height }}>
            <div className="flex items-center justify-center h-full">
                <div className="space-y-3 w-full px-4">
                    <div className="h-4 bg-slate-200 rounded w-3/4 mx-auto"></div>
                    <div className="h-40 bg-slate-100 rounded-lg"></div>
                    <div className="flex justify-center gap-2">
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} className="h-3 bg-slate-200 rounded w-16"></div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

const ChartComponent = dynamic<ChartRendererProps>(() => import('./ChartRenderer'), {
    ssr: false,
    loading: () => <ChartSkeleton />,
});

export default function DynamicChart(props: DynamicChartProps) {
    return <ChartComponent {...props} />;
}
