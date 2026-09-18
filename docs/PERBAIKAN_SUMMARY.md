# 📋 SUMMARY PERBAIKAN BANK SOAL

## ✅ Masalah yang Sudah Diperbaiki

### 1. **Prevent Duplicate Import** ✅
**File:** `app/dashboard/proktor/questions/[bankId]/page.tsx`

**Perbaikan:**
- Menambahkan checking `existingTexts` sebelum import
- Skip soal yang sudah ada (berdasarkan `question_text`)
- Menampilkan alert jumlah soal yang di-skip

```typescript
const existingTexts = new Set(
    questions.map(q => (q.question_text || '').trim().toLowerCase())
);

// Check duplicate sebelum import
if (existingTexts.has(textKey)) {
    skipped++;
    continue;
}
```

---

### 2. **Stimulus Tidak Tersimpan** ✅
**File:** `app/components/questions/StimulusManager.tsx`

**Perbaikan:**
- Validasi HTML kosong dengan strip tags dulu
- Error handling yang lebih baik

```typescript
const strippedContent = content.replace(/<[^>]*>/g, '').trim();
if (!strippedContent) return alert("Konten stimulus tidak boleh kosong");
```

---

### 3. **Bug Opsi Duplikat (Puluhan Opsi)** ✅
**File:** `app/actions/question.ts`

**Perbaikan:**
- Ubah urutan: **DELETE dulu, INSERT kemudian**
- Hapus logika `upsert` yang kompleks
- Gunakan `insert` biasa untuk opsi baru

```typescript
// DELETE semua opsi lama DULU
await supabase.from('bank_question_options').delete().eq('question_id', data.id);

// INSERT opsi baru yang fresh
await supabase.from('bank_question_options').insert(optionsToInsert);
```

---

### 4. **Delete Question dengan Error Handling** ✅
**File:** `app/actions/question.ts`

**Perbaikan:**
- Check apakah soal digunakan di exam attempts
- Tampilkan pesan error yang jelas
- Prevent delete jika soal sudah diujikan

---

### 5. **Stimulus & Petunjuk di Export/Import** ✅

**File Baru:**
- `lib/export-template.ts` - Export dengan stimulus & petunjuk
- `lib/import-template.ts` - Template import sederhana

**Fitur:**
- ✅ Stimulus menggunakan kode huruf (A, B, C...)
- ✅ Petunjuk menggunakan kode huruf (A, B, C...)
- ✅ Format export = format import (bisa re-import)
- ✅ Desain sederhana: header abu-abu, border hitam, teks hitam
- ✅ Tabel terpisah untuk daftar stimulus & petunjuk

**Format Tabel:**
```
| No | Tipe | Stim | Pet | Soalunci | Poin |
|----|------|------|-----|------|-------|------|
| 1  | PG   | A    | B   | ...  | C     | 10   |
```

**Daftar Stimulus:**
```
| Kode | Judul | Konten |
|------|-------|--------|
| A    | ...   | ...    |
| B    | ...   | ...    |
```

---

## 🔧 Cara Menggunakan Fitur Baru

### Export Soal dengan Stimulus
1. Buka bank soal
2. Klik **Export** → **Daftar Soal (Word)**
3. File akan berisi:
   - Tabel soal dengan kolom Stimulus & Petunjuk
   - Daftar stimulus di bawah (dengan kode A, B, C...)
   - Daftar petunjuk di bawah (dengan kode A, B, C...)

### Import Soal dengan Stimulus
1. Download **Template Import**
2. Isi kolom **Stim** dengan kode huruf (A/B/C) sesuai stimulus yang diinginkan
3. Isi kolom **Pet** dengan kode huruf (A/B/C) sesuai petunjuk yang diinginkan
4. Upload file

---

## 📊 Status Implementasi

| Fitur | Status | File |
|-------|--------|------|
| ✅ Prevent duplicate import | **Done** | `page.tsx` |
| ✅ Stimulus validation | **Done** | `StimulusManager.tsx` |
| ✅ Fix opsi duplikat | **Done** | `actions/question.ts` |
| ✅ Delete error handling | **Done** | `actions/question.ts` |
| ✅ Export templ| **Done** | `lib/export-template.ts` |
| ✅ Import template baru | **Done** | `lib/import-template.ts` |
| ⚠️ Integrasi ke page.tsx | **Perlu update** | `page.tsx` (line 366-515) |

---

## 🚀 Langkah Selanjutnya

### Update `page.tsx` untuk menggunakan template baru:

**Ganti fungsi `handleExportWord` (line 366):**
```typescript
const handleExportWord = async () => {
    const { exportQuestionsToWord } = await import('@/lib/export-template');
    const blob = await exportQuestionsToWord(questions, stimuliList, instructionsList, bankInfo);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `soal_${(bankInfo?.title || 'bank').replace(/\s+/g, '_')}_${Date.now()}.docx`;
    a.click();
    window.URL.revokeObjectURL(url);
};
```

**Ganti fungsi `handleExportTemplate` (line 515):**
```typescript
const handleExportTemplate = async () => {
    const { generateImportTemplate } = await import('@/lib/import-template');

    const stimuliWithCodes = stimuliList.map((s, idx) => ({
        code: String.fromCharCode(65 + idx),
        title: s.title || 'Tanpa Judul',
        content: s.content || ''
    }));

    const instCodes = instructionsList.map((ins, idx) => ({
        code: String.fromCharCode(65 + idx),
        title: ins.title || 'Tanpa Judul',
        content: ins.content || ''
    }));

    const blob = await generateImportTemplate(
        bankInfo?.title || 'Bank Soal',
        stimuliWithCodes,
        instructionsWithCodes
    );

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `template_import_${(bankInfo?.title || 'bank').replace(/\s+/g, '_')}.docx`;
    a.click();
    window.URL.revokeObjectURL(url);
};
```

---

## 🧪 Testing Checklist

- [ ] Test export soal dengan stimulus
- [ ] Test export template import
- [ ] Test import file yang sudah di-export
- [ ] Test prevent duplicate import
- [ ] Verifikasi stimulus tersimpan dengan benar
- [ ] Verifikasi tidak ada opsi duplikat lagi

---

## 📝 Catatan Penting

1. **Fungsi export lama** (line 366-810) bisa dihapus setelah testing
2. **Import parser** di `lib/doc-parser.ts` sudah support kolom Stimulus & Petunjuk
3. **Database migration** untuk `organization_id` di `question_stimuli` sudah dibuat
4. **SQL cleanup** untuk opsi duplikat sudah dijalankan

---

Semua perbaikan sudah selesai! Tinggal update 2 fungsi di `page.tsx` dan testing. 🎉
