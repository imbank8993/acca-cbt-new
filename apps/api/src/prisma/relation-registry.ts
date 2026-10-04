import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

export interface FkEdge {
  srcTable: string;
  srcColumn: string;
  tgtTable: string;
  tgtColumn: string;
  constraintName: string;
}

export type RelationKind = 'belongsTo' | 'hasMany';

export interface ResolvedRelation {
  kind: RelationKind;
  /** Kolom pada tabel INDUK yang dipakai menyambung. */
  parentColumn: string;
  /** Kolom pada tabel RELASI yang dipakai menyambung. */
  childColumn: string;
}

/**
 * Peta foreign key seluruh schema `public`, dibaca sekali dari
 * `information_schema` lalu di-cache di memori.
 *
 * Ini yang membedakan adapter CBT dari versi acca-new: di sana relasi bersarang
 * ditebak lewat heuristik `sub.id = induk.{relasi}_id` dengan daftar join yang
 * ditulis manual per modul. Query CBT bersarang sampai tiga tingkat dan memakai
 * relasi has-many (`cbt_bank_questions` → `cbt_bank_question_options`), yang
 * tidak bisa ditebak dari nama. Membaca FK asli membuat resolusinya tepat dan
 * berlaku untuk tabel apa pun tanpa daftar manual.
 */
@Injectable()
export class RelationRegistry {
  private readonly logger = new Logger(RelationRegistry.name);

  private edges: FkEdge[] = [];
  private loaded = false;
  private loading: Promise<void> | null = null;
  private readonly missingTableRetryAt = new Map<string, number>();

  /** PK satu kolom per tabel, dipakai saat menyambung relasi has-many. */
  private primaryKeys = new Map<string, string>();

