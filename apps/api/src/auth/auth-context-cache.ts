import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';

/**
 * Cache singkat identitas pemanggil.
 *
 * `JwtStrategy.validate` berjalan pada SETIAP permintaan terautentikasi dan
 * dulu selalu membaca ulang 7–11 query (auth.users, public.users, sekolah,
 * keanggotaan + peran, platform_admins, attempt, penugasan pengawas). Selama
 * ujian, heartbeat 15 detik, autosave, dan setiap gambar soal dari ratusan
 * siswa mengalikan biaya itu menjadi ratusan query per detik — hasilnya sama
 * persis untuk pengguna yang sama.
 *
 * Hasil yang BERHASIL disimpan per UUID pengguna selama TTL. Kegagalan (akun
 * tidak ada, nonaktif, galat DB) tidak pernah disimpan. Perubahan peran atau
 * status akun dari tempat lain berlaku paling lambat satu TTL; jalur yang
 * mengubah peran/sesi secara langsung (SSO, pencabutan sesi) mengosongkan
 * entri pengguna itu seketika. Cache ini per proses: pada mode cluster setiap
 * proses memegang salinannya sendiri, dan TTL yang membatasi selisihnya.
 *
 * Diatur lewat env `AUTH_CONTEXT_CACHE_TTL_MS` (bawaan 30000, 0 = nonaktif,
 * maksimum 300000).
 */
export const DEFAULT_AUTH_CONTEXT_TTL_MS = 30_000;
export const MAX_AUTH_CONTEXT_TTL_MS = 300_000;
export const MAX_AUTH_CONTEXT_ENTRIES = 20_000;

export function authContextTtlMs(raw: string | undefined = process.env.AUTH_CONTEXT_CACHE_TTL_MS): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_AUTH_CONTEXT_TTL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_AUTH_CONTEXT_TTL_MS;
  return Math.min(Math.floor(parsed), MAX_AUTH_CONTEXT_TTL_MS);
}

interface Entry<T> { value: T; expiresAt: number }

/**
 * Cache TTL dengan single-flight: permintaan serentak untuk kunci yang sama
 * menunggu SATU pemuatan. Pemuatan yang sedang berjalan saat kuncinya
 * di-invalidate tidak menyimpan hasilnya (bisa saja sudah basi).
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly pending = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly options: {
      maxEntries?: number;
      now?: () => number;
      /** Hanya nilai yang lolos predikat ini yang disimpan. */
      cacheIf?: (value: T) => boolean;
    } = {},
  ) {}

  get size(): number {
    return this.entries.size;
  }

  async get(key: string, load: () => Promise<T>): Promise<T> {
    if (this.ttlMs <= 0) return load();
    const now = this.now();
    const hit = this.entries.get(key);
    if (hit) {
      if (hit.expiresAt > now) return hit.value;
      this.entries.delete(key);
    }
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const request = load().then(
      value => {
        // Diinvalidasi selama pemuatan: kembalikan hasilnya ke pemanggil ini,
        // tetapi jangan disimpan untuk permintaan berikutnya.
        if (this.pending.get(key) === request) {
          this.pending.delete(key);
          if (!this.options.cacheIf || this.options.cacheIf(value)) this.store(key, value);
        }
        return value;
      },
      error => {
        if (this.pending.get(key) === request) this.pending.delete(key);
        throw error;
      },
    );
    this.pending.set(key, request);
    return request;
  }

  invalidate(key: string): void {
    this.entries.delete(key);
    this.pending.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.pending.clear();
  }

  private store(key: string, value: T): void {
    const max = this.options.maxEntries ?? MAX_AUTH_CONTEXT_ENTRIES;
    if (this.entries.size >= max) {
      const now = this.now();
      for (const [k, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(k);
      // Masih penuh: buang entri tertua (Map menjaga urutan sisip).
      while (this.entries.size >= max) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.entries.delete(oldest);
      }
    }
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}

/** Salinan agar pemanggil yang mengubah `request.user` tidak mencemari cache. */
export function cloneAuthUser(user: AuthUser): AuthUser {
  return {
    ...user,
    roles: [...(user.roles || [])],
    resolved: { ...user.resolved },
  };
}

/** Identitas terverifikasi beserta versi sesi akun saat dibaca. */
export interface CachedIdentity {
  user: AuthUser;
  /** `raw_app_meta_data.session_version`; dicocokkan dengan klaim token tiap permintaan. */
  sessionVersion: string;
}

@Injectable()
export class AuthContextCache {
  private readonly ttlMs = authContextTtlMs();
  /** UUID pengguna → identitas terverifikasi. */
  readonly users = new TtlCache<CachedIdentity>(this.ttlMs);
  /** `public.users.id` (token acca-new) → UUID auth; null tidak disimpan. */
  readonly legacyIds = new TtlCache<string | null>(this.ttlMs, { cacheIf: value => Boolean(value) });

  async identity(userId: string, load: () => Promise<CachedIdentity>): Promise<CachedIdentity> {
    const entry = await this.users.get(userId, load);
    return { user: cloneAuthUser(entry.user), sessionVersion: entry.sessionVersion };
  }

  /** Kosongkan identitas satu pengguna (peran/sesi/status akunnya baru berubah). */
  invalidate(userId: string | null | undefined): void {
    if (userId) this.users.invalidate(userId);
  }
}
