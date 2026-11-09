'use client';

import { useState } from 'react';

export function ExpandableClassList({ classes, prefix = 'Kelas ' }: { classes: string[]; prefix?: string }) {
    const [expanded, setExpanded] = useState(false);
    const visible = expanded ? classes : classes.slice(0, 3);

    return <>
        {prefix}{visible.join(', ')}
        {classes.length > 3 && <>
            {' · '}
            <button type="button" aria-expanded={expanded} onClick={event => {
                event.stopPropagation();
                setExpanded(current => !current);
            }} className="font-semibold text-blue-600 hover:text-blue-800 hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                {expanded ? 'Lebih sedikit' : `Lainnya (${classes.length - 3})`}
            </button>
        </>}
    </>;
}
