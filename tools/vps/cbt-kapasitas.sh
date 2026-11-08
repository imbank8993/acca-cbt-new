#!/usr/bin/env bash
# =============================================================================
# ACCA CBT — cek, terapkan, dan pantau kapasitas pengumpulan ujian serentak
# =============================================================================
# Jalankan di VPS dari folder proyek (bawaan /www/wwwroot/acca-cbt-new):
#
#   bash tools/vps/cbt-kapasitas.sh cek           # hanya membaca, tidak mengubah apa pun
#   bash tools/vps/cbt-kapasitas.sh terapkan [N]  # atur DB_CONNECTION_LIMIT di .env lalu
#                                                 # nyalakan ulang cbt-api (N opsional)
#   bash tools/vps/cbt-kapasitas.sh pantau        # pantauan langsung saat ujian (Ctrl+C)
#
# Variabel opsional:
#   APP_DIR=/path/proyek     lokasi proyek (bawaan: folder induk skrip ini)
#   PSQL_URL=postgresql://…  URL psql dari host bila DATABASE_URL di .env tidak cocok
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
ENV_FILE="$APP_DIR/.env"
API_CONTAINER="acca-cbt-api"
DEPLOY_LOCK="/var/lock/acca-cbt-production-deploy.lock"   # sama dengan GitHub Actions
DEFAULT_LIMIT=30
DEFAULT_POOL_TIMEOUT=20
MIN_LIMIT=15
MAX_LIMIT=40
HEADROOM=15   # cadangan koneksi untuk lonjakan aplikasi lain, admin, dan backup

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

# --------------------------------------------------------------------------- #
# Utilitas                                                                     #
# --------------------------------------------------------------------------- #
env_get() {  # env_get KUNCI -> nilai dari .env tanpa tanda kutip (kosong bila tidak ada)
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^[[:space:]]*$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- \
    | sed -e 's/\r$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" || true
}

env_set() {  # env_set KUNCI NILAI -> ganti baris yang ada atau tambahkan di akhir
  local key="$1" value="$2"
  if grep -qE "^[[:space:]]*$key=" "$ENV_FILE"; then
    sed -i -E "s|^[[:space:]]*$key=.*|$key=$value|" "$ENV_FILE"
  else
    [ -n "$(tail -c 1 "$ENV_FILE")" ] && echo >> "$ENV_FILE"
    echo "$key=$value" >> "$ENV_FILE"
  fi
}

url_param() {  # url_param URL NAMA -> nilai parameter query
  echo "$1" | grep -oE "[?&]$2=[^&#]*" | head -n 1 | cut -d= -f2 || true
}

compose() { (cd "$APP_DIR" && docker compose "$@"); }

PSQL_MODE=""
psql_url() {
  if [ -n "${PSQL_URL:-}" ]; then echo "$PSQL_URL"; return; fi
  local url; url="$(env_get DATABASE_URL)"
  [ -n "$url" ] || die "DATABASE_URL tidak ditemukan di $ENV_FILE (atau isi PSQL_URL)."
  # Dari host, host.docker.internal = mesin ini. Parameter Prisma (schema, connection_limit,
  # pool_timeout) tidak dikenal psql, jadi seluruh query string dibuang.
  url="${url//host.docker.internal/127.0.0.1}"
  echo "${url%%\?*}"
}

detect_psql() {
  if command -v psql >/dev/null 2>&1; then PSQL_MODE="local:psql"
  elif [ -x /www/server/pgsql/bin/psql ]; then PSQL_MODE="local:/www/server/pgsql/bin/psql"
  elif command -v docker >/dev/null 2>&1; then PSQL_MODE="docker"
  else die "psql tidak ditemukan dan docker tidak tersedia."
  fi
}

