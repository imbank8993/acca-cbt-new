/** Mengubah nilai lemparan JavaScript yang tidak dikenal menjadi pesan aman. */
export function getErrorMessage(error: unknown, fallback = ''): string {
    if (error instanceof Error) return error.message || fallback;
    if (typeof error === 'string') return error || fallback;
    if (error && typeof error === 'object' && 'message' in error) {
        const message = Reflect.get(error, 'message');
        if (typeof message === 'string') return message || fallback;
    }
    return fallback;
}