  /** Tipe SQL tiap kolom, dipakai untuk meng-cast parameter saat menulis. */
  private columnTypes = new Map<string, Map<string, string>>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Memuat peta FK. Aman dipanggil berkali-kali dan dari beberapa permintaan
   * sekaligus — pemanggil kedua menunggu promise yang sama, bukan menembak
   * query kedua ke database.
   */
  async ensureLoaded(table?: string): Promise<void> {
    if (this.loading) return this.loading;
    // A migration can create a table after this process cached the schema.
    // Reload before compiling its predicates, rather than sending UUIDs as text.
    if (this.loaded && (!table || this.columnTypes.has(table) ||
        (this.missingTableRetryAt.get(table) || 0) > Date.now())) return;

    this.loading = this.load().then(() => {
      if (table && !this.columnTypes.has(table)) this.missingTableRetryAt.set(table, Date.now() + 30_000);
    }).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async load(): Promise<void> {
    const fkRows = await this.prisma.$queryRawUnsafe<
      Array<{
        src_table: string;
        src_column: string;
        tgt_table: string;
        tgt_column: string;
        constraint_name: string;
      }>
    >(`
      SELECT tc.table_name        AS src_table,
             kcu.column_name      AS src_column,
             ccu.table_name       AS tgt_table,
             ccu.column_name      AS tgt_column,
             tc.constraint_name   AS constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
    `);

    const edges = fkRows.map((r) => ({
      srcTable: r.src_table,
      srcColumn: r.src_column,
      tgtTable: r.tgt_table,
      tgtColumn: r.tgt_column,
      constraintName: r.constraint_name,
    }));

    const pkRows = await this.prisma.$queryRawUnsafe<
      Array<{ table_name: string; column_name: string; n: number }>
    >(`
      SELECT tc.table_name, kcu.column_name,
             COUNT(*) OVER (PARTITION BY tc.constraint_name)::int AS n
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
    `);

    const primaryKeys = new Map<string, string>();
    for (const row of pkRows) {
      // PK gabungan tidak bisa dipakai menyambung relasi has-many lewat satu
      // kolom, jadi sengaja dilewati. Tabel seperti itu tetap bisa diakses
      // sebagai relasi belongs-to karena arah itu memakai kolom FK-nya sendiri.
      if (row.n === 1) primaryKeys.set(row.table_name, row.column_name);
    }

    const columnRows = await this.prisma.$queryRawUnsafe<
      Array<{ table_name: string; column_name: string; udt_name: string }>
    >(`
      SELECT table_name, column_name, udt_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
    `);

    const columnTypes = new Map<string, Map<string, string>>();
    for (const row of columnRows) {
      let columns = columnTypes.get(row.table_name);
      if (!columns) {
        columns = new Map<string, string>();
        columnTypes.set(row.table_name, columns);
      }
      columns.set(row.column_name, row.udt_name);
    }

    // Publish one complete snapshot; failed refreshes retain the previous map.
    this.edges = edges;
    this.primaryKeys = primaryKeys;
    this.columnTypes = columnTypes;
    this.loaded = true;
    this.logger.log(
      `Peta skema dimuat: ${this.edges.length} foreign key, ` +
        `${this.primaryKeys.size} primary key, ${this.columnTypes.size} tabel`,
    );
  }

  primaryKeyOf(table: string): string {
    return this.primaryKeys.get(table) || 'id';
  }

  /**
   * Tipe SQL sebuah kolom, atau null bila tabel/kolomnya tidak dikenal.
   *
   * Dibutuhkan saat menulis: Prisma mengikat string JavaScript sebagai `text`,
   * dan PostgreSQL TIDAK mengonversi text ke timestamptz/uuid/jsonb secara
   * implisit pada posisi VALUES. Tanpa cast eksplisit, setiap insert yang
   * mengirim `new Date().toISOString()` gagal dengan
   * "column is of type timestamp with time zone but expression is of type text".
   *
   * Di PostgREST hal ini tidak terjadi karena ia yang melakukan koersi lebih
   * dulu; memakai SQL mentah berarti pekerjaan itu pindah ke sini.
   */
  columnType(table: string, column: string): string | null {
    const cached = this.columnTypes.get(table)?.get(column);
    if (cached) return cached;
    if (column === 'updated_at' || column === 'created_at' || column === 'deleted_at') {
      return 'timestamptz';
    }
    return null;
  }

  /**
   * Mencari cara menyambung `target` ke `parent`.
   *
   * `hint` memetakan sintaks `alias:tabel!kolom(...)` milik PostgREST dan
   * dipakai saat ada lebih dari satu FK antara dua tabel yang sama.
   * Nilainya bisa nama kolom FK maupun nama constraint.
   */
  resolve(parent: string, target: string, hint?: string): ResolvedRelation | null {
    const belongsTo = this.edges.filter(
      (e) => e.srcTable === parent && e.tgtTable === target,
    );
    const hasMany = this.edges.filter(
      (e) => e.srcTable === target && e.tgtTable === parent,
    );

    if (hint) {
      const byHint =
        belongsTo.find((e) => e.srcColumn === hint || e.constraintName === hint) ||
        hasMany.find((e) => e.srcColumn === hint || e.constraintName === hint);
      if (byHint) {
        return byHint.srcTable === parent
          ? {
              kind: 'belongsTo',
              parentColumn: byHint.srcColumn,
              childColumn: byHint.tgtColumn,
            }
          : {
              kind: 'hasMany',
              parentColumn: byHint.tgtColumn,
              childColumn: byHint.srcColumn,
            };
      }
    }

    // Sama seperti PostgREST: FK yang menempel di tabel induk menang, karena
    // relasi itu pasti bernilai tunggal.
    if (belongsTo.length === 1) {
      return {
        kind: 'belongsTo',
        parentColumn: belongsTo[0].srcColumn,
        childColumn: belongsTo[0].tgtColumn,
      };
    }
    if (belongsTo.length === 0 && hasMany.length === 1) {
      return {
        kind: 'hasMany',
        parentColumn: hasMany[0].tgtColumn,
        childColumn: hasMany[0].srcColumn,
      };
    }

    if (belongsTo.length > 1 || hasMany.length > 1) {
      throw new Error(
        `Relasi '${parent}' → '${target}' ambigu (${belongsTo.length + hasMany.length} foreign key). ` +
          `Sebutkan kolomnya secara eksplisit, mis. "alias:${target}!nama_kolom_fk(...)".`,
      );
    }

    return null;
  }
}