sql() {  # sql "QUERY" -> keluaran tanpa header, kolom dipisah '|'
  local url; url="$(psql_url)"
  [ -n "$PSQL_MODE" ] || detect_psql
  case "$PSQL_MODE" in
    local:*) "${PSQL_MODE#local:}" "$url" -X -A -t -F '|' -v ON_ERROR_STOP=1 -c "$1" ;;
    docker)  docker run --rm -i --network host postgres:16-alpine \
               psql "$url" -X -A -t -F '|' -v ON_ERROR_STOP=1 -c "$1" ;;
  esac
}

sql_table() {  # sql_table "QUERY" -> tabel rapi untuk dibaca manusia
  local url; url="$(psql_url)"
  [ -n "$PSQL_MODE" ] || detect_psql
  case "$PSQL_MODE" in
    local:*) "${PSQL_MODE#local:}" "$url" -X -P pager=off -c "$1" ;;
    docker)  docker run --rm -i --network host postgres:16-alpine psql "$url" -X -P pager=off -c "$1" ;;
  esac
}

api_ips() {  # semua IP kontainer API (sumber koneksi Prisma yang terlihat di PostgreSQL)
  docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$API_CONTAINER" 2>/dev/null || true
}

ip_list_sql() {  # "a b" -> '''a'',''b''' untuk klausa IN; kosong -> NULL
  local ips out=""
  read -r -a ips <<< "$(api_ips)"
  for ip in "${ips[@]}"; do [ -n "$ip" ] && out="${out:+$out,}'$ip'"; done
  echo "${out:-NULL}"
}

code_has_fix() {
  grep -q "sharedAdvisoryTransactionLock" "$APP_DIR/apps/api/src/students/exam-attempts.service.ts" 2>/dev/null &&
    [ -f "$APP_DIR/apps/api/src/prisma/database-url.ts" ]
}

image_has_fix() {
  docker exec "$API_CONTAINER" sh -c \
    'grep -rlq pg_advisory_xact_lock_shared /app/apps/api/dist 2>/dev/null && find /app/apps/api/dist -name database-url.js | grep -q .' \
    2>/dev/null
}

effective_pool() {  # pool yang benar-benar dipakai API yang sedang berjalan
  docker exec "$API_CONTAINER" node -e '
    const fs=require("fs"),path=require("path");
    const find=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
      if(e.isDirectory()){const r=find(p);if(r)return r}else if(e.name==="database-url.js")return p}};
    const file=find("/app/apps/api/dist"); if(!file){console.log("tidak-ada");process.exit(0)}
    const u=require(file).withPoolDefaults(process.env.DATABASE_URL)||"";
    const g=k=>(u.match(new RegExp("[?&]"+k+"=([^&#]*)"))||[])[1]||"?";
    console.log(g("connection_limit")+" "+g("pool_timeout"));' 2>/dev/null || echo "tidak-terbaca"
}

api_health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "$API_CONTAINER" 2>/dev/null || echo "tidak-ada"
}

# --------------------------------------------------------------------------- #
# Perhitungan rekomendasi                                                      #
# --------------------------------------------------------------------------- #
MAX_CONN=0; RESERVED=0; TOTAL_NOW=0; CBT_NOW=0; OTHERS_NOW=0; RECOMMENDED=0
read_db_capacity() {
  MAX_CONN="$(sql 'SHOW max_connections' | tr -d '[:space:]')"
  RESERVED="$(sql 'SHOW superuser_reserved_connections' | tr -d '[:space:]')"
  TOTAL_NOW="$(sql "SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend'" | tr -d '[:space:]')"
  CBT_NOW="$(sql "SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend'
                  AND host(client_addr) IN ($(ip_list_sql))" | tr -d '[:space:]')"
  OTHERS_NOW=$(( TOTAL_NOW - CBT_NOW ))
  local available=$(( MAX_CONN - RESERVED - OTHERS_NOW - HEADROOM ))
  RECOMMENDED=$DEFAULT_LIMIT
  (( available < RECOMMENDED )) && RECOMMENDED=$available
  (( RECOMMENDED > MAX_LIMIT )) && RECOMMENDED=$MAX_LIMIT
  return 0
}

