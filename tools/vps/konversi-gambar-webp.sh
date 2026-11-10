#!/usr/bin/env bash
# =============================================================================
# Konversi gambar soal LAMA ke WebP (≤1600 px) dan ganti alamatnya di database
# =============================================================================
# Jalankan di VPS dari folder proyek (mis. /www/wwwroot/acca-cbt-new):
#
#   bash tools/vps/konversi-gambar-webp.sh cek               # hanya membaca + perkiraan penghematan
#   bash tools/vps/konversi-gambar-webp.sh jalankan          # konversi (minta konfirmasi)
#   bash tools/vps/konversi-gambar-webp.sh pulihkan <file>   # kembalikan alamat lama dari cadangan
#
# Opsi jalankan: --ya (tanpa konfirmasi), --paksa (tetap jalan walau ada ujian berlangsung).
# Konversi berjalan di kontainer API bila punya pustaka `sharp`; bila tidak, di kontainer
# Node sementara (node:20-bookworm-slim) yang memasang sharp sendiri lalu dihapus.
# Berkas lama TIDAK dihapus. Cadangan per baris disimpan di BACKUP_DIR (bawaan /var/backups/<proyek>).
# Jalankan di luar jam ujian; aman dijalankan ulang.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
ENV_FILE="$APP_DIR/.env"
JS="$SCRIPT_DIR/konversi-gambar-webp.cjs"
NODE_IMAGE="${NODE_IMAGE:-node:20-bookworm-slim}"

