-- Bahan ajar video YouTube disimpan dengan format 'youtube' (tautan baku di content_html).
-- CHECK format bawaan 20261004_02 belum mengenal nilai ini, sehingga menyimpan materi
-- YouTube gagal ("Gagal menyimpan bahan ajar."). Ganti CHECK lama (nama apa pun) dengan
-- daftar yang sama dengan UpdateMaterialDto. Aman dijalankan ulang.
BEGIN;
DO $$
DECLARE c record;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.cbt_learning_materials'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%format%'
    LOOP
        EXECUTE format('ALTER TABLE public.cbt_learning_materials DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;
ALTER TABLE public.cbt_learning_materials ADD CONSTRAINT cbt_learning_materials_format_check
    CHECK (format IN ('html', 'word', 'latex', 'text', 'pdf', 'image', 'audio', 'video', 'youtube', 'attachment'));
COMMIT;