# --------------------------------------------------------------------------- #
# Perintah: cek                                                                #
# --------------------------------------------------------------------------- #
cmd_cek() {
  title "Server"
  echo "  Proyek : $APP_DIR"
  echo "  CPU    : $(nproc) core"
  echo "  RAM    : $(free -h | awk '/^Mem:/ {print $2 " total, " $7 " tersedia"}')"
  echo "  Beban  : $(cut -d' ' -f1-3 /proc/loadavg)"

  title "Kode"
  if code_has_fix; then ok "Kode di folder proyek sudah memuat perbaikan submit serentak."
  else fail "Kode di folder proyek BELUM memuat perbaikan. Push ke GitHub lalu tunggu deploy (atau git pull)."
  fi
  if docker inspect "$API_CONTAINER" >/dev/null 2>&1; then
    if image_has_fix; then ok "Kontainer $API_CONTAINER yang berjalan sudah memakai perbaikan."
    else warn "Kontainer $API_CONTAINER yang berjalan masih versi lama (perlu build ulang)."
    fi
    echo "  Status API: $(api_health)"
  else
    fail "Kontainer $API_CONTAINER tidak ditemukan."
  fi

  title "PostgreSQL"
  read_db_capacity
  echo "  max_connections               : $MAX_CONN"
  echo "  cadangan superuser            : $RESERVED"
  echo "  koneksi aktif sekarang        : $TOTAL_NOW (CBT API: $CBT_NOW, aplikasi lain: $OTHERS_NOW)"
  echo
  echo "  Koneksi per database / pengguna / asal:"
  sql_table "SELECT datname AS database, usename AS pengguna, coalesce(host(client_addr),'lokal') AS asal,
                    count(*) AS koneksi
             FROM pg_stat_activity WHERE backend_type='client backend'
             GROUP BY 1,2,3 ORDER BY 4 DESC" | sed 's/^/    /'

  title "Pool koneksi CBT"
  local url env_limit env_timeout url_limit
  url="$(env_get DATABASE_URL)"
  url_limit="$(url_param "$url" connection_limit)"
  env_limit="$(env_get DB_CONNECTION_LIMIT)"
  env_timeout="$(env_get DB_POOL_TIMEOUT)"
  [ -n "$url_limit" ] && warn "DATABASE_URL memuat connection_limit=$url_limit — nilai ini MENGALAHKAN DB_CONNECTION_LIMIT."
  echo "  .env DB_CONNECTION_LIMIT : ${env_limit:-(kosong, bawaan $DEFAULT_LIMIT)}"
  echo "  .env DB_POOL_TIMEOUT     : ${env_timeout:-(kosong, bawaan $DEFAULT_POOL_TIMEOUT)}"
  if docker inspect "$API_CONTAINER" >/dev/null 2>&1; then
    local eff; eff="$(effective_pool)"
    case "$eff" in
      tidak-ada|tidak-terbaca) warn "Pool efektif API: belum terbaca (API versi lama memakai bawaan Prisma ≈ $(( $(nproc) * 2 + 1 )))." ;;
      *) echo "  Pool efektif API berjalan: connection_limit=${eff% *}, pool_timeout=${eff#* } detik" ;;
    esac
  fi

  title "Rekomendasi"
  if (( RECOMMENDED < MIN_LIMIT )); then
    fail "Sisa koneksi PostgreSQL terlalu sedikit (hanya $RECOMMENDED untuk CBT)."
    echo "    Naikkan max_connections PostgreSQL (mis. 200) lalu restart PostgreSQL di luar jam ujian."
    echo "    aaPanel: App Store → PostgreSQL → Setting → Configuration → max_connections."
  else
    ok "DB_CONNECTION_LIMIT yang disarankan: $RECOMMENDED"
    echo "    Jalankan:  bash tools/vps/cbt-kapasitas.sh terapkan"
  fi
  echo "    Catatan: 'aplikasi lain' diukur saat ini; saat ramai acca-new bisa memakai lebih banyak."
}

