/**
 * Helper KOP Sekolah & Tata Letak Dokumen A4 untuk Berita Acara & Daftar Hadir PAS.
 * Disamakan 100% dengan KOP Laporan Bulanan Guru Asuh & LCKH pada acca-new
 * (`apps/web/lib/lckh/print-shared.ts` & `apps/web/lib/guru-asuh/laporan-report.ts`).
 */

const MADRASAH_JENJANG = ['MI', 'MTs', 'MA', 'MAK'];

export interface ProfilSekolah {
    nama?: string | null;
    jenjang?: string | null;
    jenis?: string | null;
    alamat?: string | null;
    desa_kelurahan?: string | null;
    kecamatan?: string | null;
    kabupaten_kota?: string | null;
    provinsi?: string | null;
    kode_pos?: string | null;
    telepon?: string | null;
    email?: string | null;
    website?: string | null;
    logo_url?: string | null;
    kepala_sekolah_nama?: string | null;
    kepala_sekolah_nip?: string | null;
}

export function escHtml(v: unknown): string {
    if (v === null || v === undefined) return '';
    return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function kotaKedudukan(profil: ProfilSekolah | null | undefined): string {
    const raw = (profil?.kabupaten_kota || '').trim();
    if (!raw) return '';
    return raw.replace(/^(kabupaten|kota)\s+/i, '').trim();
}

export function kabupatenKotaLabel(profil: ProfilSekolah | null | undefined): string {
    const raw = (profil?.kabupaten_kota || '').trim();
    if (!raw) return '';
    if (/^(kabupaten|kota)\s+/i.test(raw)) return raw;
    return `Kabupaten ${raw}`;
}

export function formatKopParts(profil: ProfilSekolah | null | undefined) {
    const p = profil || {};
    const jenjang = (p.jenjang || '').trim().toUpperCase();
    const namaUpper = (p.nama || 'MADRASAH').toUpperCase();
    const isMadrasah =
        MADRASAH_JENJANG.includes(jenjang) ||
        /\b(MAN|MTSN|MIN|MADRASAH)\b/i.test(namaUpper);

    const kabLabel = kabupatenKotaLabel(p).toUpperCase();
    const kemenagLine1 = isMadrasah ? 'KEMENTERIAN AGAMA REPUBLIK INDONESIA' : '';
    const kemenagLine2 = isMadrasah
        ? `KANTOR KEMENTERIAN AGAMA${kabLabel ? ` ${kabLabel}` : ''}`
        : '';

    const alamatParts = [
        p.alamat,
        p.desa_kelurahan ? `Kel./Desa ${p.desa_kelurahan}` : '',
        p.kecamatan ? `Kec. ${p.kecamatan}` : '',
        p.kabupaten_kota,
        p.provinsi,
        p.kode_pos,
    ].filter((x) => x && String(x).trim());
    const alamatLine = alamatParts.join(', ');

    const kontakParts = [
        p.telepon ? `Telp. ${p.telepon}` : '',
        p.email ? `Pos-el: ${p.email}` : '',
        p.website ? `Laman: ${p.website}` : '',
    ].filter((x) => x && String(x).trim());
    const kontakLine = kontakParts.join(' · ');

    return {
        isMadrasah,
        kemenagLine1,
        kemenagLine2,
        namaMadrasah: namaUpper,
        alamatLine,
        kontakLine,
        logoUrl: p.logo_url || '',
    };
}

/**
 * Membangun HTML KOP surat (letterhead) resmi dari data `profil_sekolah`.
 *
 * Tata letak tiga kolom: logo | teks | ruang kosong selebar logo, sehingga
 * teks selalu simetris di tengah halaman dan tidak menabrak logo. Berikan
 * `logoSrc` (PNG data URL dari `loadKopLogo`) agar logo pasti ikut tercetak
 * walaupun berkas aslinya berada di host lain.
 */
export function renderKopHTML(
    profil: ProfilSekolah | null | undefined,
    options: { logoSrc?: string | null } = {},
): string {
    const parts = formatKopParts(profil);

    const kemenagLines = parts.isMadrasah
        ? `<div class="kop-kemenag">${escHtml(parts.kemenagLine1)}</div>
           <div class="kop-kemenag">${escHtml(parts.kemenagLine2)}</div>`
        : '';

    const logoSrc = options.logoSrc || parts.logoUrl;
    const logo = logoSrc
        ? `<img src="${escHtml(logoSrc)}" class="kop-logo" alt="Logo ${escHtml(parts.namaMadrasah)}" />`
        : '';

    return `
    <div class="kop">
      <div class="kop-logo-cell">${logo}</div>
      <div class="kop-text">
        ${kemenagLines}
        <div class="kop-nama">${escHtml(parts.namaMadrasah)}</div>
        ${parts.alamatLine ? `<div class="kop-alamat">${escHtml(parts.alamatLine)}</div>` : ''}
        ${parts.kontakLine ? `<div class="kop-alamat">${escHtml(parts.kontakLine)}</div>` : ''}
      </div>
      <div class="kop-logo-cell" aria-hidden="true"></div>
    </div>
    <div class="kop-rule-thick"></div>
    <div class="kop-rule-thin"></div>`;
}

/**
 * CSS KOP dan dokumen A4 yang disamakan dengan Laporan Bulanan Guru Asuh (`acca-new`).
 */
export const KOP_AND_A4_CSS = `
  @page { size: A4 portrait; margin: 10mm 15mm 15mm 20mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Times New Roman', serif; font-size: 10.5pt; color: #000; width: 794px; margin: 0 auto; background: #fff; }
  .page { padding: 10mm 15mm 15mm 20mm; width: 100%; }
  @media print {
      body { width: 100%; margin: 0; zoom: 1 !important; }
      .page { padding: 0; }
  }
  @media screen and (max-width: 820px) {
      body { zoom: calc(100vw / 820); }
  }
  .kop { display: grid; grid-template-columns: 84px minmax(0, 1fr) 84px; align-items: center; column-gap: 10px; min-height: 84px; break-inside: avoid; }
  .kop-logo-cell { width: 84px; height: 84px; display: flex; align-items: center; justify-content: center; }
  .kop-logo { display: block; max-width: 84px; max-height: 84px; width: auto; height: auto; object-fit: contain; }
  .kop-text { text-align: center; min-width: 0; }
  .kop-kemenag { font-size: 12pt; font-weight: bold; text-transform: uppercase; line-height: 1.25; }
  .kop-nama { font-size: 15pt; font-weight: bold; text-transform: uppercase; line-height: 1.25; }
  .kop-alamat { font-size: 9pt; color: #222; line-height: 1.25; }
  .kop-rule-thick { border-top: 3px solid #000; margin-top: 6px; }
  .kop-rule-thin { border-top: 1px solid #000; margin-top: 2px; margin-bottom: 16px; }

  .doc-title { text-align: center; margin: 14px 0 4px; }
  .doc-title h1 { font-size: 12.5pt; text-decoration: underline; text-underline-offset: 4px; letter-spacing: 1px; }
  .doc-sub { text-align: center; font-size: 10pt; margin-bottom: 14px; }

  .narrative { text-align: justify; margin: 0 0 10px; font-size: 10pt; line-height: 1.45; }

  .meta-table { width: 100%; margin-bottom: 12px; font-size: 10pt; border-collapse: collapse; }
  .meta-table td { padding: 1.5px 0; vertical-align: middle; }
  .meta-table td:first-child { width: 125px; }
  .meta-table td:nth-child(2) { width: 14px; }
  .status-text { display: inline-flex; align-items: center; gap: 2px; color: #2563eb; font-size: 10pt; font-weight: normal; line-height: 1; vertical-align: middle; }

  .section-heading { font-weight: bold; font-size: 10pt; margin: 10px 0 5px; text-transform: uppercase; }

  table.entries { width: 100%; border-collapse: collapse; font-size: 9pt; margin-bottom: 14px; }
  table.entries th, table.entries td { border: 1px solid #333; padding: 5px 6px; text-align: left; vertical-align: top; }
  table.entries th { background: #f1f5f9; font-weight: normal; text-align: center; }

  .notes-box { border: 1px solid #333; padding: 7px 9px; font-size: 9.5pt; margin-bottom: 14px; background: #fff; line-height: 1.4; }

  .approval-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 20px; page-break-inside: avoid; }
  .ttd-table { font-size: 10pt; border-collapse: collapse; margin-top: 0; table-layout: fixed; width: 100%; min-width: 0; }
  .ttd-table td { padding: 4px 0; vertical-align: top; }
  .ttd-table td:first-child { width: 135px; font-weight: normal; }
  .ttd-table td:nth-child(2) { width: 14px; }
  .ttd-table td:last-child { overflow-wrap: anywhere; }
  .ttd-nip { font-size: 8.5pt; color: #555; }
  .verify-wrap { display: flex; flex-direction: column; align-items: center; text-align: center; margin-top: 0; margin-left: 20px; gap: 2px; flex-shrink: 0; }
  .verify-qr { width: 64px; height: 64px; display: block; }
  .verify-label { font-size: 7pt; color: #555; text-align: center; }
  .verify-id { font-family: 'Courier New', monospace; font-size: 6.5pt; color: #777; letter-spacing: 0.5px; text-align: center; }
  .pending-note { margin-top: 22px; padding: 10px 14px; border: 1px dashed #cbd5e1; border-radius: 6px; font-size: 9pt; color: #64748b; text-align: center; font-style: italic; }
`;

