#!/usr/bin/env bash
# =============================================================================
# CBT — cek keamanan & index PostgreSQL (HANYA MEMBACA, tidak mengubah apa pun)
# =============================================================================
# Jalankan di VPS dari folder proyek:
#
#   bash tools/vps/cek-database.sh
#
# Yang diperiksa:
#   1. Apakah port PostgreSQL 5432 terbuka ke internet (bukan hanya loopback/Docker).
#   2. Index pada kolom yang dibaca SETIAP permintaan (auth, peran, heartbeat,
#      autosave). Tanpa index, tiap query memindai seluruh tabel.
#   3. Statistik seq scan vs index scan tabel-tabel tersebut.
#   4. Ukuran log Docker kontainer CBT.
#
# Perintah perbaikan hanya DICETAK sebagai saran. Jalankan sendiri di luar jam
# ujian setelah membacanya.
#
# Variabel opsional:
#   APP_DIR=/path/proyek     lokasi proyek (bawaan: folder induk skrip ini)
#   PSQL_URL=postgresql://…  URL psql dari host bila DATABASE_URL di .env tidak cocok
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
ENV_FILE="$APP_DIR/.env"
PG_PORT="${PG_PORT:-5432}"

if [ -t 1 ]; then
  B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; C=$'\e[36m'; N=$'\e[0m'
else
  B=""; G=""; Y=""; R=""; C=""; N=""
fi
ok()    { echo "  ${G}✔${N} $*"; }
warn()  { echo "  ${Y}!${N} $*"; }
fail()  { echo "  ${R}✘${N} $*"; }
title() { echo; echo "${B}${C}== $* ==${N}"; }
die()   { echo "${R}Galat:${N} $*" >&2; exit 1; }

env_get() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^[[:space:]]*$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- \
    | sed -e 's/\r$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" || true
}

psql_url() {
  if [ -n "${PSQL_URL:-}" ]; then echo "$PSQL_URL"; return; fi
  local url; url="$(env_get DATABASE_URL)"
  [ -n "$url" ] || die "DATABASE_URL tidak ditemukan di $ENV_FILE (atau isi PSQL_URL)."
  url="${url//host.docker.internal/127.0.0.1}"
  echo "${url%%\?*}"
}

PSQL_MODE=""
detect_psql() {
  if command -v psql >/dev/null 2>&1; then PSQL_MODE="local:psql"
  elif [ -x /www/server/pgsql/bin/psql ]; then PSQL_MODE="local:/www/server/pgsql/bin/psql"
  elif command -v docker >/dev/null 2>&1; then PSQL_MODE="docker"
  else die "psql tidak ditemukan dan docker tidak tersedia."
  fi
}

sql() {
  local url; url="$(psql_url)"
  [ -n "$PSQL_MODE" ] || detect_psql
  case "$PSQL_MODE" in
    local:*) "${PSQL_MODE#local:}" "$url" -X -A -t -F '|' -v ON_ERROR_STOP=1 -c "$1" ;;
    docker)  docker run --rm -i --network host postgres:16-alpine \
               psql "$url" -X -A -t -F '|' -v ON_ERROR_STOP=1 -c "$1" ;;
  esac
}

# --------------------------------------------------------------------------- #
title "1. Paparan port PostgreSQL ($PG_PORT)"
# --------------------------------------------------------------------------- #
listeners="$(ss -ltnH 2>/dev/null | awk -v p=":$PG_PORT" '$4 ~ p"$" {print $4}' | sort -u || true)"
if [ -z "$listeners" ]; then
  warn "Tidak ada proses yang terlihat mendengarkan port $PG_PORT (atau 'ss' tidak tersedia)."
else
  echo "  Alamat yang didengarkan: $(echo "$listeners" | tr '\n' ' ')"
  public=0
  while read -r addr; do
    host="${addr%:*}"; host="${host#[}"; host="${host%]}"
    case "$host" in
      127.*|::1|localhost) ;;
      172.1[6-9].*|172.2[0-9].*|172.3[01].*|10.*|192.168.*) ;;  # jaringan privat/Docker
      *) public=1 ;;
    esac
  done <<< "$listeners"
  if (( public )); then
    fail "PostgreSQL mendengarkan alamat publik / semua antarmuka (0.0.0.0 atau *)."
    echo "     Bila firewall tidak memblokir $PG_PORT, siapa pun di internet dapat mencoba login"
    echo "     (brute-force ikut memakan CPU database)."
  else
    ok "PostgreSQL hanya mendengarkan loopback/jaringan privat."
  fi
fi

if command -v ufw >/dev/null 2>&1; then
  ufw_state="$(ufw status 2>/dev/null | head -n 1 || true)"
  echo "  UFW: ${ufw_state:-tidak terbaca}"
  if ufw status 2>/dev/null | grep -E "^$PG_PORT(/tcp)?[[:space:]]+ALLOW[[:space:]]+Anywhere" >/dev/null; then
    fail "UFW mengizinkan $PG_PORT dari Anywhere."
  fi
