#!/usr/bin/env python3
"""
tools/migrate_from_supabase.py
=============================================================================
Skrip migrasi data dari Supabase (database lama) ke database baru (acca_db).
Fitur utama:
1. Otomatis memetakan nama tabel lama (tanpa prefix) ke tabel baru (dengan prefix cbt_).
2. Otomatis mencocokkan kolom: hanya menyalin kolom dengan NAMA YANG SAMA persis.
   - Kolom baru di target (seperti updated_at) akan diisi nilai default otomatis.
   - Kolom usang di source yang sudah tidak ada di target akan diabaikan dengan aman.
3. Menonaktifkan sementara trigger & foreign key check (session_replication_role = 'replica')
   agar proses copy tidak gagal karena urutan relasi antar tabel.
4. Mendukung batch insert berkecepatan tinggi via psycopg2 execute_values.
=============================================================================
"""

import os
import sys
import argparse
import re
from typing import Dict, List, Tuple, Optional
import psycopg2
from psycopg2 import sql
from psycopg2.extras import execute_values

# Peta tabel khusus (Lama -> Baru) jika ada perbedaan nama selain penambahan prefix 'cbt_'
CUSTOM_TABLE_MAP: Dict[str, str] = {
    "unelma_settings": "acca_settings",
    "settings": "acca_settings",
    "bank_folders": "bank_folders",
    "bank_categories": "bank_categories",
    "exam_classes": "exam_classes",
    "school_years": "school_years",
    "platform_admins": "platform_admins",
}

def load_default_target_url() -> Optional[str]:
    """Membaca DATABASE_URL dari apps/api/.env jika tersedia."""
    env_path = os.path.join(os.path.dirname(__file__), "..", "apps", "api", ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("DATABASE_URL="):
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    return val
    return None

def get_tables_in_schema(conn, schema: str = "public") -> List[str]:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = %s AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        """, (schema,))
        return [row[0] for row in cur.fetchall()]

def get_columns_in_table(conn, table_name: str, schema: str = "public") -> List[str]:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_schema = %s AND table_name = %s
            ORDER BY ordinal_position;
        """, (schema, table_name))
        return [row[0] for row in cur.fetchall()]

