/**
 * Registri aksi utama halaman (FAB tengah BottomNav).
 * Disamakan dengan acca-new.
 */

export type PageFab = {
    label: string
    icon: string
    run: () => void
}

export const FAB_PRIORITY = {
    auto: 1,
    explicit: 2,
} as const

type Entry = { token: object; fab: PageFab; priority: number; seq: number }

const entries: Entry[] = []
let seqCounter = 0
const listeners = new Set<(fab: PageFab | null) => void>()

function best(): Entry | null {
    return entries.reduce<Entry | null>((top, e) => {
        if (!top) return e
        if (e.priority > top.priority) return e
        if (e.priority === top.priority && e.seq > top.seq) return e
        return top
    }, null)
}

function emit() {
    const fab = best()?.fab ?? null
    listeners.forEach(listener => listener(fab))
}

export function registerPageFab(token: object, fab: PageFab, priority: number = FAB_PRIORITY.explicit) {
    const existing = entries.findIndex(e => e.token === token)
    const entry: Entry = { token, fab, priority, seq: ++seqCounter }
    if (existing >= 0) entries[existing] = entry
    else entries.push(entry)
    emit()
}

export function unregisterPageFab(token: object) {
    const i = entries.findIndex(e => e.token === token)
    if (i < 0) return
    entries.splice(i, 1)
    emit()
}

export function getPageFab(): PageFab | null {
    return best()?.fab ?? null
}

export function subscribePageFab(listener: (fab: PageFab | null) => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}
