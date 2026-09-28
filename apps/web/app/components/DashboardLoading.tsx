"use client";
import { Spinner } from '@/app/components/ui/Spinner';

export default function DashboardLoading() {
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] w-full">
            <Spinner variant="buble" size={32} />
        </div>
    );
}
