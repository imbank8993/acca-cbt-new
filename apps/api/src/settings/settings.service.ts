import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { assertValidTimeZone, DEFAULT_SCHOOL_TIME_ZONE } from '../common/school-time';
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
     * Zona waktu pada app_config diselaraskan secara terpusat dari site_settings (acca-new).
     */
    async findAll(options: { includeSensitive?: boolean } = {}): Promise<SettingRow[]> {
        const { data, error } = await this.db.from('acca_settings').select('*');
        if (error) {
            this.logger.error(`Gagal membaca pengaturan: ${error.message}`);
            throw new InternalServerErrorException('Gagal membaca pengaturan.');
        }

        const rows = (data as SettingRow[]) || [];
        const filtered = options.includeSensitive ? rows : rows.filter((row) => !SENSITIVE_KEYS.has(row.key));

        const effectiveInfo = await this.getSchoolTimeZoneInfo();
        let foundAppConfig = false;
        const mapped = filtered.map((row) => {
            if (row.key === 'app_config') {
                foundAppConfig = true;
                const val =
                    row.value && typeof row.value === 'object' && !Array.isArray(row.value)
                        ? {
                              ...(row.value as Record<string, unknown>),
                              time_zone: effectiveInfo.timeZone,
                              time_zone_source: effectiveInfo.source,
                          }
                        : { time_zone: effectiveInfo.timeZone, time_zone_source: effectiveInfo.source };
                return { ...row, value: val };
            }
            return row;
        });

        if (!foundAppConfig) {
            mapped.push({
                id: 'synthesized-app-config',
                key: 'app_config',
                value: { time_zone: effectiveInfo.timeZone, time_zone_source: effectiveInfo.source },
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            });
        }

        return mapped;
    }

    private async findRawOne(key: string): Promise<SettingRow | null> {
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

    async findOne(key: string): Promise<SettingRow | null> {
        const row = await this.findRawOne(key);
        if (key === 'app_config' && row) {
            const effectiveInfo = await this.getSchoolTimeZoneInfo();
            const val =
                row.value && typeof row.value === 'object' && !Array.isArray(row.value)
                    ? {
                          ...(row.value as Record<string, unknown>),
                          time_zone: effectiveInfo.timeZone,
                          time_zone_source: effectiveInfo.source,
                      }
                    : { time_zone: effectiveInfo.timeZone, time_zone_source: effectiveInfo.source };
            return { ...row, value: val };
        }
        return row;
    }

    async getSchoolTimeZoneInfo(): Promise<{ timeZone: string; source: 'site_settings' | 'app_config' | 'default' }> {
        // A read failure is not an absent setting: never reinterpret schedules silently.
        const { data, error } = await this.db.from('site_settings')
            .select('value').eq('key', 'timezone').maybeSingle();
        if (error) throw new InternalServerErrorException('Zona waktu acca-new belum dapat dibaca. Coba lagi.');
        if (data?.value != null && data.value !== '') {
            try {
                if (typeof data.value !== 'string') throw new Error('Invalid time zone');
                return { timeZone: assertValidTimeZone(data.value.trim()), source: 'site_settings' };
            } catch {
                throw new InternalServerErrorException('Zona waktu acca-new tidak valid. Periksa pengaturan pusat.');
            }
        }

        // Prioritas 2 (Fallback): Baca dari acca_settings app_config
        const setting = await this.findRawOne('app_config');
        const config = setting?.value;
        const timeZone =
            config && typeof config === 'object' && !Array.isArray(config)
                ? (config as Record<string, unknown>).time_zone
                : undefined;
        if (timeZone && typeof timeZone === 'string' && timeZone.trim() !== '') {
            try {
                return { timeZone: assertValidTimeZone(timeZone.trim()), source: 'app_config' };
            } catch (error) {
                throw new InternalServerErrorException('Zona waktu CBT tidak valid. Periksa pengaturan.');
            }
        }

        // Prioritas 3 (Default nasional)
        return { timeZone: DEFAULT_SCHOOL_TIME_ZONE, source: 'default' };
    }

    async getSchoolTimeZone(): Promise<string> {
        const info = await this.getSchoolTimeZoneInfo();
        return info.timeZone;
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
