import { Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthUserRow {
  id: string;
  email: string | null;
  encrypted_password?: string | null;
  raw_user_meta_data: Record<string, unknown> | null;
  email_confirmed_at: Date | null;
  last_sign_in_at: Date | null;
  banned_until: Date | null;
  created_at: Date | null;
}

/**
 * Semua operasi terhadap `auth.users`, pengganti langsung `supabase.auth.admin.*`.
 *
 * Tabel schema `auth` ikut terbawa saat database Supabase di-restore ke
 * PostgreSQL VPS, lengkap dengan 308 baris pengguna dan hash bcrypt-nya. Karena
 * `cbt_profiles.id` merujuk `auth.users.id`, memakai ulang tabel ini berarti
 * seluruh relasi data CBT tetap utuh — tidak ada pemetaan ulang pengguna.
 *
 * Tidak ada GoTrue yang berjalan lagi: tabel ini murni jadi penyimpan kredensial.
 */
@Injectable()
export class AuthUsersRepository {
  private readonly logger = new Logger(AuthUsersRepository.name);

  /** Biaya bcrypt disamakan dengan hash bawaan GoTrue ($2a$10$). */
  private static readonly BCRYPT_ROUNDS = 10;

  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<AuthUserRow | null> {
    const rows = await this.prisma.$queryRawUnsafe<AuthUserRow[]>(
      `SELECT id, email, raw_user_meta_data, email_confirmed_at, last_sign_in_at,
              banned_until, created_at
         FROM auth.users
        WHERE id = $1::uuid AND deleted_at IS NULL
        LIMIT 1`,
      id,
    );
    return rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<(AuthUserRow & { encrypted_password: string | null }) | null> {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<AuthUserRow & { encrypted_password: string | null }>
    >(
      `SELECT id, email, encrypted_password, raw_user_meta_data, email_confirmed_at,
              last_sign_in_at, banned_until, created_at
         FROM auth.users
        WHERE lower(email) = lower($1) AND deleted_at IS NULL
        LIMIT 1`,
      email,
    );
    return rows[0] ?? null;
  }

  /**
   * Padanan `auth.admin.listUsers()`.
   *
   * Versi Supabase mengembalikan SELURUH pengguna dan dipakai beberapa layar
   * hanya untuk memetakan id → email. Di sini disediakan penyaring id supaya
   * pemanggil tidak perlu menarik 308 baris demi beberapa email.
   */
  async listUsers(options: { ids?: string[]; limit?: number } = {}): Promise<AuthUserRow[]> {
    if (options.ids) {
      if (options.ids.length === 0) return [];
      return this.prisma.$queryRawUnsafe<AuthUserRow[]>(
        `SELECT id, email, raw_user_meta_data, email_confirmed_at, last_sign_in_at,
                banned_until, created_at
           FROM auth.users
          WHERE deleted_at IS NULL AND id = ANY($1::uuid[])`,
        options.ids,
      );
    }
    return this.prisma.$queryRawUnsafe<AuthUserRow[]>(
      `SELECT id, email, raw_user_meta_data, email_confirmed_at, last_sign_in_at,
              banned_until, created_at
         FROM auth.users
        WHERE deleted_at IS NULL
        ORDER BY created_at DESC NULLS LAST
        LIMIT $1`,
      options.limit ?? 5000,
    );
  }

  /** Peta id → email, bentuk yang paling sering dibutuhkan pemanggil. */
  async emailMap(ids: string[]): Promise<Map<string, string>> {
    const users = await this.listUsers({ ids });
    return new Map(users.filter((u) => u.email).map((u) => [u.id, u.email as string]));
  }

  async verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
    if (!hash) return false;
    return bcrypt.compare(plain, hash);
  }

  /** Padanan `auth.admin.createUser({ email, password, user_metadata })`. */
  async createUser(input: {
    email: string;
    password: string;
    emailConfirm?: boolean;
    userMetadata?: Record<string, unknown>;
  }): Promise<AuthUserRow> {
    const existing = await this.findByEmail(input.email);
    if (existing) {
      throw new Error(`Email ${input.email} sudah terdaftar.`);
    }

    const id = randomUUID();
    const hash = await bcrypt.hash(input.password, AuthUsersRepository.BCRYPT_ROUNDS);
    const metadata = JSON.stringify(input.userMetadata ?? {});
    const confirmedAt = input.emailConfirm === false ? null : new Date();

    const rows = await this.prisma.$queryRawUnsafe<AuthUserRow[]>(
      `INSERT INTO auth.users
         (id, instance_id, aud, role, email, encrypted_password,
          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
          created_at, updated_at)
       VALUES
         ($1::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated',
          'authenticated', $2, $3, $4::timestamptz,
          '{"provider":"email","providers":["email"]}'::jsonb, $5::jsonb, now(), now())
       RETURNING id, email, raw_user_meta_data, email_confirmed_at, last_sign_in_at,
                 banned_until, created_at`,
      id,
      input.email,
      hash,
      confirmedAt,
      metadata,
    );

    // Baris identitas dibuat agar data tetap sebentuk dengan 308 pengguna hasil
    // restore, yang semuanya punya identitas provider 'email'. Kegagalan di sini
    // tidak membatalkan pembuatan akun: tanpa GoTrue, tabel ini tidak dipakai
    // untuk login.
    try {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO auth.identities
           (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, email)
         VALUES (gen_random_uuid(), $1::text, $1::uuid, $2::jsonb, 'email', NULL, now(), now(), $3)`,
        id,
        JSON.stringify({ sub: id, email: input.email, email_verified: true, provider: 'email' }),
        input.email,
      );
    } catch (error) {
      this.logger.warn(
        `Identitas auth untuk ${input.email} gagal dibuat: ${(error as Error).message}`,
      );
    }

    return rows[0];
  }

  /** Padanan `auth.admin.updateUserById(id, { email, password, user_metadata })`. */
  async updateUser(
    id: string,
    updates: { email?: string; password?: string; userMetadata?: Record<string, unknown> },
  ): Promise<void> {
    const assignments: string[] = ['updated_at = now()'];
    const params: unknown[] = [];

    const push = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (updates.email) {
      assignments.push(`email = ${push(updates.email)}`);
      assignments.push(`email_confirmed_at = COALESCE(email_confirmed_at, now())`);
    }
    if (updates.password) {
      const hash = await bcrypt.hash(updates.password, AuthUsersRepository.BCRYPT_ROUNDS);
      assignments.push(`encrypted_password = ${push(hash)}`);
    }
    if (updates.userMetadata) {
      // Digabung, bukan ditimpa: pemanggil lama hanya mengirim field yang berubah
      // (mis. hanya full_name), dan menimpa akan menghapus role di metadata.
      assignments.push(
        `raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || ${push(
          JSON.stringify(updates.userMetadata),
        )}::jsonb`,
      );
    }

    params.push(id);
    await this.prisma.$executeRawUnsafe(
      `UPDATE auth.users SET ${assignments.join(', ')} WHERE id = $${params.length}::uuid`,
      ...params,
    );

    if (updates.email) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE auth.identities
            SET email = $1,
                identity_data = COALESCE(identity_data, '{}'::jsonb) || jsonb_build_object('email', $1::text),
                updated_at = now()
          WHERE user_id = $2::uuid`,
        updates.email,
        id,
      );
    }
  }

  /**
   * Padanan `auth.admin.deleteUser(id)`.
   *
   * Penghapusan dilakukan lunak (`deleted_at`), bukan DELETE. `cbt_profiles.id`
   * merujuk baris ini dengan ON DELETE CASCADE — menghapus permanen berarti
   * seluruh jejak ujian, jawaban, dan nilai peserta ikut lenyap.
   */
  async softDeleteUser(id: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE auth.users SET deleted_at = now(), updated_at = now() WHERE id = $1::uuid`,
      id,
    );
    await this.revokeSessions(id);
  }

  /** Padanan `auth.admin.signOut(jwt, 'global')` — cabut seluruh sesi pengguna. */
  async revokeSessions(id: string): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM auth.sessions WHERE user_id = $1::uuid`,
        id,
      );
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM auth.refresh_tokens WHERE user_id = $1::text`,
        id,
      );
    } catch (error) {
      this.logger.warn(`Gagal mencabut sesi ${id}: ${(error as Error).message}`);
    }
  }

  async touchLastSignIn(id: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1::uuid`,
      id,
    );
  }
}
