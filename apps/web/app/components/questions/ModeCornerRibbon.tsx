import './mode-corner-ribbon.css';

export function ModeCornerRibbon({ mode }: { mode: 'validation' | 'preview' }) {
    return <div className="mode-corner-ribbon" aria-label={mode === 'validation' ? 'Mode validasi' : 'Mode pratinjau'}>
        <span>{mode === 'validation' ? 'VALIDASI' : 'PRATINJAU'}</span>
    </div>;
}