# --------------------------------------------------------------------------- #
# Perintah: terapkan                                                           #
# --------------------------------------------------------------------------- #
cmd_terapkan() {
  local requested="${1:-}"
  [ -f "$ENV_FILE" ] || die "$ENV_FILE tidak ditemukan."
  [ "$(id -u)" -eq 0 ] || command -v sudo >/dev/null || warn "Bukan root; perintah docker mungkin butuh sudo."

  title "Memeriksa"
  code_has_fix || die "Kode di $APP_DIR belum memuat perbaikan. Push commit ke GitHub dan tunggu deploy, atau jalankan git pull dulu."
  ok "Kode sudah memuat perbaikan."
  read_db_capacity
  echo "  max_connections=$MAX_CONN, aplikasi lain sekarang=$OTHERS_NOW, disarankan=$RECOMMENDED"

  local limit="${requested:-$RECOMMENDED}"
  [[ "$limit" =~ ^[0-9]+$ ]] || die "Jumlah koneksi harus angka: $limit"
  if (( limit < MIN_LIMIT )); then
    die "Batas $limit terlalu kecil. Naikkan max_connections PostgreSQL dulu (lihat: cek)."
  fi
  local ceiling=$(( MAX_CONN - RESERVED - OTHERS_NOW - 5 ))
  if (( limit > ceiling )); then
    die "Batas $limit melebihi sisa koneksi PostgreSQL ($ceiling). Pilih angka lebih kecil."
  fi

  local url_limit; url_limit="$(url_param "$(env_get DATABASE_URL)" connection_limit)"
  [ -z "$url_limit" ] || warn "DATABASE_URL sudah memuat connection_limit=$url_limit; nilai itu yang dipakai. Hapus dari DATABASE_URL bila ingin memakai DB_CONNECTION_LIMIT."

  title "Mengubah .env"
  local backup
  backup="$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
  [ -e "$backup" ] && backup="$backup-$$"
  cp -p "$ENV_FILE" "$backup"
  ok "Cadangan: $backup"
  env_set DB_CONNECTION_LIMIT "$limit"
  [ -n "$(env_get DB_POOL_TIMEOUT)" ] || env_set DB_POOL_TIMEOUT "$DEFAULT_POOL_TIMEOUT"
  ok "DB_CONNECTION_LIMIT=$(env_get DB_CONNECTION_LIMIT), DB_POOL_TIMEOUT=$(env_get DB_POOL_TIMEOUT)"

  title "Menyalakan ulang layanan"
  echo "  Menunggu kunci deployment (agar tidak bentrok dengan GitHub Actions)..."
  exec 9>"$DEPLOY_LOCK"
  flock -w 1500 9 || die "Deployment lain masih berjalan. Coba lagi nanti; .env sudah diubah."
  if image_has_fix; then
    echo "  Image API sudah versi baru → cukup buat ulang kontainer cbt-api agar membaca .env."
    compose up -d --no-deps --force-recreate cbt-api
  else
    echo "  Image API masih versi lama → build ulang semua layanan (beberapa menit)."
    compose build
    compose up -d --remove-orphans
  fi
  flock -u 9

  title "Verifikasi"
  local status="" _
  for _ in $(seq 1 36); do
    status="$(api_health)"
    [ "$status" = "healthy" ] && break
    sleep 5
  done
  if [ "$status" = "healthy" ]; then ok "API sehat."
  else warn "Status API: $status — periksa: docker compose logs --tail=100 cbt-api"
  fi
  image_has_fix && ok "API berjalan dengan kode perbaikan." || fail "API yang berjalan belum memuat perbaikan."
  local eff; eff="$(effective_pool)"
  case "$eff" in
    tidak-ada|tidak-terbaca) fail "Pool efektif belum terbaca." ;;
    *) ok "Pool efektif: connection_limit=${eff% *}, pool_timeout=${eff#* } detik" ;;
  esac
  echo
  echo "  Selesai. Saat ujian, pantau dengan: bash tools/vps/cbt-kapasitas.sh pantau"
  echo "  Mengembalikan .env lama: cp $backup $ENV_FILE && docker compose up -d --no-deps --force-recreate cbt-api"
}

