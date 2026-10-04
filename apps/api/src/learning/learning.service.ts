import { BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { randomUUID } from 'node:crypto';
import { AuthorizationService } from '../auth/authorization.service';
import { DbService } from '../prisma/prisma-db-adapter';
import { MAX_UPLOAD_BYTES, StorageService } from '../storage/storage.service';
import { CreateMaterialDto, UpdateMaterialDto } from './learning.dto';

export interface MaterialRow {
    id: string; organization_id: string; created_by: string; title: string; description: string;
    subject: string; status: 'draft' | 'published'; format: string; content_html: string;
    conversion_notes: string; file_key: string | null; file_name: string | null; file_size: number | null;
    revision: number; created_at: string; updated_at: string; published_at: string | null;
}
const LIST_COLUMNS = 'id, organization_id, created_by, title, description, subject, status, format, file_name, file_size, revision, created_at, updated_at, published_at';

@Injectable()
export class LearningService {
    constructor(private readonly db: DbService, private readonly authz: AuthorizationService, private readonly storage: StorageService) {}

    private async allowed(user: AuthUser, org: string, roles: string[]) {
        try { await this.authz.assertOrgRole(user, org, roles, roles.join('/')); return true; }
        catch (error) { if (error instanceof ForbiddenException) return false; throw error; }
    }
    private async reader(user: AuthUser, org: string) {
        await this.authz.assertOrgRole(user, org, ['Siswa', 'Guru', 'Admin'], 'Siswa/Guru/Admin');
    }
    private async manager(user: AuthUser, org: string) {
        await this.authz.assertOrgRole(user, org, ['Guru', 'Admin'], 'Guru/Admin');
    }
    private async editable(user: AuthUser, row: MaterialRow) {
        await this.manager(user, row.organization_id);
        if (row.created_by !== user.id) await this.authz.assertOrgRole(user, row.organization_id, ['Admin'], 'pemilik materi/Admin');
    }
    private async row(org: string, id: string): Promise<MaterialRow> {
        const { data, error } = await this.db.from('cbt_learning_materials').select('*').eq('organization_id', org).eq('id', id).maybeSingle();
        if (error) throw new InternalServerErrorException('Gagal membaca materi. Pastikan migrasi LMS sudah diterapkan.');
        if (!data) throw new NotFoundException('Bahan ajar tidak ditemukan.');
        return data as MaterialRow;
    }
    private publicRow(row: MaterialRow) {
        const { file_key, ...safe } = row;
        return { ...safe, hasFile: !!file_key };
    }
    async list(user: AuthUser, org: string, manage = false) {
        await this.reader(user, org);
        const canManage = await this.allowed(user, org, ['Guru', 'Admin']);
        if (manage) await this.manager(user, org);
        let query = this.db.from('cbt_learning_materials').select(LIST_COLUMNS).eq('organization_id', org);
        if (!manage) query = query.eq('status', 'published');
        else if (!await this.allowed(user, org, ['Admin'])) query = query.eq('created_by', user.id);
        const { data, error } = await query.order('updated_at', { ascending: false });
        if (error) throw new InternalServerErrorException('Gagal membaca materi. Pastikan migrasi LMS sudah diterapkan.');
        const rows = (data || []) as MaterialRow[];
        const ids = rows.map(row => row.id);
        const progress = ids.length ? await this.db.from('cbt_learning_progress').select('material_id, completed').eq('user_id', user.id).in('material_id', ids) : { data: [], error: null };
        if (progress.error) throw new InternalServerErrorException('Gagal membaca progres belajar.');
        const completed = new Set((progress.data || []).filter((p: { completed: boolean }) => p.completed).map((p: { material_id: string }) => p.material_id));
        return { materials: rows.map(row => ({ ...row, completed: completed.has(row.id) })), canManage };
    }
    async detail(user: AuthUser, org: string, id: string) {
        await this.reader(user, org);
        const row = await this.row(org, id);
        if (row.status !== 'published') await this.editable(user, row);
        const canEdit = await this.allowed(user, org, ['Guru', 'Admin']) && (row.created_by === user.id || await this.allowed(user, org, ['Admin']));
        const { data, error } = await this.db.from('cbt_learning_progress').select('completed').eq('material_id', id).eq('user_id', user.id).maybeSingle();
        if (error) throw new InternalServerErrorException('Gagal membaca progres belajar.');
        return { material: this.publicRow(row), canEdit, completed: data?.completed === true };
    }
    async create(user: AuthUser, org: string, dto: CreateMaterialDto) {
        await this.manager(user, org);
        if (!dto.title.trim()) throw new BadRequestException('Judul wajib diisi.');
        const { data: existing, error: readError } = await this.db.from('cbt_learning_materials').select('*').eq('id', dto.id).maybeSingle();
        if (readError) throw new InternalServerErrorException('Gagal memeriksa draf.');
        if (existing) {
            if (existing.organization_id !== org || existing.created_by !== user.id) throw new ConflictException('ID draf sudah digunakan.');
            return { material: this.publicRow(existing) };
        }
        const { data, error } = await this.db.from('cbt_learning_materials').insert({ id: dto.id, organization_id: org, created_by: user.id, title: dto.title.trim() }).select('*').single();
        if (error || !data) throw new InternalServerErrorException('Gagal membuat draf bahan ajar.');
        return { material: this.publicRow(data) };
    }
    async update(user: AuthUser, org: string, id: string, dto: UpdateMaterialDto) {
        const row = await this.row(org, id);
        await this.editable(user, row);
        if (!dto.title.trim()) throw new BadRequestException('Judul wajib diisi.');
        if (dto.status === 'published' && !dto.contentHtml.trim() && !row.file_key) throw new BadRequestException('Unggah berkas atau isi materi sebelum menerbitkan.');
        const { data, error } = await this.db.from('cbt_learning_materials').update({
            title: dto.title.trim(), description: dto.description.trim(), subject: dto.subject.trim(), status: dto.status,
            format: dto.format, content_html: dto.contentHtml, conversion_notes: dto.conversionNotes,
            revision: dto.revision + 1, updated_at: new Date().toISOString(),
            published_at: dto.status === 'published' ? (row.published_at || new Date().toISOString()) : null,
        }).eq('id', id).eq('organization_id', org).eq('revision', dto.revision).select('*').maybeSingle();
        if (error) throw new InternalServerErrorException('Gagal menyimpan bahan ajar.');
        if (!data) throw new ConflictException('Materi telah berubah di tab lain. Muat ulang sebelum menyimpan.');
        return { material: this.publicRow(data) };
    }
    async upload(user: AuthUser, org: string, id: string, file: Express.Multer.File | undefined, revision: number) {
        const row = await this.row(org, id);
        await this.editable(user, row);
        if (!file || !file.size || file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('Pilih berkas berukuran 1 byte hingga 25 MB.');
        if (row.status !== 'draft') throw new BadRequestException('Simpan sebagai draf sebelum mengganti berkas.');
        if (row.revision !== revision) throw new ConflictException('Materi telah berubah. Muat ulang sebelum mengunggah.');
        const previousKey = row.file_key;
        // Store every source as binary, under a reserved prefix never served by the public storage endpoint.
        const key = `lms-private/${org}/${id}/${randomUUID()}.bin`;
        const uploaded = await this.storage.putObject(key, file.buffer, 'application/octet-stream');
        if (!uploaded.success) throw new InternalServerErrorException('Gagal mengunggah berkas. Periksa penyimpanan R2.');
        const name = file.originalname.replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 240);
        const { data, error } = await this.db.from('cbt_learning_materials').update({ file_key: key, file_name: name,
            file_size: file.size, content_html: '', conversion_notes: '', format: 'attachment',
            revision: revision + 1, updated_at: new Date().toISOString(),
        }).eq('id', id).eq('revision', revision).eq('status', 'draft').select('*').maybeSingle();
        if (error || !data) {
            await this.storage.deleteObject(key);
            if (!error) throw new ConflictException('Materi telah berubah. Muat ulang sebelum mengunggah.');
            throw new InternalServerErrorException('Gagal menyimpan lampiran.');
        }
        if (previousKey) await this.storage.deleteObject(previousKey);
        return { material: this.publicRow(data) };
    }
    async file(user: AuthUser, org: string, id: string) {
        await this.reader(user, org);
        const row = await this.row(org, id);
        if (row.status !== 'published') await this.editable(user, row);
        if (!row.file_key) throw new NotFoundException('Lampiran tidak tersedia.');
        const object = await this.storage.getObject(row.file_key);
        if (!object) throw new NotFoundException('Berkas tidak tersedia di penyimpanan.');
        return { object, name: row.file_name || 'bahan-ajar' };
    }
    async progress(user: AuthUser, org: string, id: string, completed: boolean) {
        await this.reader(user, org);
        const row = await this.row(org, id);
        if (row.status !== 'published') throw new BadRequestException('Materi belum diterbitkan.');
        const { error } = await this.db.from('cbt_learning_progress').upsert({ material_id: id, user_id: user.id, completed, updated_at: new Date().toISOString() }, { onConflict: 'material_id,user_id' });
        if (error) throw new InternalServerErrorException('Gagal menyimpan progres belajar.');
        return { completed };
    }
}
