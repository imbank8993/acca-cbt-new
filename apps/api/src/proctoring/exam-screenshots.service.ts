import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '@acca-cbt/shared';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuthorizationService } from '../auth/authorization.service';
import { DbService } from '../prisma/prisma-db-adapter';
import { StorageService } from '../storage/storage.service';
import { advisoryTransactionLock } from '../common/transaction-lock';

export const SCREENSHOT_LIMIT = 10;
export const SCREENSHOT_BYTES = 200 * 1024;
export const SCREENSHOT_INTERVAL_MS = 30_000;
export const SCREENSHOT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const SCREENSHOT_EVENTS = ['tab_switch', 'window_blur', 'blur', 'exit_fullscreen', 'restricted_shortcut', 'copy_paste_attempt', 'right_click_attempt'];

/** Images remain encrypted even if the shared R2 bucket has a public endpoint. */
export function screenshotKey(secret: string): Buffer {
    if (!secret || secret.length < 16) throw new ServiceUnavailableException('Kunci penyimpanan bukti belum dikonfigurasi.');
    return createHash('sha256').update(`exam-screenshot-v1:${secret}`).digest();
}
export function encryptScreenshot(image: Buffer, key: Buffer): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(image), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}
export function decryptScreenshot(image: Buffer, key: Buffer): Buffer {
    const decipher = createDecipheriv('aes-256-gcm', key, image.subarray(0, 12));
    decipher.setAuthTag(image.subarray(12, 28));
    return Buffer.concat([decipher.update(image.subarray(28)), decipher.final()]);
}
export function decodeScreenshot(encoded: string): { image: Buffer; contentType: string } {
    if (!encoded || encoded.length > 4 * Math.ceil(SCREENSHOT_BYTES / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        throw new BadRequestException('Screenshot maksimal 200 KB dalam format JPEG/WebP.');
    }
    const image = Buffer.from(encoded, 'base64');
    if (!image.length || image.length > SCREENSHOT_BYTES || image.toString('base64') !== encoded) throw new BadRequestException('Screenshot tidak valid.');
    const jpeg = image.length > 4 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff && image[image.length - 2] === 0xff && image[image.length - 1] === 0xd9;
    const webp = image.length >= 20 && image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP' && image.readUInt32LE(4) + 8 === image.length;
    if (!jpeg && !webp) throw new BadRequestException('Screenshot harus berupa JPEG/WebP.');
    return { image, contentType: jpeg ? 'image/jpeg' : 'image/webp' };
}

@Injectable()
export class ExamScreenshotsService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(ExamScreenshotsService.name);
    private timer?: ReturnType<typeof setInterval>;
    private running = false;
    constructor(private readonly db: DbService, private readonly authz: AuthorizationService,
        private readonly storage: StorageService, private readonly config: ConfigService) {}

    private key() { return screenshotKey(this.config.get<string>('SCREENSHOT_ENCRYPTION_KEY') || this.config.get<string>('JWT_SECRET') || ''); }

    async upload(user: AuthUser, attemptId: string, clientEventId: string, deviceId: string, encoded: string) {
        const { image, contentType } = decodeScreenshot(encoded);
        const key = this.key();
        let uploadedKey: string | undefined;
        try {
            return await this.db.transaction(async db => {
                await advisoryTransactionLock(db, `exam-screenshots:${attemptId}`);
                const { data: attempt, error } = await db.from('cbt_exam_attempts')
                    .select('user_id, exam_id, device_fingerprint, status').eq('id', attemptId).maybeSingle();
                if (error) throw new ServiceUnavailableException('Sesi belum dapat diperiksa.');
                if (!attempt || attempt.user_id !== user.id || !deviceId || attempt.device_fingerprint !== deviceId) throw new ForbiddenException('Sesi screenshot tidak sesuai.');
                const { data: exam } = await db.from('cbt_exams').select('metadata').eq('id', attempt.exam_id).maybeSingle();
                if (exam?.metadata?.screenshot_enabled !== true) throw new ForbiddenException('Screenshot tidak diaktifkan pada ujian ini.');
                const { data: event, error: eventError } = await db.from('cbt_attempt_security_logs')
                    .select('id, event_type, created_at').eq('attempt_id', attemptId)
                    .contains('metadata', { client_event_id: clientEventId, source: 'student' }).maybeSingle();
                if (eventError) throw new ServiceUnavailableException('Catatan kejadian belum dapat diperiksa.');
                const [clock] = await db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
                const now = new Date(clock.now);
                if (!event || !SCREENSHOT_EVENTS.includes(event.event_type)) throw new BadRequestException('Kejadian screenshot tidak valid.');
                const hash = createHash('sha256').update(image).digest('hex');
                const { data: previous, error: previousError } = await db.from('cbt_exam_screenshots').select('id, content_hash')
                    .eq('event_id', event.id).maybeSingle();
                if (previousError) throw new ServiceUnavailableException('Penyimpanan screenshot belum siap.');
                if (previous) {
                    if (previous.content_hash !== hash) throw new BadRequestException('Bukti untuk kejadian ini sudah tersimpan.');
                    return { saved: true, id: previous.id };
                }
                const age = now.getTime() - Date.parse(event.created_at);
                if (age < -5000 || age > 120_000 || !['in_progress', 'submitted', 'auto_submitted'].includes(attempt.status)) throw new BadRequestException('Waktu pengiriman screenshot sudah lewat.');
                const { data: rows, error: rowsError } = await db.from('cbt_exam_screenshots').select('created_at').eq('attempt_id', attemptId);
                if (rowsError) throw new ServiceUnavailableException('Kuota screenshot belum dapat diperiksa.');
                if ((rows || []).length >= SCREENSHOT_LIMIT) return { saved: false, reason: 'limit' };
                if ((rows || []).some((row: { created_at: string }) => now.getTime() - Date.parse(row.created_at) < SCREENSHOT_INTERVAL_MS)) return { saved: false, reason: 'cooldown' };
                const id = randomUUID();
                const objectKey = `exam-evidence/${now.toISOString().slice(0, 10)}/${id}.bin`;
                const stored = await this.storage.putObject(objectKey, encryptScreenshot(image, key), 'application/octet-stream');
                if (!stored.success) throw new ServiceUnavailableException('Screenshot belum berhasil disimpan.');
                uploadedKey = objectKey;
                const { error: insertError } = await db.from('cbt_exam_screenshots').insert({ id, attempt_id: attemptId, event_id: event.id,
                    event_type: event.event_type, object_key: objectKey, content_type: contentType, byte_size: image.length, content_hash: hash,
                    created_at: now.toISOString(), expires_at: new Date(now.getTime() + SCREENSHOT_RETENTION_MS).toISOString() });
                if (insertError) throw new ServiceUnavailableException('Catatan screenshot belum berhasil disimpan.');
                return { saved: true, id };
            });
        } catch (error) {
            if (uploadedKey) await this.storage.deleteObject(uploadedKey);
            throw error;
        }
    }

    private async assertViewer(user: AuthUser, attemptId: string) {
        const { data: attempt } = await this.db.from('cbt_exam_attempts').select('exam_id, user_id').eq('id', attemptId).maybeSingle();
        if (!attempt || attempt.user_id === user.id) throw new ForbiddenException('Bukti hanya tersedia bagi pengawas berwenang.');
        const students = await this.authz.assertExamMonitoring(user, attempt.exam_id);
        if (students && !students.includes(attempt.user_id)) throw new ForbiddenException('Peserta berada di luar ruang tugas Anda.');
    }
    async list(user: AuthUser, attemptId: string) {
        await this.assertViewer(user, attemptId);
        const { data, error } = await this.db.from('cbt_exam_screenshots').select('id, event_type, byte_size, created_at, expires_at, deleted_at')
            .eq('attempt_id', attemptId).order('created_at', { ascending: false });
        if (error) throw new ServiceUnavailableException('Daftar screenshot belum dapat dibaca.');
        return (data || []).map((row: { id: string; deleted_at?: string; expires_at: string }) => ({ ...row, available: !row.deleted_at && Date.parse(row.expires_at) > Date.now() }));
    }
    async read(user: AuthUser, id: string) {
        const { data: row } = await this.db.from('cbt_exam_screenshots').select('*').eq('id', id).maybeSingle();
        if (!row) throw new NotFoundException('Screenshot tidak ditemukan.');
        await this.assertViewer(user, row.attempt_id);
        if (!row.object_key || row.deleted_at || Date.parse(row.expires_at) <= Date.now()) throw new NotFoundException('Masa simpan screenshot telah berakhir.');
        const obj = await this.storage.getObject(row.object_key);
        if (!obj) throw new NotFoundException('Screenshot tidak tersedia.');
        const chunks: Buffer[] = []; let bytes = 0;
        for await (const chunk of obj.stream) {
            bytes += chunk.length;
            if (bytes > SCREENSHOT_BYTES + 28) throw new ServiceUnavailableException('Ukuran bukti tidak valid.');
            chunks.push(Buffer.from(chunk));
        }
        return { body: decryptScreenshot(Buffer.concat(chunks), this.key()), contentType: row.content_type };
    }

    onModuleInit() { this.timer = setInterval(() => void this.cleanup(), 60 * 60 * 1000); this.timer.unref(); void this.cleanup(); }
    onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
    async cleanup() {
        if (this.running || !this.storage.status().configured) return;
        this.running = true;
        try {
            const { data, error } = await this.db.from('cbt_exam_screenshots').select('id, object_key').is('deleted_at', null)
                .lte('expires_at', new Date().toISOString()).limit(100);
            if (error) throw new Error(error.message);
            for (const row of data || []) {
                const result = row.object_key ? await this.storage.deleteObject(row.object_key) : { success: true };
                if (result.success) await this.db.from('cbt_exam_screenshots').update({ object_key: null, deleted_at: new Date().toISOString() }).eq('id', row.id);
            }
            await this.storage.deleteExpiredEvidenceObjects(new Date(Date.now() - SCREENSHOT_RETENTION_MS));
        } catch (error) { this.logger.warn(`Pembersihan screenshot akan dicoba kembali: ${(error as Error).message}`); }
        finally { this.running = false; }
    }
}