# --------------------------------------------------------------------------- #
# Perintah: pantau                                                             #
# --------------------------------------------------------------------------- #
cmd_pantau() {
  local interval="${1:-5}"
  detect_psql
  local limit; limit="$(effective_pool | cut -d' ' -f1)"
  [[ "$limit" =~ ^[0-9]+$ ]] || limit="?"
  trap 'echo; exit 0' INT
  while true; do
    local ips; ips="$(ip_list_sql)"
    local snapshot
    snapshot="$(sql "SELECT
        (SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend'),
        (SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND host(client_addr) IN ($ips)),
        (SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND host(client_addr) IN ($ips) AND state <> 'idle'),
        (SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted),
        (SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock'),
        (SELECT count(*) FROM pg_stat_activity WHERE xact_start < now() - interval '10 seconds' AND backend_type='client backend'),
        (SELECT current_setting('max_connections'))" 2>/dev/null || echo "?|?|?|?|?|?|?")"
    IFS='|' read -r total cbt cbt_busy adv_wait lock_wait long_tx maxc <<< "$snapshot"

    local logs pool_err graded_late rejected5xx
    logs="$(docker logs --since 60s "$API_CONTAINER" 2>&1 || true)"
    pool_err="$(grep -cE 'P2028|P2024|Unable to start a transaction|Timed out fetching a new connection' <<< "$logs" || true)"
    graded_late="$(grep -c 'penilaian tertunda' <<< "$logs" || true)"
    rejected5xx="$(grep -cE ' — 5[0-9]{2} — ' <<< "$logs" || true)"

    if [ -t 1 ]; then printf '\033[H\033[2J'; else echo '----------------------------------------'; fi
    echo "${B}ACCA CBT — pantauan $(date '+%H:%M:%S')${N}   (setiap ${interval} detik, Ctrl+C untuk berhenti)"
    echo
    echo "${B}PostgreSQL${N}"
    printf "  Koneksi total          : %s / %s\n" "$total" "$maxc"
    printf "  Koneksi CBT API        : %s / %s (sibuk: %s)\n" "$cbt" "$limit" "$cbt_busy"
    printf "  Menunggu advisory lock : %s\n" "$adv_wait"
    printf "  Menunggu lock lain     : %s\n" "$lock_wait"
    printf "  Transaksi > 10 detik   : %s\n" "$long_tx"
    echo
    echo "${B}Log API 60 detik terakhir${N}"
    printf "  Pool/transaksi gagal   : %s\n" "$pool_err"
    printf "  Respons 5xx            : %s\n" "$rejected5xx"
    printf "  Penilaian tertunda     : %s  (jawaban aman; dinilai ulang worker tiap 30 dtk)\n" "$graded_late"
    echo
    echo "${B}Kontainer${N}"
    docker stats --no-stream --format '  {{.Name}}\t CPU {{.CPUPerc}}\t RAM {{.MemUsage}}' 2>/dev/null | grep acca-cbt || true
    echo
    echo "  Beban server: $(cut -d' ' -f1-3 /proc/loadavg)   RAM tersedia: $(free -h | awk '/^Mem:/ {print $7}')"
    if [[ "$pool_err" =~ ^[0-9]+$ ]] && (( pool_err > 0 )); then
      echo; warn "Ada kegagalan pool. Bila berulang, naikkan DB_CONNECTION_LIMIT (perintah: terapkan N)."
    fi
    sleep "$interval"
  done
}

# --------------------------------------------------------------------------- #
case "${1:-cek}" in
  cek)      cmd_cek ;;
  terapkan) shift; cmd_terapkan "${1:-}" ;;
  pantau)   shift; cmd_pantau "${1:-5}" ;;
  -h|--help|bantuan)
    sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "Perintah tidak dikenal: $1 (pakai: cek | terapkan [N] | pantau [detik])" ;;
esac
