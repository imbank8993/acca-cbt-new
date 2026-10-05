/** Runs only inside the opaque sandbox. The parent checks window identity and channel. */
export function learningActivityBridge(channel: string) {
    return `(${runtime.toString()})(${JSON.stringify(channel)})`;
}
function runtime(channel: string) {
    let ready = false, restoring = false;
    let custom: unknown = null;
    const fields = () => Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select'))
        .filter(element => !['password', 'file', 'hidden', 'submit', 'button'].includes(element.type) && !element.hasAttribute('data-lms-ignore'));
    const key = (element: HTMLElement, index: number) => element.getAttribute('data-lms-key') || `${element.tagName}:${element.id || element.getAttribute('name') || 'field'}:${index}`;
    const send = () => {
        if (!ready || restoring) return;
        const values = fields().map((element, index) => ({ key: key(element, index), value: element instanceof HTMLSelectElement && element.multiple
            ? Array.from(element.selectedOptions).map(option => option.value) : element.value,
            checked: element instanceof HTMLInputElement ? element.checked : undefined }));
        parent.postMessage({ type: 'lms-state', channel, state: { fields: values, custom } }, '*');
    };
    const api = { setState(value: unknown) { custom = value; send(); }, getState() { return custom; } };
    Object.defineProperty(window, 'ACCALMS', { value: api, writable: false });
    window.addEventListener('message', event => {
        if (event.source !== parent || event.data?.channel !== channel || event.data?.type !== 'lms-restore' || ready) return;
        const state = event.data.state || {}; restoring = true;
        const saved = new Map((Array.isArray(state.fields) ? state.fields : []).map((entry: { key: string }) => [entry.key, entry]));
        fields().forEach((element, index) => {
            const value = saved.get(key(element, index)) as { value?: unknown; checked?: boolean } | undefined;
            if (!value) return;
            if (element instanceof HTMLSelectElement && element.multiple && Array.isArray(value.value)) {
                Array.from(element.options).forEach(option => { option.selected = (value.value as string[]).includes(option.value); });
            } else if (typeof value.value === 'string') element.value = value.value;
            if (element instanceof HTMLInputElement && typeof value.checked === 'boolean') element.checked = value.checked;
            element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
        });
        custom = state.custom ?? custom; ready = true; restoring = false;
        window.dispatchEvent(new CustomEvent('lms:ready', { detail: { state: custom } }));
    });
    document.addEventListener('input', send); document.addEventListener('change', send);
    document.addEventListener('click', () => setTimeout(send, 0));
    document.addEventListener('reset', () => setTimeout(send, 0));
    const announce = () => { if (!ready) parent.postMessage({ type: 'lms-ready', channel }, '*'); };
    const handshake = setInterval(() => { if (ready) clearInterval(handshake); else announce(); }, 500);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', announce, { once: true }); else announce();
}
