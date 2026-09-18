'use client';

interface VideoContentProps {
    url: string;
}

export default function VideoContent({ url }: VideoContentProps) {
    return (
        <div className="flex items-center justify-center h-full bg-black p-4">
            <video
                key={url}
                src={url}
                controls
                className="max-w-full max-h-full rounded-xl outline-none shadow-2xl"
                style={{ maxHeight: 'calc(100vh - 120px)' }}
            />
        </div>
    );
}
