"use client";
import React, { useState, useEffect } from 'react';

interface DynamicChartProps {
    data: any;
    type: 'bar' | 'pie' | 'line';
    height?: number;
}

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

export default function DynamicChart(props: DynamicChartProps) {
    const [ChartComponent, setChartComponent] = useState<React.ComponentType<any> | null>(null);
    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
        setIsClient(true);
        // Lazy load ChartRenderer only when needed
        import('./ChartRenderer').then(module => {
            setChartComponent(() => module.default);
        }).catch(err => {
            console.error('Failed to load ChartRenderer:', err);
        });
    }, []);

    if (!isClient || !ChartComponent) {
        return <ChartSkeleton height={props.height} />;
    }

    return <ChartComponent {...props} />;
}