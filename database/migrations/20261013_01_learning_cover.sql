ALTER TABLE cbt_learning_materials ADD COLUMN IF NOT EXISTS cover_data text NOT NULL DEFAULT '';
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cbt_learning_cover_size' AND conrelid = 'cbt_learning_materials'::regclass) THEN
        ALTER TABLE cbt_learning_materials ADD CONSTRAINT cbt_learning_cover_size CHECK (octet_length(cover_data) <= 160000);
    END IF;
END $$;
