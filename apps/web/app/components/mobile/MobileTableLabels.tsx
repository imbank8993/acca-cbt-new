'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/** Use the real column headings as labels when a data table becomes cards. */
export function MobileTableLabels() {
    const pathname = usePathname();

    useEffect(() => {
        // Modals render through a portal under <body>, outside .dashboard-main.
        const root = document.body;

        let frame = 0;
        const sync = () => {
            frame = 0;
            root.querySelectorAll<HTMLTableElement>('table.mobile-data-cards').forEach(table => {
                const header = table.tHead?.rows[table.tHead.rows.length - 1];
                if (!header) return;
                const labels = Array.from(header.cells, cell => cell.textContent?.trim().replace(/\s+/g, ' ') || 'Aksi');
                Array.from(table.tBodies).forEach(body => {
                    Array.from(body.rows).forEach(row => {
                        if (row.cells.length !== labels.length) return;
                        Array.from(row.cells).forEach((cell, index) => {
                            if (!cell.hasAttribute('data-mobile-label')) cell.setAttribute('data-mobile-label', labels[index]);
                        });
                    });
                });
            });
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
        const observer = new MutationObserver(records => {
            if (records.some(record =>
                (record.target instanceof Element && record.target.closest('table.mobile-data-cards')) ||
                Array.from(record.addedNodes).some(node => node instanceof Element &&
                    (node.matches('table.mobile-data-cards') || node.querySelector('table.mobile-data-cards')))
            )) schedule();
        });
        observer.observe(root, { childList: true, subtree: true });
        schedule();
        return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
    }, [pathname]);

    return null;
}
