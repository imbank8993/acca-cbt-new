import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { DbService } from '../prisma/prisma-db-adapter';

export interface SettingRow {
    id: string;
    key: string;
    value: unknown;
    created_at: string;
    updated_at: string;
}

/**
 * Pengaturan yang TIDAK boleh ikut terbaca oleh sembarang pengguna.
 *
 * `storage_config` memuat `r2.secret_access_key`. Versi lama
 * (`getSettingsAction`) menyeleksi `*` dan dipanggil dari Sidebar — yang dimuat
 * SETIAP pengguna, termasuk siswa — sehingga kredensial R2 ikut terkirim ke
 * browser semua orang.
 */
const SENSITIVE_KEYS = new Set(['storage_config']);

/**
 * Pengaturan aplikasi (tabel `acca_settings`), key/value berisi JSON.
 *
 * Dipindahkan dari `apps/web/app/actions/settings.ts`.
 */
@Injectable()
export class SettingsService {
    private readonly logger = new Logger(SettingsService.name);

    constructor(private readonly db: DbService) {}

    static isSensitive(key: string): boolean {
        return SENSITIVE_KEYS.has(key);
    }

    /**
     * Seluruh pengaturan. Key sensitif disaring kecuali diminta secara eksplisit
     * oleh pemanggil yang sudah memeriksa perannya lebih dulu.
     */
    async findAll(options: { includeSensitive?: boolean } = {}): Promise<SettingRow[]> {
        const { data, error } = await this.db.from('acca_settings').select('*');
        if (error) {
            this.logger.error(`Gagal membaca pengaturan: ${error.message}`);
            throw new InternalServerErrorException('Gagal membaca pengaturan.');
        }

        const rows = (data as SettingRow[]) || [];
        if (options.includeSensitive) return rows;
        return rows.filter((row) => !SENSITIVE_KEYS.has(row.key));
    }

    async findOne(key: string): Promise<SettingRow | null> {
        const { data, error } = await this.db
            .from('acca_settings')
            .select('*')
            .eq('key', key)
            .maybeSingle();

        if (error) {
            this.logger.error(`Gagal membaca pengaturan '${key}': ${error.message}`);
            throw new InternalServerErrorException('Gagal membaca pengaturan.');
        }
        return (data as SettingRow) || null;
    }

    /**
     * Simpan satu pengaturan.
     *
     * Versi lama melakukan select-lalu-insert-atau-update, yang punya celah
     * balapan: dua permintaan bersamaan sama-sama melihat baris belum ada, lalu
     * keduanya INSERT dan yang kedua melanggar batasan unik pada `key`. Satu
     * pernyataan UPSERT menyerahkan penyelesaiannya ke PostgreSQL.
     */
    async upsert(key: string, value: unknown): Promise<void> {
        const { error } = await this.db.from('acca_settings').upsert(
            { key, value, updated_at: new Date().toISOString() },
            { onConflict: 'key' },
        );

        if (error) {
            this.logger.error(`Gagal menyimpan pengaturan '${key}': ${error.message}`);
            throw new InternalServerErrorException('Gagal menyimpan pengaturan.');
        }
    }
}
