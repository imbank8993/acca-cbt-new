/**
 * Alias untuk `/api/auth/sso`.
 *
 * Endpoint ini sempat dibuat sebagai "pengganti" `/api/auth/sso` saat versi lama
 * di sana masih berbasis Supabase. Sekarang `/api/auth/sso` sendiri sudah
 * memakai NestJS, jadi menyimpan dua salinan logika yang sama hanya menyiapkan
 * jalan bagi keduanya untuk berbeda diam-diam. Implementasinya satu, di
 * `../sso/route.ts`; alamat ini dipertahankan supaya tautan yang terlanjur
 * menunjuk ke sini tidak mati.
 */
export { GET } from '../sso/route';