fi
echo "  Catatan: aaPanel punya firewall sendiri (Security → Firewall). Pastikan port $PG_PORT tidak"
echo "  dibuka untuk publik di sana maupun di firewall penyedia VPS."
echo
echo "  ${B}Saran perbaikan (jalankan sendiri, di luar jam ujian):${N}"
echo "   - Tutup $PG_PORT di firewall aaPanel / UFW / penyedia VPS untuk alamat publik;"
echo "     bila perlu akses dari komputer kantor, izinkan HANYA IP tersebut atau pakai SSH tunnel:"
echo "       ssh -L 5432:127.0.0.1:5432 root@<ip-vps>"
echo "   - Kontainer CBT tetap terhubung lewat host.docker.internal (gateway Docker), bukan IP publik."
echo "     Pastikan pg_hba.conf mengizinkan subnet Docker (mis. 172.16.0.0/12) sebelum mempersempit"
echo "     listen_addresses, agar cbt-api dan acca-new tidak terputus."

# --------------------------------------------------------------------------- #
title "2. Index pada kolom yang dibaca setiap permintaan"
# --------------------------------------------------------------------------- #
# tabel|kolom|kegunaan
TARGETS="users|auth_id|auth: status aktif & nama tiap permintaan
cbt_organization_members|user_id|auth: keanggotaan & peran
cbt_member_roles|organization_member_id|auth: daftar peran anggota
cbt_exam_attempts|user_id|auth: peran siswa, refresh sesi ujian
cbt_pas_room_invigilators|user_id|auth: penugasan pengawas
cbt_answers|attempt_id|autosave, submit, monitoring
cbt_attempt_security_logs|attempt_id|heartbeat & kejadian keamanan
cbt_login_history|created_at|kartu login terbaru (polling 30 dtk)"

missing=()
while IFS='|' read -r table column purpose; do
  exists="$(sql "SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='$table' AND column_name='$column'" || true)"
  if [ -z "$exists" ]; then
    warn "public.$table.$column tidak ada — dilewati."
    continue
  fi
  # Index yang KOLOM PERTAMANYA adalah kolom ini dapat dipakai untuk WHERE kolom = …
  idx="$(sql "SELECT string_agg(ic.relname, ', ')
                FROM pg_index i
                JOIN pg_class t  ON t.oid = i.indrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                JOIN pg_class ic ON ic.oid = i.indexrelid
                JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
               WHERE n.nspname = 'public' AND t.relname = '$table' AND a.attname = '$column'
                 AND i.indisvalid" || true)"
  rows="$(sql "SELECT reltuples::bigint FROM pg_class WHERE oid = 'public.$table'::regclass" || echo '?')"
  if [ -n "$idx" ]; then
    ok "public.$table($column) — $idx  (~$rows baris)"
  else
    fail "public.$table($column) TIDAK ber-index (~$rows baris) — $purpose"
    missing+=("$table|$column")
  fi
done <<< "$TARGETS"

if (( ${#missing[@]} )); then
  echo
  echo "  ${B}Saran index (CONCURRENTLY: tidak mengunci tabel; tetap jalankan di luar jam ujian):${N}"
  for item in "${missing[@]}"; do
    table="${item%%|*}"; column="${item#*|}"
    echo "    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${table}_${column} ON public.${table} (${column});"
  done
  echo "  public.users milik acca-new: koordinasikan sebelum menambah index di sana."
fi

# --------------------------------------------------------------------------- #
title "3. Seq scan vs index scan (sejak statistik terakhir di-reset)"
# --------------------------------------------------------------------------- #
printf "  %-28s %14s %14s %12s\n" "tabel" "seq_scan" "idx_scan" "baris_hidup"
sql "SELECT relname, seq_scan, COALESCE(idx_scan,0), n_live_tup
       FROM pg_stat_user_tables
      WHERE schemaname='public' AND relname IN
        ('users','cbt_organization_members','cbt_member_roles','cbt_exam_attempts',
         'cbt_pas_room_invigilators','cbt_answers','cbt_attempt_security_logs','cbt_organizations')
      ORDER BY seq_scan DESC" 2>/dev/null \
  | while IFS='|' read -r rel seq idx live; do
      printf "  %-28s %14s %14s %12s\n" "$rel" "$seq" "$idx" "$live"
    done || warn "Statistik tidak terbaca."
echo "  seq_scan besar pada tabel ber-ribuan baris = query tanpa index yang cocok."

# --------------------------------------------------------------------------- #
title "4. Ukuran log Docker kontainer CBT"
# --------------------------------------------------------------------------- #
if command -v docker >/dev/null 2>&1; then
  for name in $(docker ps -a --format '{{.Names}}' | grep -E 'cbt' || true); do
    file="$(docker inspect --format '{{.LogPath}}' "$name" 2>/dev/null || true)"
    driver="$(docker inspect --format '{{.HostConfig.LogConfig.Type}} {{json .HostConfig.LogConfig.Config}}' "$name" 2>/dev/null || true)"
    size="$( [ -n "$file" ] && du -h "$file" 2>/dev/null | cut -f1 || echo '?')"
    echo "  $name: ${size:-?}  ($driver)"
  done
  echo "  Rotasi aktif bila Config memuat max-size. Kontainer lama baru memakai rotasi setelah dibuat ulang"
  echo "  (docker compose up -d), dan berkas log lama tidak dipotong otomatis."
else
  warn "docker tidak tersedia."
fi
echo
echo "  Ruang disk: $(df -h / | awk 'NR==2 {print $4 " tersedia dari " $2 " (" $5 " terpakai)"}')"
