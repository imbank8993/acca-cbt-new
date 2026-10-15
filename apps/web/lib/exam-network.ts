/** Require two matching samples so a single slow heartbeat does not flash a warning. */
export function sampleExamNetwork(previous: { weak: boolean; streak: number }, elapsedMs: number) {
    const slow = elapsedMs >= 3000;
    const streak = slow === previous.weak ? 0 : previous.streak + 1;
    return streak >= 2 ? { weak: slow, streak: 0 } : { weak: previous.weak, streak };
}

export function examNetworkLabel(offline: boolean, serverUnavailable: boolean, weak: boolean) {
    if (offline) return 'Koneksi terputus';
    if (serverUnavailable) return 'Server belum dapat dihubungi';
    return weak ? 'Jaringan lemah' : null;
}
