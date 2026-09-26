import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '../prisma/prisma-db-adapter';

export interface SingleSchool {
  id: string;
  name: string | null;
  logo_url?: string | null;
}

/**
 * Sumber tunggal identitas sekolah instalasi ini.
 *
 * `organization_id` tetap dipakai sebagai foreign key agar relasi data lama
 * tidak perlu dirombak, tetapi aplikasi menolak berjalan bila terdapat lebih
 * dari satu sekolah. Dengan demikian parameter ID dari browser tidak dapat
 * berubah menjadi pemilih tenant tersembunyi.
 */
@Injectable()
export class SingleSchoolService {
  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
  ) {}

  async getSchool(options: { createIfMissing?: boolean } = {}): Promise<SingleSchool> {
    const { data, error } = await this.db
      .from('cbt_organizations')
      .select('id, name, logo_url')
      .order('created_at', { ascending: true })
      .limit(2);
    if (error) throw new ServiceUnavailableException('Identitas sekolah belum dapat dibaca.');

    const rows = (data as SingleSchool[]) || [];
    if (rows.length > 1) {
      throw new ServiceUnavailableException(
        'Konfigurasi tidak valid: instalasi single-school memiliki lebih dari satu sekolah.',
      );
    }
    if (rows.length === 1) return rows[0];
    if (!options.createIfMissing) {
      throw new ServiceUnavailableException('Sekolah utama belum dikonfigurasi.');
    }

    const name = this.config.get<string>('CBT_ORGANIZATION_NAME') || 'Sekolah';
    const slug = this.config.get<string>('CBT_ORGANIZATION_SLUG') || name
      .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const created = await this.db
      .from('cbt_organizations')
      .insert({ name, status: 'active', slug })
      .select('id, name, logo_url')
      .maybeSingle();
    if (created.error || !created.data) {
      // Dua login pertama dapat berlomba membuat sekolah. Unique index
      // singleton memilih pemenang; baca ulang hasilnya.
      const retry = await this.db
        .from('cbt_organizations')
        .select('id, name, logo_url')
        .limit(2);
      const retryRows = (retry.data as SingleSchool[]) || [];
      if (!retry.error && retryRows.length === 1) return retryRows[0];
      throw new ServiceUnavailableException('Sekolah utama gagal dibuat.');
    }
    return created.data as SingleSchool;
  }

  async assertSchoolId(organizationId: string | null | undefined): Promise<string> {
    const school = await this.getSchool();
    if (!organizationId || organizationId === 'all' || organizationId !== school.id) {
      throw new BadRequestException('ID sekolah tidak sesuai dengan sekolah instalasi ini.');
    }
    return school.id;
  }
}
