#!/usr/bin/env bash
# =============================================================================
# Pindahkan gambar base64 di soal lama ke penyimpanan (Cloudflare R2)
# =============================================================================
# Jalankan di VPS dari folder proyek (mis. /www/wwwroot/acca-cbt-new):
#
#   bash tools/vps/pindahkan-gambar-base64.sh cek               # hanya membaca
#   bash tools/vps/pindahkan-gambar-base64.sh jalankan          # pindahkan (minta konfirmasi)
#   bash tools/vps/pindahkan-gambar-base64.sh pulihkan <file>   # kembalikan dari cadangan
#
# Opsi jalankan: --ya (tanpa konfirmasi), --paksa (tetap jalan walau ada ujian berlangsung).
# Cadangan setiap baris yang diubah disimpan di BACKUP_DIR (bawaan /var/backups/<proyek>).
# Jalankan di luar jam ujian. Aman dijalankan ulang: berkas yang sudah ada tidak diunggah lagi.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
JS="$SCRIPT_DIR/pindahkan-gambar-base64.cjs"

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

die() { echo "Galat: $*" >&2; exit 1; }

[ -f "$JS" ] || die "Skrip $JS tidak ditemukan."
docker inspect -f '{{.State.Running}}' "$API_CONTAINER" 2>/dev/null | grep -q true \
  || die "Kontainer $API_CONTAINER tidak berjalan."

run_node() { docker exec -i -w /app "$API_CONTAINER" node - "$@" < "$JS"; }

confirm() {  # confirm "pesan" -> lanjut hanya bila pengguna mengetik YA
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
    echo
    run_node cek
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
    echo
    run_node cek
    [ "$yes" -eq 1 ] || confirm "Gambar di tabel 'akan dipindah' diunggah ke penyimpanan lalu diganti URL. Cadangan disimpan di $BACKUP_DIR."
    take_deploy_lock
    mkdir -p "$BACKUP_DIR"
    stamp="$(date +%Y%m%d-%H%M%S)"
    inside="/tmp/gambar-base64-$stamp.ndjson"
    host="$BACKUP_DIR/gambar-base64-$stamp.ndjson"
    save_backup() {
      if docker exec "$API_CONTAINER" test -f "$inside" 2>/dev/null; then
        docker cp "$API_CONTAINER:$inside" "$host" >/dev/null && chmod 600 "$host" \
          && echo "Cadangan: $host ($(wc -l < "$host") baris)"
      fi
    }
    trap save_backup EXIT
    echo
    echo "Memindahkan gambar..."
    run_node jalankan --cadangan "$inside" "${extra[@]}"
    echo
    echo "Mengembalikan bila perlu: bash tools/vps/pindahkan-gambar-base64.sh pulihkan $host"
    ;;

  pulihkan)
    file="${1:-}"
    [ -n "$file" ] && [ -f "$file" ] || die "Pakai: pulihkan <file cadangan>  (lihat $BACKUP_DIR)"
    echo "File cadangan: $file ($(wc -l < "$file") baris)"
    [ "${2:-}" = "--ya" ] || confirm "Nilai asli semua baris di file ini akan dikembalikan."
    take_deploy_lock
    inside="/tmp/pulihkan-$(date +%Y%m%d-%H%M%S).ndjson"
    tmp="$(mktemp)"; cp "$file" "$tmp"; chmod 644 "$tmp"
    docker cp "$tmp" "$API_CONTAINER:$inside" >/dev/null; rm -f "$tmp"
    run_node pulihkan "$inside"
    ;;

  -h|--help|bantuan) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "Perintah tidak dikenal: $cmd (pakai: cek | jalankan | pulihkan <file>)" ;;
esac
