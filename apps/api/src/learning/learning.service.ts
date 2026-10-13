import { LearningLatexService } from './learning-latex.service';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { randomUUID } from 'node:crypto';
import { AuthorizationService } from '../auth/authorization.service';
import { DbService } from '../prisma/prisma-db-adapter';
import { MAX_UPLOAD_BYTES, StorageService } from '../storage/storage.service';
import { ActivityDto, CreateMaterialDto, UpdateMaterialDto } from './learning.dto';

export interface MaterialRow {
    id: string; organization_id: string; created_by: string; title: string; description: string;
    cover_data?: string; subject: string; grade_level: string; topic: string; subtopic: string; status: 'draft' | 'published'; format: string; content_html: string;
    rendered_pdf_key: string | null; conversion_notes: string; file_key: string | null; file_name: string | null; file_size: number | null;
    revision: number; content_version: number; created_at: string; updated_at: string; published_at: string | null;
}
const LIST_COLUMNS = 'cover_data, id, organization_id, created_by, title, description, subject, grade_level, topic, subtopic, status, format, file_name, file_size, revision, content_version, created_at, updated_at, published_at';

@Injectable()
export class LearningService {
    constructor(private readonly db: DbService, private readonly authz: AuthorizationService, private readonly storage: StorageService, private readonly latex: LearningLatexService) {}

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
    private async row(org: string, id: string, db: Pick<DbService, 'from'> = this.db): Promise<MaterialRow> {
        const { data, error } = await db.from('cbt_learning_materials').select('*').eq('organization_id', org).eq('id', id).maybeSingle();
        if (error) throw new InternalServerErrorException('Gagal membaca materi. Pastikan migrasi LMS sudah diterapkan.');
        if (!data) throw new NotFoundException('Bahan ajar tidak ditemukan.');
        return data as MaterialRow;
    }
    private publicRow(row: MaterialRow) {
        const { file_key, rendered_pdf_key, ...safe } = row;
        return { ...safe, hasFile: !!file_key, hasRenderedPdf: !!rendered_pdf_key };
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
        const progress = ids.length ? await this.db.from('cbt_learning_progress').select('material_id, completed, completed_version').eq('user_id', user.id).in('material_id', ids) : { data: [], error: null };
        if (progress.error) throw new InternalServerErrorException('Gagal membaca progres belajar.');
        return { materials: rows.map(row => {
            const p = (progress.data || []).find((item: { material_id: string }) => item.material_id === row.id);
            const updated = !!p?.completed && (p.completed_version || 1) !== (row.content_version || 1);
            return { ...row, completed: !!p?.completed && !updated, materialUpdated: updated };
        }), canManage };
    }
    async detail(user: AuthUser, org: string, id: string) {
        await this.reader(user, org);
        const row = await this.row(org, id);
        if (row.status !== 'published') await this.editable(user, row);
        const canEdit = await this.allowed(user, org, ['Guru', 'Admin']) && (row.created_by === user.id || await this.allowed(user, org, ['Admin']));
        const { data, error } = await this.db.from('cbt_learning_progress').select('completed, completed_version').eq('material_id', id).eq('user_id', user.id).maybeSingle();
        if (error) throw new InternalServerErrorException('Gagal membaca progres belajar.');
        const materialUpdated = !!data?.completed && (data.completed_version || 1) !== (row.content_version || 1);
        return { material: this.publicRow(row), canEdit, completed: data?.completed === true && !materialUpdated, materialUpdated };
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
        if (row.rendered_pdf_key && (dto.format !== 'latex' || dto.contentHtml !== row.content_html)) throw new BadRequestException('Unggah ulang file TeX untuk mengubah isi dokumen PDF.');
        if (dto.status === 'published' && !dto.contentHtml.trim() && !row.file_key) throw new BadRequestException('Unggah berkas atau isi materi sebelum menerbitkan.');
        const { data, error } = await this.db.from('cbt_learning_materials').update({
            cover_data: dto.coverData ?? row.cover_data ?? '',
            grade_level: dto.gradeLevel ?? row.grade_level ?? '', topic: (dto.topic ?? row.topic ?? '').trim(), subtopic: (dto.subtopic ?? row.subtopic ?? '').trim(),
            title: dto.title.trim(), description: dto.description.trim(), subject: dto.subject.trim(), status: dto.status,
            format: dto.format, content_html: dto.contentHtml, conversion_notes: dto.conversionNotes,
            content_version: (row.content_version || 1) + (row.content_html !== dto.contentHtml || row.format !== dto.format ? 1 : 0),
            revision: dto.revision + 1, updated_at: new Date().toISOString(),
            published_at: dto.status === 'published' ? (row.published_at || new Date().toISOString()) : null,
        }).eq('id', id).eq('organization_id', org).eq('revision', dto.revision).select('*').maybeSingle();
        if (error) throw new InternalServerErrorException('Gagal menyimpan bahan ajar.');
        if (!data) throw new ConflictException('Materi telah berubah di tab lain. Muat ulang sebelum menyimpan.');
        return { material: this.publicRow(data) };
    }
    async upload(user: AuthUser, org: string, id: string, file: Express.Multer.File | undefined, revision: number, dto?: UpdateMaterialDto) {
        const row = await this.row(org, id);
        await this.editable(user, row);
        if (!file || !file.size || file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('Pilih berkas berukuran 1 byte hingga 25 MB.');
        if (row.revision !== revision) throw new ConflictException('Materi telah berubah. Muat ulang sebelum mengunggah.');
        if (!dto || !dto.title.trim()) throw new BadRequestException('Isi hasil konversi dan informasi draf wajib dikirim bersama berkas.');
        const isTex = /\.(tex|latex|zip)$/i.test(file.originalname);
        // Compile first. A compiler failure must never replace the existing source or preview.
        const pdf = isTex ? await this.latex.compile(file.buffer, /\.zip$/i.test(file.originalname)) : null;
        const content = isTex ? { ...dto, format: 'latex', contentHtml: '', conversionNotes: 'Tampilan PDF hasil kompilasi LaTeX. Tata letak mengikuti dokumen sumber.' } : dto;
        const previousKey = row.file_key;
        const previousPdfKey = row.rendered_pdf_key;
        const pdfKey = pdf ? `lms-private/${org}/${id}/${randomUUID()}.bin` : null;
        // Store every source as binary, under a reserved prefix never served by the public storage endpoint.
        const key = `lms-private/${org}/${id}/${randomUUID()}.bin`;
        const uploaded = await this.storage.putObject(key, file.buffer, 'application/octet-stream');
        if (!uploaded.success) throw new InternalServerErrorException('Gagal mengunggah berkas. Periksa penyimpanan R2.');
        if (pdf && pdfKey) {
            const stored = await this.storage.putObject(pdfKey, pdf, 'application/octet-stream');
            if (!stored.success) { await this.storage.deleteObject(key); throw new InternalServerErrorException('Gagal menyimpan PDF hasil kompilasi.'); }
        }
        const name = file.originalname.replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 240);
        const { data, error } = await this.db.from('cbt_learning_materials').update({ file_key: key, file_name: name,
            file_size: file.size, rendered_pdf_key: pdfKey, content_html: content.contentHtml, conversion_notes: content.conversionNotes, format: content.format,
            cover_data: dto.coverData ?? row.cover_data ?? '',
            grade_level: dto.gradeLevel ?? row.grade_level ?? '', topic: (dto.topic ?? row.topic ?? '').trim(), subtopic: (dto.subtopic ?? row.subtopic ?? '').trim(),
            title: dto.title.trim(), description: dto.description.trim(), subject: dto.subject.trim(),
            status: dto.status || row.status,
            content_version: (row.content_version || 1) + 1,
            revision: revision + 1, updated_at: new Date().toISOString(),
        }).eq('id', id).eq('revision', revision).select('*').maybeSingle();
        if (error || !data) {
            await this.storage.deleteObject(key);
            if (pdfKey) await this.storage.deleteObject(pdfKey);
            if (!error) throw new ConflictException('Materi telah berubah. Muat ulang sebelum mengunggah.');
            throw new InternalServerErrorException('Gagal menyimpan lampiran.');
        }
        if (previousKey) await this.storage.deleteObject(previousKey);
        if (previousPdfKey) await this.storage.deleteObject(previousPdfKey);
        return { material: this.publicRow(data) };
    }
    async delete(user: AuthUser, org: string, id: string) {
        const row = await this.db.transaction(async db => {
            await db.raw('SELECT id FROM public.cbt_learning_materials WHERE id = $1::uuid FOR UPDATE', id);
            const current = await this.row(org, id, db);
            await this.editable(user, current);
            const { error } = await db.from('cbt_learning_materials').delete().eq('id', id).eq('organization_id', org);
            if (error) throw new InternalServerErrorException('Gagal menghapus bahan ajar.');
            return current;
        });
        // Never destroy a live attachment before the database commit succeeds.
        if (row.file_key) await this.storage.deleteObject(row.file_key);
        if (row.rendered_pdf_key) await this.storage.deleteObject(row.rendered_pdf_key);
        return { success: true };
    }
    async file(user: AuthUser, org: string, id: string, rendered = false) {
        await this.reader(user, org);
        const row = await this.row(org, id);
        if (row.status !== 'published') await this.editable(user, row);
        const key = rendered ? row.rendered_pdf_key : row.file_key;
        if (!key) throw new NotFoundException(rendered ? 'PDF belum tersedia. Unggah ulang sumber TeX untuk mengompilasi.' : 'Lampiran tidak tersedia.');
        const object = await this.storage.getObject(key);
        if (!object) throw new NotFoundException('Berkas tidak tersedia di penyimpanan.');
        return { object, name: rendered ? (row.file_name || 'bahan-ajar').replace(/\.(tex|latex|zip)$/i, '') + '.pdf' : row.file_name || 'bahan-ajar' };
    }
    async progress(user: AuthUser, org: string, id: string, completed: boolean, contentVersion?: number) {
        await this.reader(user, org);
        return this.db.transaction(async db => {
            await db.raw('SELECT id FROM public.cbt_learning_materials WHERE id = $1::uuid FOR UPDATE', id);
            const row = await this.row(org, id, db);
            if (row.status !== 'published') throw new BadRequestException('Materi belum diterbitkan.');
            if (contentVersion !== undefined && contentVersion !== (row.content_version || 1)) throw new ConflictException('Materi telah diperbarui. Muat ulang sebelum menandai selesai.');
            const { error } = await db.from('cbt_learning_progress').upsert({ material_id: id, user_id: user.id, completed, completed_version: row.content_version || 1, updated_at: new Date().toISOString() }, { onConflict: 'material_id,user_id' });
            if (error) throw new InternalServerErrorException('Gagal menyimpan progres belajar.');
            return { completed };
        });
    }
    async activity(user: AuthUser, org: string, id: string) {
        await this.reader(user, org);
        const row = await this.row(org, id);
        if (row.status !== 'published') throw new ForbiddenException('Aktivitas hanya tersedia pada materi terbit.');
        const { data, error } = await this.db.from('cbt_learning_activity').select('state, revision').eq('material_id', id).eq('user_id', user.id).eq('content_version', row.content_version || 1).maybeSingle();
        if (error) throw new InternalServerErrorException('Gagal membaca jawaban aktivitas.');
        return { state: data?.state || {}, revision: data?.revision || 0, contentVersion: row.content_version || 1, userId: user.id };
    }
    async saveActivity(user: AuthUser, org: string, id: string, dto: ActivityDto) {
        await this.reader(user, org);
        return this.db.transaction(async db => {
            await db.raw('SELECT id FROM public.cbt_learning_materials WHERE id = $1::uuid FOR UPDATE', id);
            const row = await this.row(org, id, db);
            if (row.status !== 'published' || row.format !== 'html') throw new ForbiddenException('Aktivitas HTML belum tersedia.');
            if (dto.contentVersion !== (row.content_version || 1)) throw new ConflictException('Materi diperbarui. Jawaban lama tidak ditimpa; muat ulang materi.');
            if (Buffer.byteLength(JSON.stringify(dto.state), 'utf8') > 128 * 1024) throw new BadRequestException('Data aktivitas terlalu besar (maksimum 128 KB).');
            const payload = { state: dto.state, revision: dto.revision + 1, updated_at: new Date().toISOString() };
            const result = dto.revision === 0
                ? await db.from('cbt_learning_activity').insert({ material_id: id, user_id: user.id, content_version: dto.contentVersion, ...payload }).select('revision').single()
                : await db.from('cbt_learning_activity').update(payload).eq('material_id', id).eq('user_id', user.id).eq('content_version', dto.contentVersion).eq('revision', dto.revision).select('revision').maybeSingle();
            if (result.error?.code === '23505' || (!result.error && !result.data)) throw new ConflictException('Aktivitas berubah di tab lain. Jawaban lokal tetap disimpan; muat ulang untuk memeriksa.');
            if (result.error) throw new InternalServerErrorException('Gagal menyimpan jawaban aktivitas.');
            return { revision: dto.revision + 1 };
        });
    }
    async activityResults(user: AuthUser, org: string, id: string) {
        const row = await this.row(org, id); await this.editable(user, row);
        const { data, error } = await this.db.from('cbt_learning_activity').select('user_id, content_version, state, updated_at').eq('material_id', id).order('updated_at', { ascending: false }).limit(500);
        if (error) throw new InternalServerErrorException('Gagal membaca hasil aktivitas.');
        const ids = [...new Set((data || []).map((entry: { user_id: string }) => entry.user_id))];
        const profiles = ids.length ? await this.db.from('cbt_profiles').select('id, full_name').in('id', ids) : { data: [], error: null };
        return { results: (data || []).map((entry: { user_id: string }) => ({ ...entry, name: profiles.data?.find((p: { id: string }) => p.id === entry.user_id)?.full_name || entry.user_id })) };
    }
}
