export type HtmlMenuItem = { id: string; label: string; active: boolean; group?: string };
export type HtmlNavigationProps = {
    onMenuChange?: (items: HtmlMenuItem[]) => void;
    navigationRequest?: { id: string; sequence: number };
};

export function readHtmlMenu(value: unknown): HtmlMenuItem[] | null {
    if (!Array.isArray(value) || value.length > 80) return null;
    const ids = new Set<string>();
    const result: HtmlMenuItem[] = [];
    for (const item of value) {
        if (!item || typeof item.id !== 'string' || !/^menu-\d{1,6}$/.test(item.id) || ids.has(item.id)
            || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 120 || typeof item.active !== 'boolean' || (item.group !== undefined && (typeof item.group !== 'string' || item.group.length > 120))) return null;
        ids.add(item.id);
        result.push({ id: item.id, label: item.label, active: item.active, ...(item.group ? { group: item.group } : {}) });
    }
    return result;
}

export function learningNavigationBridge(channel: string): string {
    return `(${runtime.toString()})(${JSON.stringify(channel)})`;
}

function runtime(channel: string) {
    const ids = new WeakMap<Element, string>();
    let nextId = 0;
    let elements = new Map<string, HTMLElement>();
    let previous = '';
    let timer = 0;
    const hidden = new Map<HTMLElement, { value: string; priority: string }>();
    const restore = () => { for (const [element, style] of hidden) element.style.setProperty('display', style.value, style.priority); hidden.clear(); };
    const integrate = () => {
        restore();
        if (!elements.size) return;
        const known = new Set(elements.values());
        const containers = new Set(Array.from(known).map(element => element.closest<HTMLElement>('aside, .sidebar, [role="navigation"], nav, [role="tablist"]')).filter((element): element is HTMLElement => !!element));
        const hide = (element: HTMLElement) => {
            hidden.set(element, { value: element.style.getPropertyValue('display'), priority: element.style.getPropertyPriority('display') });
            element.style.setProperty('display', 'none', 'important');
        };
        for (const container of containers) {
            // Retain containers with controls that were not transferred to the host.
            if (Array.from(container.querySelectorAll<HTMLElement>('button, a, input, select, textarea, [role="tab"], [onclick]')).some(element => !known.has(element))) continue;
            hide(container);
            if (container.id) for (const toggle of document.querySelectorAll<HTMLElement>('[aria-controls]')) {
                if (toggle.getAttribute('aria-controls') === container.id && !container.contains(toggle)) hide(toggle);
            }
            // The supplied standalone module uses this dedicated mobile toggle.
            if (container.id === 'sidebarMenu') {
                const toggle = document.querySelector<HTMLElement>('.btn-menu-toggle');
                if (toggle) hide(toggle);
            }
        }
    };
    const scan = (force = false) => {
        const candidates = document.querySelectorAll<HTMLElement>('[role="tab"], button[data-tab], a[data-tab], nav a[href^="#"], [role="navigation"] a[href^="#"], aside a[href^="#"], .sidebar a[href^="#"], nav button, [role="navigation"] button, aside button[data-chapter][data-sub], .sidebar button[data-chapter][data-sub], aside .sidebar-item-btn, .sidebar .sidebar-item-btn');
        const items: HtmlMenuItem[] = [];
        elements = new Map();
        for (const element of candidates) {
            if (items.length >= 80) break;
            const href = element.getAttribute('href');
            // Only local navigation is eligible; never forward URLs or executable source.
            if (href !== null && (!href.startsWith('#') || href.length < 2)) continue;
            if (element.matches(':disabled, [aria-disabled="true"]')) continue;
            const label = (element.getAttribute('aria-label') || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
            if (!label) continue;
            let id = ids.get(element);
            if (!id) { id = `menu-${++nextId}`; ids.set(element, id); }
            elements.set(id, element);
            const heading = element.closest('.sidebar-section')?.querySelector('.sidebar-heading, h2, h3, h4');
            const group = heading?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120);
            items.push({ id, label, ...(group ? { group } : {}), active: element.getAttribute('aria-selected') === 'true' || ['page', 'true', 'location'].includes(element.getAttribute('aria-current') || '') || element.matches('.active, .tab-active, .selected, .is-active') || (!!href && location.hash === href) });
        }
        const serialized = JSON.stringify(items);
        if (force || serialized !== previous) { restore(); previous = serialized; parent.postMessage({ channel, type: 'html-menu', items }, '*'); }
    };
    const schedule = () => { if (!timer) timer = window.setTimeout(() => { timer = 0; scan(); }, 100); };
    window.addEventListener('message', event => {
        if (event.source !== parent || event.data?.channel !== channel) return;
        if (event.data.type === 'html-menu-connected' && event.data.snapshot === previous) { integrate(); return; }
        if (event.data.type === 'html-menu-request') { scan(true); return; }
        if (event.data.type !== 'html-menu-select' || typeof event.data.id !== 'string') return;
        const element = elements.get(event.data.id);
        if (!element?.isConnected || element.matches(':disabled, [aria-disabled="true"]')) return;
        element.click();
        schedule();
    });
    const start = () => {
        scan(true);
        new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-selected', 'aria-current', 'aria-label', 'disabled', 'aria-disabled', 'href', 'data-tab', 'role'] });
        document.addEventListener('click', schedule);
        window.addEventListener('hashchange', schedule);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
}