def get_primary_key(conn, table_name: str, schema: str = "public") -> Optional[str]:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_schema = %s
              AND tc.table_name = %s
            LIMIT 1;
        """, (schema, table_name))
        row = cur.fetchone()
        return row[0] if row else None

def resolve_target_table(src_table: str, target_tables: List[str]) -> Optional[str]:
    """Menentukan nama tabel tujuan di database baru."""
    # 1. Cek peta tabel khusus
    if src_table in CUSTOM_TABLE_MAP:
        cand = CUSTOM_TABLE_MAP[src_table]
        if cand in target_tables:
            return cand

    # 2. Cek apakah ada tabel persis sama
    if src_table in target_tables:
        return src_table

    # 3. Cek dengan awalan cbt_
    cand = f"cbt_{src_table}"
    if cand in target_tables:
        return cand

    # 4. Jika di source sudah ada awalan cbt_, cek tanpa awalan cbt_
    if src_table.startswith("cbt_"):
        cand = src_table[4:]
        if cand in target_tables:
            return cand

    return None

def copy_table_data(
    src_conn,
    dst_conn,
    src_table: str,
    dst_table: str,
    schema: str = "public",
    batch_size: int = 500,
    on_conflict: str = "nothing",
    dry_run: bool = False
) -> Tuple[int, int, List[str]]:
    """
    Menyalin data dari tabel sumber ke tabel tujuan hanya untuk kolom yang cocok.
    Mengembalikan (jumlah_baris_source, jumlah_baris_tersalin, kolom_yang_cocok).
    """
    src_cols = get_columns_in_table(src_conn, src_table, schema)
    dst_cols = get_columns_in_table(dst_conn, dst_table, schema)

    # Temukan irisan kolom dengan nama yang sama persis
    common_cols = [c for c in src_cols if c in dst_cols]

    if not common_cols:
        return (0, 0, [])

    # Hitung total baris di source
    with src_conn.cursor() as s_cur:
        s_cur.execute(sql.SQL("SELECT COUNT(*) FROM {}.{}").format(
            sql.Identifier(schema), sql.Identifier(src_table)
        ))
        total_src_rows = s_cur.fetchone()[0]

    if total_src_rows == 0:
        return (0, 0, common_cols)

    if dry_run:
        return (total_src_rows, total_src_rows, common_cols)

    # Dapatkan Primary Key target jika ada
    pk_col = get_primary_key(dst_conn, dst_table, schema)

    # Siapkan query SELECT dari source
    col_identifiers = [sql.Identifier(c) for c in common_cols]
    select_query = sql.SQL("SELECT {} FROM {}.{}").format(
        sql.SQL(", ").join(col_identifiers),
        sql.Identifier(schema),
        sql.Identifier(src_table)
    )

    # Siapkan template INSERT untuk target
    insert_base = sql.SQL("INSERT INTO {}.{} ({}) VALUES %s").format(
        sql.Identifier(schema),
        sql.Identifier(dst_table),
        sql.SQL(", ").join(col_identifiers)
    )

    if on_conflict == "nothing" or not pk_col:
        insert_query = sql.SQL("{} ON CONFLICT DO NOTHING").format(insert_base)
    elif on_conflict == "replace" and pk_col in common_cols:
        update_assignments = [
            sql.SQL("{} = EXCLUDED.{}").format(sql.Identifier(c), sql.Identifier(c))
            for c in common_cols if c != pk_col
        ]
        if update_assignments:
            insert_query = sql.SQL("{} ON CONFLICT ({}) DO UPDATE SET {}").format(
                insert_base,
                sql.Identifier(pk_col),
                sql.SQL(", ").join(update_assignments)
            )
        else:
            insert_query = sql.SQL("{} ON CONFLICT DO NOTHING").format(insert_base)
    else:
        insert_query = sql.SQL("{} ON CONFLICT DO NOTHING").format(insert_base)

    copied_rows = 0
    with src_conn.cursor(name=f"stream_{src_table}") as s_cur, dst_conn.cursor() as d_cur:
        s_cur.itersize = batch_size
        s_cur.execute(select_query)

        batch = []
        for row in s_cur:
            batch.append(row)
            if len(batch) >= batch_size:
                execute_values(d_cur, insert_query.as_string(dst_conn), batch, page_size=batch_size)
                copied_rows += len(batch)
                batch = []

        if batch:
            execute_values(d_cur, insert_query.as_string(dst_conn), batch, page_size=len(batch))
            copied_rows += len(batch)

    dst_conn.commit()
    return (total_src_rows, copied_rows, common_cols)

def main():
    parser = argparse.ArgumentParser(
        description="Migrasi data dari database Supabase lama ke database baru (acca_db) dengan pemetaan kolom otomatis."
    )
    parser.add_argument(
        "--source-url",
        required=True,
        help="URL koneksi PostgreSQL database Supabase lama (misal: postgresql://postgres:pass@db.xxxx.supabase.co:5432/postgres)"
    )
    parser.add_argument(
        "--target-url",
        default=load_default_target_url(),
        help="URL koneksi PostgreSQL database tujuan (default otomatis dari apps/api/.env)"
    )
    parser.add_argument(
        "--tables",
        help="Daftar tabel tertentu yang ingin disalin (pisahkan dengan koma, misal: question_banks,bank_questions,classes)"
    )
    parser.add_argument(
        "--include-auth-users",
        action="store_true",
        help="Salin juga tabel auth.users dari Supabase lama jika pengguna belum ada di database baru"
    )
    parser.add_argument(
        "--on-conflict",
        choices=["nothing", "replace"],
        default="nothing",
        help="Strategi saat ada ID yang bentrok: 'nothing' (abaikan baris duplikat) atau 'replace' (timpa baris dengan data lama). Default: nothing."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Jalankan simulasi tanpa menulis data (hanya memeriksa kecocokan tabel dan kolom)"
    )

    args = parser.parse_args()

    if not args.target_url:
        print("[ERROR] Target URL tidak ditemukan. Harap isi parameter --target-url.")
        sys.exit(1)

    print("=" * 70)
    print("MIGRASI DATA SUPABASE LAMA -> DATABASE BARU (ACCA_DB)")
    print("=" * 70)
    if args.dry_run:
        print("[INFO] MODE SIMULASI (DRY-RUN): Tidak ada data yang akan diubah.")

    try:
        print("\nMenghubungkan ke database sumber (Supabase)...")
        src_conn = psycopg2.connect(args.source_url)
        print("✓ Terhubung ke database sumber.")
    except Exception as e:
        print(f"[ERROR] Gagal terhubung ke database sumber: {e}")
        sys.exit(1)

    try:
        print("Menghubungkan ke database target...")
        dst_conn = psycopg2.connect(args.target_url)
        print("✓ Terhubung ke database target.")
    except Exception as e:
        print(f"[ERROR] Gagal terhubung ke database target: {e}")
        src_conn.close()
        sys.exit(1)

    try:
        src_tables = get_tables_in_schema(src_conn, "public")
        dst_tables = get_tables_in_schema(dst_conn, "public")

        # Filter tabel jika user menentukan tabel tertentu
        if args.tables:
            requested = [t.strip() for t in args.tables.split(",") if t.strip()]
            src_tables = [t for t in src_tables if t in requested or f"cbt_{t}" in requested]

        print(f"\nDitemukan {len(src_tables)} tabel di database sumber.")

        # Matikan pengecekan foreign key & triggers selama proses salin
        if not args.dry_run:
            with dst_conn.cursor() as cur:
                cur.execute("SET session_replication_role = 'replica';")
            dst_conn.commit()

        # Salin auth.users jika diminta
        if args.include_auth_users:
            print("\n[AUTH] Memeriksa tabel auth.users...")
            try:
                total, copied, cols = copy_table_data(
                    src_conn, dst_conn, "users", "users",
                    schema="auth", on_conflict=args.on_conflict, dry_run=args.dry_run
                )
                print(f"  auth.users -> auth.users: {copied}/{total} baris ({len(cols)} kolom cocok)")
            except Exception as e:
                print(f"  [WARN] Gagal menyalin auth.users: {e}")

        success_count = 0
        skipped_count = 0

        print("\nMemulai proses pemetaan dan penyalinan tabel:")
        print("-" * 70)

        for s_table in src_tables:
            d_table = resolve_target_table(s_table, dst_tables)
            if not d_table:
                print(f"⏩ {s_table:30} -> (Tidak ada tabel tujuan yang cocok, lewati)")
                skipped_count += 1
                continue

            try:
                total, copied, cols = copy_table_data(
                    src_conn, dst_conn, s_table, d_table,
                    schema="public", on_conflict=args.on_conflict, dry_run=args.dry_run
                )
                if total > 0:
                    print(f"✓  {s_table:25} -> {d_table:25} : {copied}/{total} baris ({len(cols)} kolom)")
                    success_count += 1
                else:
                    print(f"-  {s_table:25} -> {d_table:25} : Tabel kosong (0 baris)")
            except Exception as e:
                print(f"❌ {s_table:25} -> {d_table:25} : Gagal! ({e})")
                dst_conn.rollback()

        print("-" * 70)
        print(f"\nSelesai! {success_count} tabel berhasil disalin, {skipped_count} tabel dilewati.")

    finally:
        # Kembalikan foreign key check ke normal
        if not args.dry_run:
            try:
                with dst_conn.cursor() as cur:
                    cur.execute("SET session_replication_role = 'origin';")
                dst_conn.commit()
            except Exception:
                pass

        src_conn.close()
        dst_conn.close()
        print("\nKoneksi database ditutup.")

if __name__ == "__main__":
    main()
