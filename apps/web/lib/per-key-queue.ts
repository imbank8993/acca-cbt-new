/**
 * Menjalankan pekerjaan untuk kunci yang sama secara berurutan.
 *
 * Autosave untuk dua soal berbeda tetap dapat berjalan bersamaan, tetapi dua
 * perubahan cepat pada soal yang sama tidak boleh tiba di server terbalik dan
 * membuat jawaban lama menimpa jawaban terbaru.
 */
export class PerKeyQueue {
    private readonly tails = new Map<string, Promise<void>>();

    enqueue(key: string, task: () => Promise<void>): Promise<void> {
        const previous = this.tails.get(key) ?? Promise.resolve();
        const current = previous
            .catch(() => undefined)
            .then(task)
            .finally(() => {
                if (this.tails.get(key) === current) this.tails.delete(key);
            });

        this.tails.set(key, current);
        return current;
    }

    has(key: string): boolean {
        return this.tails.has(key);
    }
}