detect_api_container() {
  awk '/^  [A-Za-z0-9_-]+:[[:space:]]*$/ { svc=$1 }
       svc=="cbt-api:" && $1=="container_name:" { gsub(/["\047\r]/,"",$2); print $2; exit }' \
    "$APP_DIR/docker-compose.yml" 2>/dev/null || true
}
detect_deploy_lock() {
  grep -oE '/var/lock/[A-Za-z0-9._-]+\.lock' "$APP_DIR/.github/workflows/deploy.yml" 2>/dev/null | head -n 1 || true
}
API_CONTAINER="${API_CONTAINER:-$(detect_api_container)}"
API_CONTAINER="${API_CONTAINER:-acca-cbt-api}"
DEPLOY_LOCK="${DEPLOY_LOCK:-$(detect_deploy_lock)}"
DEPLOY_LOCK="${DEPLOY_LOCK:-/var/lock/acca-cbt-production-deploy.lock}"
PROJECT="${API_CONTAINER%-api}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/$PROJECT}"
NPM_CACHE="${NPM_CACHE:-/var/cache/$PROJECT-konversi-npm}"

die() { echo "Galat: $*" >&2; exit 1; }

env_get() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^[[:space:]]*$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- \
    | sed -e 's/\r$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" || true
}

[ -f "$JS" ] || die "Skrip $JS tidak ditemukan."
docker inspect -f '{{.State.Running}}' "$API_CONTAINER" 2>/dev/null | grep -q true \
  || die "Kontainer $API_CONTAINER tidak berjalan."

# Di mana konversi dijalankan: kontainer API (punya sharp) atau kontainer sementara.
MODE=""
choose_mode() {
  if docker exec -i -w /app "$API_CONTAINER" node - sharp < "$JS" >/dev/null 2>&1; then
    MODE="api"
  else
    MODE="sementara"
    command -v docker >/dev/null || die "docker tidak tersedia."
    echo "Kontainer API tidak memuat pustaka sharp; memakai kontainer sementara $NODE_IMAGE (perlu internet untuk npm)."
  fi
}

run_api() { docker exec -i -w /app "$API_CONTAINER" node - "$@" < "$JS"; }

run_temp() {  # run_temp <volume-tambahan...> -- <argumen skrip...>
  local volumes=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do volumes+=(-v "$1"); shift; done
  shift
  local db_url; db_url="$(env_get DATABASE_URL)"
  [ -n "$db_url" ] || die "DATABASE_URL tidak ada di $ENV_FILE."
  # Jaringan host: host.docker.internal = mesin ini.
  db_url="${db_url//host.docker.internal/127.0.0.1}"
  local envs=(-e "DATABASE_URL=$db_url")
  local name
  for name in CLOUDFLARE_R2_ACCOUNT_ID CLOUDFLARE_R2_ACCESS_KEY_ID CLOUDFLARE_R2_SECRET_ACCESS_KEY \
              CLOUDFLARE_R2_BUCKET_NAME CLOUDFLARE_R2_PUBLIC_URL NEXT_PUBLIC_SITE_URL; do
    envs+=(-e "$name=$(env_get "$name")")
  done
  [ -z "${GAMBAR_UNGGAH_KE_FOLDER:-}" ] || envs+=(-e "GAMBAR_UNGGAH_KE_FOLDER=$GAMBAR_UNGGAH_KE_FOLDER")
  mkdir -p "$NPM_CACHE"
  docker run --rm -i --network host "${envs[@]}" \
    -v "$NPM_CACHE:/root/.npm" -v "$JS:/konversi/konversi-gambar-webp.cjs:ro" "${volumes[@]}" \
    "$NODE_IMAGE" sh -c 'mkdir -p /tmp/konv && cd /tmp/konv && npm init -y >/dev/null 2>&1 &&
      npm install --no-audit --no-fund --loglevel=error sharp@0.34 @aws-sdk/client-s3@3 pg@8 >/dev/null &&
      NODE_PATH=/tmp/konv/node_modules node /konversi/konversi-gambar-webp.cjs "$@"' konversi "$@"
}

confirm() {
  local answer
  echo
  read -r -p "$1 Ketik YA untuk melanjutkan: " answer
  [ "$answer" = "YA" ] || die "Dibatalkan. Tidak ada yang diubah."
}

take_deploy_lock() {
  exec 9>"$DEPLOY_LOCK"
  if ! flock -n 9; then
    echo "Deployment sedang berjalan; menunggu sampai selesai (maks. 25 menit)..."
    flock -w 1500 9 || die "Deployment belum selesai. Tidak ada yang diubah."
  fi
}

cmd="${1:-cek}"; shift || true
case "$cmd" in
  cek)
    echo "Proyek: $APP_DIR   (kontainer: $API_CONTAINER)"
    choose_mode
    echo
    if [ "$MODE" = "api" ]; then run_api cek; else run_temp -- cek; fi
    ;;

  jalankan)
    yes=0; extra=()
    for arg in "$@"; do
      case "$arg" in
        --ya) yes=1 ;;
        --paksa) extra+=(--paksa) ;;
        *) die "Opsi tidak dikenal: $arg" ;;
      esac
    done
    echo "Proyek: $APP_DIR   (kontainer: $API_CONTAINER)"
    choose_mode
    echo
    if [ "$MODE" = "api" ]; then run_api cek; else run_temp -- cek; fi
    [ "$yes" -eq 1 ] || confirm "Gambar JPG/PNG/BMP soal dikonversi ke WebP dan alamatnya diganti. Berkas lama tidak dihapus; cadangan di $BACKUP_DIR."
    take_deploy_lock
    mkdir -p "$BACKUP_DIR"
    stamp="$(date +%Y%m%d-%H%M%S)"
    host="$BACKUP_DIR/konversi-webp-$stamp.ndjson"
    echo
    echo "Mengonversi gambar..."
    if [ "$MODE" = "api" ]; then
      inside="/tmp/konversi-webp-$stamp.ndjson"
      save_backup() {
        if docker exec "$API_CONTAINER" test -f "$inside" 2>/dev/null; then
          docker cp "$API_CONTAINER:$inside" "$host" >/dev/null && chmod 600 "$host" \
            && echo "Cadangan: $host ($(wc -l < "$host") baris)"
        fi
      }
      trap save_backup EXIT
      run_api jalankan --cadangan "$inside" "${extra[@]}"
      trap - EXIT
      save_backup
    else
      run_temp "$BACKUP_DIR:$BACKUP_DIR" -- jalankan --cadangan "$host" "${extra[@]}"
      [ -f "$host" ] && chmod 600 "$host" && echo "Cadangan: $host ($(wc -l < "$host") baris)"
    fi
    echo
    echo "Mengembalikan bila perlu: bash tools/vps/konversi-gambar-webp.sh pulihkan $host"
    ;;

  pulihkan)
    file="${1:-}"
    [ -n "$file" ] && [ -f "$file" ] || die "Pakai: pulihkan <file cadangan>  (lihat $BACKUP_DIR)"
    file="$(cd "$(dirname "$file")" && pwd)/$(basename "$file")"
    echo "File cadangan: $file ($(wc -l < "$file") baris)"
    [ "${2:-}" = "--ya" ] || confirm "Alamat gambar lama semua baris di file ini akan dikembalikan."
    take_deploy_lock
    choose_mode
    if [ "$MODE" = "api" ]; then
      inside="/tmp/pulihkan-webp-$(date +%Y%m%d-%H%M%S).ndjson"
      tmp="$(mktemp)"; cp "$file" "$tmp"; chmod 644 "$tmp"
      docker cp "$tmp" "$API_CONTAINER:$inside" >/dev/null; rm -f "$tmp"
      run_api pulihkan "$inside"
    else
      run_temp "$(dirname "$file"):/pulihkan:ro" -- pulihkan "/pulihkan/$(basename "$file")"
    fi
    ;;

  -h|--help|bantuan) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "Perintah tidak dikenal: $cmd (pakai: cek | jalankan | pulihkan <file>)" ;;
esac
