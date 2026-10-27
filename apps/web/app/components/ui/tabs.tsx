'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import './tabs.css';

export interface TabItem<T extends string = string> {
    key: T;
    label: string;
    shortLabel?: string;
    href: string;
    icon?: ReactNode;
    badge?: ReactNode;
    disabled?: boolean;
}

interface TabsProps<T extends string> {
    tabs: TabItem<T>[];
    activeTab: T;
    ariaLabel: string;
    className?: string;
}

/** Route tabs use native links and aria-current so browser history and opening a new tab work. */
export function Tabs<T extends string>({ tabs, activeTab, ariaLabel, className = '' }: TabsProps<T>) {
    return (
        <nav aria-label={ariaLabel} className={`ui-tabs ${className}`}>
            <div className="ui-tabs-list">
                {tabs.map(tab => {
                    const active = tab.key === activeTab;
                    const className = `ui-tabs-item${active ? ' is-active' : ''}`;
                    const content = <>
                        {tab.icon && <span className="ui-tabs-icon" aria-hidden="true">{tab.icon}</span>}
                        <span className="ui-tabs-label">{tab.label}</span>
                        {tab.shortLabel && <span className="ui-tabs-short-label" aria-hidden="true">{tab.shortLabel}</span>}
                        {tab.badge !== undefined && <span className="ui-tabs-badge">{tab.badge}</span>}
                    </>;

                    return tab.disabled ? (
                        <span key={tab.key} className={className} aria-disabled="true">{content}</span>
                    ) : (
                        <Link key={tab.key} href={tab.href} className={className}
                            aria-current={active ? 'page' : undefined} aria-label={tab.label}>
                            {content}
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
