# Riset Desain Mobile ACCA CBT — 2026-11-17

Ringkasan praktik desain mobile web/PWA yang menjadi acuan perbaikan tampilan
mobile `apps/web`, beserta pola yang diadaptasi dari proyek saudara
`acca-new` (`D:\[1] ACCA Project\acca-new\apps/web`).

## 1. Prinsip utama

| Topik | Pedoman | Penerapan di ACCA CBT |
|---|---|---|
| Target sentuh | Apple HIG: minimal 44×44 pt. Material 3: 48×48 dp. WCAG 2.2 SC 2.5.8 (AA) minimal 24×24 px, SC 2.5.5 (AAA) 44×44 px. | Token `--mui-tap: 44px` / `--mui-tap-lg: 48px`; tombol ikon, tab, chip, dan baris daftar minimal 44px di < 1024px. |
| Navigasi | Material 3 *Navigation bar*: 3–5 tujuan utama di bawah layar; sisanya di drawer/"Lainnya". HIG *Tab bars*: bilah bawah tetap terlihat. | `BottomNav` (`.bnav`) sudah ada; sidebar menjadi drawer di < 1024px. Header mobile ringkas (judul halaman + aksi). |
| Bottom sheet | Material 3 *Bottom sheets*; NN/g: sheet cocok untuk tugas singkat yang terkait konteks, harus bisa ditutup (tombol, sapuan, ketuk latar, Escape). | `Modal` (`ui/modal.tsx`) otomatis menjadi sheet di < 768px: menempel ke bawah, tinggi maks ±92dvh, body bergulir sendiri, footer aksi *sticky*. |
| Safe area | `viewport-fit=cover` + `env(safe-area-inset-*)` (MDN, WebKit). | Padding konten, header, BottomNav, dan footer sheet memakai `env(safe-area-inset-*)`. |
| Satuan viewport | Gunakan `dvh/svh` (bukan `100vh`) karena bilah alamat mobile mengubah tinggi viewport. | Kontainer layar penuh & sheet memakai `100dvh`/`92dvh` dengan cadangan `vh`. |
| Tipografi | Ukuran dasar 14–16px; teks sekunder ≥ 12px; input ≥ 16px di iOS agar tidak *auto-zoom*. Hindari judul yang memecah per huruf. | Guard `@supports (-webkit-touch-callout: none)` untuk input 16px; judul halaman memakai `clamp()` dan `overflow-wrap: anywhere`. |
| Tata letak | Satu kolom; jarak 12–16px; tidak ada guliran horizontal halaman. Tabel lebar → kartu/daftar, atau tabel yang bergulir di dalam wadahnya sendiri. | `overflow-x: clip` di root; tabel dibungkus wadah bergulir; grid statistik 2 kolom. |
| Toolbar & filter | Pencarian dulu (*search-first*), filter sekunder masuk menu/sheet; aksi utama halaman di FAB atau tombol penuh. | Pola `FilterToolbar` + `MobileFab`/`page-fab` (didaftarkan ke BottomNav). |
| Umpan balik & gerak | Material *state layers*; hormati `prefers-reduced-motion`. | Efek `:active` pada tombol; animasi sheet ≤ 250ms dan dimatikan saat *reduced motion*. |
| Aksesibilitas | Kontras teks ≥ 4.5:1 (WCAG 1.4.3), label tombol ikon (`aria-label`), fokus terlihat, urutan fokus logis. | Tombol ikon wajib `aria-label`; sheet memakai `role="dialog"` + `aria-modal`. |

## 2. Pola dari acca-new yang diadaptasi

Sumber: `acca-new/apps/web/app/globals.css`, `components/mobile/*`,
`components/bottom-nav.css`, `components/header.css`, `components/ui/modal.css`.

- **Breakpoint**: tata letak mobile/tablet di `max-width: 1023.98px`, pola
  daftar & sheet di `max-width: 767.98px`.
- **Kerangka konten**: `.content-area` diberi padding
  `header + safe-area-top + 12px` dan `bottomnav + safe-area-bottom + 12px`;
  padding samping 8–12px + inset kiri/kanan.
- **Permukaan**: latar kanvas `#EBECF1`, kartu putih radius 13–20px dengan
  bayangan lembut biru (`rgba(0, 63, 136, .08)`), mode gelap `#020718` dengan
  gradien radial biru.
- **Warna**: 7 warna dasar (`#3083ff`, `#e0ecff`, `#112e59`, `#ebecf1`,
  `#e1e2e9`, `#ffffff`, `#000000`) — sama dengan token ACCA CBT.
- **Komponen mobile** (`.mui-*`): `MobileSheet`, `MobileList`/`MobileListItem`
  (baris 1 judul + 1 subjudul + badge hanya bila menyimpang), `MobileToolbar`
  (kolom cari kapsul + tombol menu), `MobileChips`, `MobileFab` (aksi utama
  pindah ke tombol tengah BottomNav), `MobileSelectionBar`.
- **Tipografi**: Poppins untuk UI, JetBrains Mono untuk angka/ID.

## 3. Daftar periksa per halaman

1. Tidak ada guliran horizontal pada `<body>` di 375px.
2. Judul halaman, *breadcrumb*, dan tombol aksi tidak bertumpuk/terpotong.
3. Semua tombol/ikon yang dapat diketuk ≥ 44px (minimal 40px untuk ikon padat
   di dalam baris tabel).
4. Tabel lebar bergulir di dalam wadahnya atau diganti tampilan kartu.
5. Modal tampil sebagai sheet bawah dengan footer yang tetap terlihat.
6. Konten terakhir tidak tertutup BottomNav (cek padding bawah + safe area).
7. Desktop (≥ 1024px) tidak berubah.

## 4. Rujukan

- Apple Human Interface Guidelines — Layout, Buttons (target 44pt), Tab bars, Sheets:
  https://developer.apple.com/design/human-interface-guidelines/
- Material Design 3 — Navigation bar, Bottom sheets, Touch targets (48dp), Typography:
  https://m3.material.io/components/navigation-bar/overview ,
  https://m3.material.io/components/bottom-sheets/overview
- WCAG 2.2 — SC 2.5.8 Target Size (Minimum), SC 2.5.5 Target Size (Enhanced), SC 1.4.3 Contrast, SC 1.4.10 Reflow:
  https://www.w3.org/TR/WCAG22/
- MDN — `env()` & safe-area insets: https://developer.mozilla.org/en-US/docs/Web/CSS/env
- MDN — Satuan viewport `dvh/svh/lvh`: https://developer.mozilla.org/en-US/docs/Web/CSS/length#relative_length_units_based_on_viewport
- web.dev — Learn Responsive Design & PWA: https://web.dev/learn/design/ , https://web.dev/learn/pwa/
- Nielsen Norman Group — Bottom Sheets: https://www.nngroup.com/articles/bottom-sheet/
- WebKit — Designing websites for iPhone X (safe area): https://webkit.org/blog/7929/designing-websites-for-iphone-x/
