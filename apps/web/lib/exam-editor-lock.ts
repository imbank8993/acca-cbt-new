/** Browser-owned locks are released on tab close/crash and cannot expire while a tab sleeps. */
export function acquireExamEditorLock(examId: string): Promise<(() => void) | null> {
    if (typeof navigator === 'undefined' || !navigator.locks?.request) {
        return Promise.reject(new Error('Browser belum mendukung pengamanan satu tab ujian. Gunakan browser terbaru dan buka alamat ujian melalui HTTPS; hubungi proktor jika tetap gagal.'));
    }
    return new Promise((resolve, reject) => {
        void navigator.locks.request(`exam-editor:${examId}`, { mode: 'exclusive', ifAvailable: true }, async lock => {
            if (!lock) { resolve(null); return; }
            await new Promise<void>(release => { resolve(release); });
        }).catch(reject);
    });
}
