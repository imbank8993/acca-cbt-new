'use client';

interface AudioContentProps {
    url: string;
    title?: string;
}

export default function AudioContent({ url, title }: AudioContentProps) {
    return (
        <div className="flex flex-col items-center justify-center h-full bg-[#0f1117] p-8 gap-6">
            {/* Visualizer placeholder - Album art style */}
            <div className="w-32 h-32 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center border border-white/10">
                <i className="bi bi-music-note-beamed text-5xl text-white/30" />
            </div>

            {title && (
                <div className="text-center">
                    <p className="text-white/70 text-sm font-medium m-0">{title}</p>
                    <p className="text-white/30 text-xs mt-1 m-0">Audio Player</p>
                </div>
            )}

            <div className="w-full max-w-md">
                <audio
                    key={url}
                    src={url}
                    controls
                    className="w-full"
                    style={{
                        filter: 'invert(0.85)',
                        borderRadius: '8px',
                    }}
                />
            </div>
        </div>
    );
}
