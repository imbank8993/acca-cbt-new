# apps/api — backend NestJS

Seluruh akses database dan otorisasi CBT ada di sini. `apps/web` tidak pernah
menyentuh PostgreSQL.

## Menjalankan

```bash
cp .env.example .env     # isi DATABASE_URL, JWT_SECRET, INTERNAL_API_KEY
npm run prisma:pull      # tarik skema dari acca_db
npm run prisma:generate
npm run start:dev        # http://127.0.0.1:3009/api  — Swagger di /api/docs
```

Dari root monorepo: `npm run dev:backend`

## Adapter query bergaya Supabase

`src/prisma/prisma-db-adapter.ts` menyediakan `DbService.from()` yang meniru API
`supabase.from()` di atas PostgreSQL. Tujuannya tunggal: memindahkan 577 query
dari server action tanpa menerjemahkan ulang satu per satu.

```ts
constructor(private readonly db: DbService) {}

const { data, error } = await this.db
  .from('cbt_exam_attempts')
  .select('id, profiles:cbt_profiles(full_name), answers:cbt_answers(*)')
  .eq('exam_id', examId)
  .in('status', ['submitted', 'auto_submitted']);
```

Yang didukung: select bersarang berapa pun tingkatnya (belongs-to maupun
has-many), `!inner`, filter jalur bertitik (`.eq('member_roles.roles.name', 'Siswa')`),
agregat `relasi(count)`, `upsert` dengan `onConflict`, `not`, `or`, `contains`,
`match`, `range`, `single`/`maybeSingle`, dan `count: 'exact'`.

Relasi diselesaikan dari **foreign key asli** yang dibaca sekali dari
`information_schema` (`src/prisma/relation-registry.ts`), bukan ditebak dari nama
tabel. Versi adapter di acca-new memakai heuristik nama dengan daftar join yang
ditulis manual per modul, dan itu tidak bisa menangani relasi has-many maupun
select bersarang tiga tingkat yang dipakai CBT.

Ini **jembatan migrasi, bukan tujuan akhir**. Query di jalur panas (autosave
jawaban, monitoring) sebaiknya dipindahkan ke Prisma idiomatik setelah paritas
perilakunya terbukti.

Cakupannya diukur terhadap database sungguhan:

```bash
npm run check:adapter
```

## Autentikasi

`JWT_SECRET` **sama persis dengan acca-new**, sehingga token acca-new langsung
sah di sini. Verifikasi dilakukan terhadap `auth.users` (schema Supabase yang
ikut ter-restore) dengan bcrypt.

Peran TIDAK diambil dari klaim token. `JwtStrategy` membacanya ulang dari
database pada setiap permintaan, jadi token yang dirakit sendiri tidak bisa
menaikkan hak akses.

`AuthUsersRepository` menggantikan seluruh `supabase.auth.admin.*`. Penghapusan
pengguna dibuat **lunak** — `cbt_profiles.id` merujuk `auth.users.id` dengan
`ON DELETE CASCADE`, sehingga menghapus permanen akan ikut melenyapkan seluruh
jejak ujian, jawaban, dan nilai peserta.

## Struktur

```
src/
  main.ts              bind ke 127.0.0.1, prefix /api, Swagger
  app.module.ts        pendaftaran modul
  prisma/              PrismaService, RelationRegistry, DbService, compiler select
  auth/                JWT, guard, peran, repositori auth.users, penukaran SSO
  common/              filter, interceptor, dekorator
  scoring/             klien HTTP ke FastAPI
  health/
```

Modul domain ditambahkan bertahap — urutannya di
[docs/MIGRASI_BACKEND.md](../../docs/MIGRASI_BACKEND.md).
