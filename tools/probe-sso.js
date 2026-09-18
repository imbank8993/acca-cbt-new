/**
 * Uji hidup alur masuk CBT dari acca-new.
 *
 * CBT tidak punya halaman login: pengguna masuk di acca-new, dan acca-new
 * mengarahkan ke `/api/auth/sso?token=…` dengan tiket berumur 5 menit yang
 * ditandatangani CBT_SSO_SECRET. Skrip ini MENIRU acca-new — merakit tiket yang
 * bentuknya persis sama dengan yang dibuat `apps/web/app/api/sso/cbt/route.ts`
 * di sana — lalu menelusuri seluruh sisanya:
 *
 *   tiket -> NestJS POST /auth/sso        (verifikasi + sinkron peran + terbit JWT)
 *   tiket -> Next.js GET /api/auth/sso    (cookie cbt_session + pengalihan)
 *   cookie -> Next.js GET /api/auth/me    (sesi terbaca kembali)
 *
 * Jalankan NestJS (dan Next.js bila ingin menguji dua langkah terakhir) lebih
 * dulu, lalu:
 *
 *   node tools/probe-sso.js
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { SignJWT } = require('jose');

require('dotenv').config({ path: path.join(__dirname, '..', 'apps', 'api', '.env') });

const NEST = 'http://127.0.0.1:3004/api';
const WEB = process.env.PROBE_WEB_URL || 'http://127.0.0.1:3003';
const prisma = new PrismaClient();

function ok(cond) {
    return cond ? 'OK  ' : 'GAGAL';
}

/** Tiket SSO seperti yang diterbitkan acca-new. */
async function buatTiket(claims, secret, umur = '5m') {
    return new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(umur)
        .sign(new TextEncoder().encode(secret));
}

async function main() {
    const secret = process.env.CBT_SSO_SECRET;
    if (!secret) {
        console.log('CBT_SSO_SECRET belum diset di apps/api/.env — uji dihentikan.');
        return;
    }

    // Pengguna nyata yang punya keanggotaan CBT.
    const [subjek] = await prisma.$queryRawUnsafe(`
        SELECT u.id, u.email, p.full_name
        FROM auth.users u
        JOIN cbt_profiles p ON p.id = u.id
        JOIN cbt_organization_members m ON m.user_id = u.id
        LIMIT 1
    `);

    if (!subjek) {
        console.log('Tidak ada pengguna CBT di acca_db — uji dihentikan.');
        return;
    }

    console.log(`Subjek uji : ${subjek.full_name} <${subjek.email}>`);
    console.log(`auth.users : ${subjek.id}\n`);

    const klaim = {
        sub: subjek.id,
        email: subjek.email,
        name: subjek.full_name,
        role: 'Siswa',
        accessToken: 'token-acca-new-tiruan',
        refreshToken: 'refresh-acca-new-tiruan',
    };

    // ── 1. NestJS menukar tiket jadi sesi ────────────────────────────────────
    const tiket = await buatTiket(klaim, secret);
    const res1 = await fetch(`${NEST}/auth/sso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tiket }),
    });
    const body1 = await res1.json();
    console.log(`${ok(res1.status === 200 && !!body1.access_token)}  NestJS POST /auth/sso -> ${res1.status}`);
    if (body1.access_token) {
        console.log(`       peran dari database : ${body1.user.roles.join(', ') || '(kosong)'}`);
        console.log(`       bestRole            : ${body1.user.bestRole}`);
        console.log(`       organisasi          : ${body1.user.organizationIds.length}`);
    } else {
        console.log(`       ${JSON.stringify(body1)}`);
    }

    // ── 2. Tiket palsu harus ditolak ─────────────────────────────────────────
    const tiketPalsu = await buatTiket(klaim, 'rahasia-yang-salah');
    const res2 = await fetch(`${NEST}/auth/sso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tiketPalsu }),
    });
    console.log(`\n${ok(res2.status === 401)}  tiket bertanda tangan salah -> ${res2.status} (harus 401)`);

    // ── 3. Tiket kedaluwarsa harus ditolak ───────────────────────────────────
    const tiketBasi = await buatTiket(klaim, secret, '-1s');
    const res3 = await fetch(`${NEST}/auth/sso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tiketBasi }),
    });
    console.log(`${ok(res3.status === 401)}  tiket kedaluwarsa -> ${res3.status} (harus 401)`);

    // ── 4. Tiket untuk akun yang tidak ada harus ditolak ──────────────────────
    const tiketAsing = await buatTiket(
        { ...klaim, sub: '00000000-0000-0000-0000-000000000000' },
        secret,
    );
    const res4 = await fetch(`${NEST}/auth/sso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tiketAsing }),
    });
    console.log(`${ok(res4.status === 401)}  tiket untuk akun asing -> ${res4.status} (harus 401)`);

    // ── 5. Lewat Next.js: cookie + pengalihan ────────────────────────────────
    console.log('\n──── lewat Next.js ────');
    let webHidup = true;
    const tiketWeb = await buatTiket(klaim, secret);
    let cookie = '';
    try {
        const res5 = await fetch(`${WEB}/api/auth/sso?token=${encodeURIComponent(tiketWeb)}`, {
            redirect: 'manual',
        });
        const setCookie = res5.headers.get('set-cookie') || '';
        const lokasi = res5.headers.get('location') || '';
        cookie = (setCookie.match(/cbt_session=[^;]+/) || [''])[0];

        console.log(`${ok(res5.status === 307 || res5.status === 302)}  GET /api/auth/sso -> ${res5.status}`);
        console.log(`${ok(!!cookie)}  cookie cbt_session diterbitkan`);
        console.log(`${ok(/httponly/i.test(setCookie))}  cookie httpOnly`);
        console.log(`${ok(lokasi.includes('sso_role='))}  dialihkan ke ${lokasi || '(kosong)'}`);
    } catch {
        webHidup = false;
        console.log('LEWAT  Next.js tidak berjalan di ' + WEB + ' — dua langkah terakhir dilewati.');
    }

    // ── 6. Cookie itu benar-benar jadi sesi ──────────────────────────────────
    if (webHidup && cookie) {
        const res6 = await fetch(`${WEB}/api/auth/me`, { headers: { cookie } });
        const body6 = await res6.json();
        console.log(
            `${ok(res6.status === 200 && body6.success && body6.id === subjek.id)}  GET /api/auth/me dengan cookie -> ${res6.status} ${body6.email || ''} (${body6.bestRole || '-'})`,
        );

        const res7 = await fetch(`${WEB}/api/auth/me`);
        console.log(`${ok(res7.status === 401)}  GET /api/auth/me tanpa cookie -> ${res7.status} (harus 401)`);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
