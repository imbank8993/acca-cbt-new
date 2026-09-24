import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { RelationRegistry } from './relation-registry';
import {
  buildPredicate,
  compileSelect,
  parseSelect,
  type ParamPusher,
  type RelationFilter,
} from './postgrest-select';

/**
 * Query builder yang meniru API `supabase.from(...)` di atas PostgreSQL.
 *
 * Tujuannya tunggal: memindahkan 577 pemanggilan query dari server action
 * Next.js ke service NestJS tanpa menerjemahkan ulang satu per satu. Badan
 * fungsi cukup disalin, `getSupabaseAdmin()` diganti adapter ini.
 *
 * Ini adalah jembatan migrasi, bukan tujuan akhir. Query di jalur panas
 * (autosave jawaban, monitoring) sebaiknya dipindah ke Prisma idiomatik setelah
 * paritas perilaku terbukti.
 */

export interface QueryResult<T = any> {
  data: T;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

/**
 * Objek hasil parsing JSON atau baris driver — BUKAN instance sebuah kelas.
 * Hanya objek semacam ini yang boleh disalin properti-per-properti.
 */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === 'object') {
    // Kolom numeric/decimal tiba di sini sebagai Prisma.Decimal. PostgREST
    // mengirimnya sebagai ANGKA JSON biasa, dan seluruh kode CBT memang
    // memperlakukannya begitu (`Number(a.total_score) || 0`).
    //
    // Tanpa penjaga ini, cabang "salin properti" di bawah MEMBONGKAR Decimal
    // menjadi isi dalamnya — `{ s: 1, e: 1, d: [77, 2151898, 7341773] }` —
    // sehingga `Number(...)` jadi NaN dan `|| 0` mengubah setiap nilai numeric
    // menjadi 0 tanpa satu pun galat. Nilai ujian, bobot soal dan skor IRT
    // semuanya lewat jalur ini.
    if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toNumber();
    if (Buffer.isBuffer(value)) return value.toString('base64');
    // Instance kelas lain dibiarkan utuh, dengan alasan yang sama.
    if (!isPlainObject(value)) return value;

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeValue(v);
    }
    return out;
  }
  return value;
}

/** Ubah daftar bergaya PostgREST `("A","B")` atau `(id1,id2)` jadi array. */
function parseListLiteral(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const text = String(raw ?? '').trim();
  const inner = text.startsWith('(') && text.endsWith(')') ? text.slice(1, -1) : text;
  if (!inner.trim()) return [];
  return inner
    .split(',')
    .map((part) => part.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'))
    .filter((part) => part.length > 0);
}

type Operation = 'select' | 'insert' | 'update' | 'upsert' | 'delete';

/**
 * Filter disimpan sebagai data, bukan SQL yang sudah jadi — lihat catatan pada
 * `localFilters`.
 */
type LocalFilter =
  | { kind: 'simple'; column: string; op: string; value: unknown; negate?: boolean }
  | { kind: 'or'; branches: Array<{ column: string; op: string; value: unknown }> };

export class PostgrestQueryBuilder implements PromiseLike<QueryResult> {
  private readonly logger = new Logger(PostgrestQueryBuilder.name);

  private operation: Operation = 'select';
  private selectColumns = '*';
  private countOption: string | null = null;
  private headOption = false;

  /**
   * Filter disimpan sebagai DATA, bukan SQL yang sudah jadi.
   *
   * Predikatnya baru dibangun saat eksekusi, karena cast tipe kolom
   * (`$1::uuid`) memerlukan peta skema yang baru dimuat di `execute()`. Versi
   * sebelumnya membangun SQL langsung di `.eq()` — sebelum tipe kolom diketahui
   * — sehingga setiap perbandingan pada kolom uuid gagal dengan
   * "operator does not exist: uuid = text".
   */
  private localFilters: LocalFilter[] = [];
  private relationFilters: RelationFilter[] = [];
  private orderClauses: string[] = [];
  private limitValue: number | null = null;
  private offsetValue: number | null = null;

  private payload: any = null;
  private conflictTarget: string | null = null;
  private ignoreDuplicates = false;

  private singleRow = false;
  private maybeSingleRow = false;

  private params: unknown[] = [];

  constructor(
    private readonly table: string,
    private readonly prisma: Pick<PrismaService, '$queryRawUnsafe'>,
    private readonly registry: RelationRegistry,
  ) {}

  private push = (value: unknown): string => {
    this.params.push(value);
    return `$${this.params.length}`;
  };

  private quoted(column: string): string {
    return `"${this.table}"."${column.replace(/"/g, '""')}"`;
  }

  /**
   * Tempel cast tipe pada placeholder saat menulis.
   *
   * Prisma mengikat string JavaScript sebagai `text`, dan PostgreSQL tidak
   * mengonversi text ke timestamptz/uuid/jsonb secara implisit di posisi VALUES.
   * Tanpa ini, `updated_at: new Date().toISOString()` — pola yang dipakai di
   * banyak server action — gagal dengan "column is of type timestamp with time
   * zone but expression is of type text".
   *
   * `udt_name` PostgreSQL memakai awalan garis bawah untuk tipe array
   * (`_text` = `text[]`), jadi bentuk itu diterjemahkan kembali.
   */
  private castPlaceholder(column: string, placeholder: string): string {
    const type = this.registry.columnType(this.table, column);
    if (!type) return placeholder;
    const sqlType = type.startsWith('_') ? `${type.slice(1)}[]` : type;
    return `${placeholder}::${sqlType}`;
  }

  /**
   * Siapkan nilai sebelum diikat sebagai parameter.
   *
   * Kolom json/jsonb menerima objek dan array dari pemanggil; keduanya harus
   * diserialisasi lebih dulu karena driver tidak tahu itu ditujukan ke jsonb.
   */
  private prepareValue(column: string, value: unknown): unknown {
    const type = this.registry.columnType(this.table, column);
    if ((type === 'json' || type === 'jsonb') && value !== null && typeof value === 'object') {
      return JSON.stringify(value);
    }
    return value;
  }

  /**
   * Filter yang menyasar relasi ditulis bertitik (`member_roles.roles.name`).
   * Filter itu tidak boleh masuk WHERE tingkat atas — ia diserahkan ke compiler
   * select agar jadi rantai EXISTS.
   */
  private addFilter(column: string, op: string, value: unknown): this {
    if (column.includes('.')) {
      const segments = column.split('.');
      this.relationFilters.push({
        path: segments.slice(0, -1),
        column: segments[segments.length - 1],
        op,
        value,
      });
      return this;
    }
    this.localFilters.push({ kind: 'simple', column, op, value });
    return this;
  }

  // ── Pemilihan & operasi ────────────────────────────────────────────────────

  select(columns = '*', options: { count?: string; head?: boolean } = {}): this {
    this.selectColumns = columns;
    if (options.count) this.countOption = options.count;
    if (options.head) this.headOption = options.head;
    return this;
  }

  insert(data: any): this {
    this.operation = 'insert';
    this.payload = data;
    return this;
  }

  upsert(
    data: any,
    options: { onConflict?: string; ignoreDuplicates?: boolean } = {},
  ): this {
    this.operation = 'upsert';
    this.payload = data;
    this.conflictTarget = options.onConflict ?? null;
    this.ignoreDuplicates = options.ignoreDuplicates ?? false;
    return this;
  }

  update(data: any): this {
    this.operation = 'update';
    this.payload = data;
    return this;
  }

  delete(): this {
    this.operation = 'delete';
    return this;
  }

  // ── Filter ─────────────────────────────────────────────────────────────────

  eq(column: string, value: unknown): this {
    return this.addFilter(column, 'eq', value);
  }
  neq(column: string, value: unknown): this {
    return this.addFilter(column, 'neq', value);
  }
  gt(column: string, value: unknown): this {
    return this.addFilter(column, 'gt', value);
  }
  gte(column: string, value: unknown): this {
    return this.addFilter(column, 'gte', value);
  }
  lt(column: string, value: unknown): this {
    return this.addFilter(column, 'lt', value);
  }
  lte(column: string, value: unknown): this {
    return this.addFilter(column, 'lte', value);
  }
  like(column: string, pattern: string): this {
    return this.addFilter(column, 'like', pattern);
  }
  ilike(column: string, pattern: string): this {
    return this.addFilter(column, 'ilike', pattern);
  }
  is(column: string, value: unknown): this {
    return this.addFilter(column, 'is', value);
  }
  in(column: string, values: unknown[]): this {
    return this.addFilter(column, 'in', Array.isArray(values) ? values : [values]);
  }
  contains(column: string, value: unknown): this {
    return this.addFilter(column, 'contains', value);
  }

  /** Kesetaraan untuk beberapa kolom sekaligus: `.match({ a: 1, b: 2 })`. */
  match(query: Record<string, unknown>): this {
    for (const [column, value] of Object.entries(query || {})) {
      this.addFilter(column, 'eq', value);
    }
    return this;
  }

  /**
   * Negasi: `.not('event_type', 'in', '("A","B")')`, `.not('auth_id', 'is', null)`.
   * Nilai untuk operator `in` boleh berupa array maupun literal PostgREST.
   */
  not(column: string, op: string, value: unknown): this {
    const normalized = op === 'in' ? parseListLiteral(value) : value;
    this.localFilters.push({ kind: 'simple', column, op, value: normalized, negate: true });
    return this;
  }

  /** Sintaks OR PostgREST: `.or('status.eq.draft,status.eq.published')`. */
  or(expression: string): this {
    const parts = (expression || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    const branches: Array<{ column: string; op: string; value: unknown }> = [];
    for (const part of parts) {
      const match = part.match(/^([a-zA-Z0-9_]+)\.([a-z]+)\.(.*)$/);
      if (!match) continue;
      const [, column, op, rawValue] = match;

      let value: unknown = rawValue;
      if (rawValue === 'null') value = null;
      else if (rawValue === 'true') value = true;
      else if (rawValue === 'false') value = false;
      else if (op === 'in') value = parseListLiteral(rawValue);

      branches.push({ column, op, value });
    }

    if (branches.length > 0) {
      this.localFilters.push({ kind: 'or', branches });
    }
    return this;
  }

  // ── Pengurutan & pemotongan ────────────────────────────────────────────────

  order(
    column: string,
    { ascending = true, nullsFirst }: { ascending?: boolean; nullsFirst?: boolean } = {},
  ): this {
    const direction = ascending ? 'ASC' : 'DESC';
    const nulls =
      nullsFirst === undefined ? '' : nullsFirst ? ' NULLS FIRST' : ' NULLS LAST';
    this.orderClauses.push(`${this.quoted(column)} ${direction}${nulls}`);
    return this;
  }

  range(from: number, to: number): this {
    this.offsetValue = from;
    this.limitValue = to - from + 1;
    return this;
  }

  limit(count: number): this {
    this.limitValue = count;
    return this;
  }

  single(): this {
    this.singleRow = true;
    return this;
  }

  maybeSingle(): this {
    this.maybeSingleRow = true;
    return this;
  }

  // ── Eksekusi ───────────────────────────────────────────────────────────────

  private buildSelectParts(): { expressions: string[]; conditions: string[] } {
    const nodes = parseSelect(this.selectColumns);
    return compileSelect(nodes, {
      table: this.table,
      sqlAlias: this.table,
      registry: this.registry,
      push: this.push,
      filters: this.relationFilters,
      counter: { value: 0 },
    });
  }

  /**
   * Terjemahkan filter tersimpan menjadi predikat SQL.
   *
   * Dipanggil hanya dari `execute()`, setelah peta skema dimuat, sehingga tipe
   * tiap kolom sudah diketahui dan bisa dipasang sebagai cast.
   */
  private buildLocalConditions(push: ParamPusher): string[] {
    return this.localFilters.map((filter) => {
      if (filter.kind === 'or') {
        const branches = filter.branches.map((b) =>
          buildPredicate(
            this.quoted(b.column),
            b.op,
            b.value,
            push,
            this.registry.columnType(this.table, b.column),
          ),
        );
        return `(${branches.join(' OR ')})`;
      }

      const predicate = buildPredicate(
        this.quoted(filter.column),
        filter.op,
        filter.value,
        push,
        this.registry.columnType(this.table, filter.column),
      );
      return filter.negate ? `NOT (${predicate})` : predicate;
    });
  }

  private whereClause(conditions: string[]): string {
    return conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  }

  private async run<T>(sql: string, params: unknown[]): Promise<T> {
    return this.prisma.$queryRawUnsafe<T>(sql, ...params);
  }

  private async execute(): Promise<QueryResult> {
    try {
      await this.registry.ensureLoaded();

      switch (this.operation) {
        case 'select':
          return await this.executeSelect();
        case 'insert':
        case 'upsert':
          return await this.executeWrite();
        case 'update':
          return await this.executeUpdate();
        case 'delete':
          return await this.executeDelete();
        default:
          return { data: null, error: null };
      }
    } catch (error) {
      const message = (error as Error)?.message || 'Query gagal';
      this.logger.error(`Query gagal pada tabel '${this.table}': ${message}`);
      return { data: null, error: { message } };
    }
  }

  private async executeSelect(): Promise<QueryResult> {
    const { expressions, conditions: relationConditions } = this.buildSelectParts();
    // Kondisi lokal dibangun SETELAH ekspresi select supaya keduanya berbagi
    // satu daftar parameter yang sama.
    const conditions = [...this.buildLocalConditions(this.push), ...relationConditions];

    let count: number | null = null;
    if (this.countOption) {
      // COUNT dijalankan terpisah dan sengaja mengabaikan LIMIT/OFFSET, sama
      // seperti header Content-Range pada PostgREST.
      const countSql =
        `SELECT COUNT(*)::int AS count FROM public."${this.table}" "${this.table}"` +
        this.whereClause(conditions);
      const rows = await this.run<Array<{ count: number }>>(countSql, this.params);
      count = rows[0]?.count ?? 0;
      if (this.headOption) return { data: null, error: null, count };
    }

    let sql =
      `SELECT ${expressions.join(', ')} FROM public."${this.table}" "${this.table}"` +
      this.whereClause(conditions);

    if (this.orderClauses.length > 0) sql += ` ORDER BY ${this.orderClauses.join(', ')}`;
    if (this.limitValue !== null) sql += ` LIMIT ${Number(this.limitValue)}`;
    if (this.offsetValue !== null) sql += ` OFFSET ${Number(this.offsetValue)}`;

    const rows = serializeValue(await this.run<any[]>(sql, this.params)) as any[];

    if (this.singleRow) {
      if (!rows || rows.length === 0) {
        // Kode PGRST116 dipertahankan: sebagian kode CBT membedakan "baris tidak
        // ada" dari kegagalan query lewat kode ini.
        return {
          data: null,
          error: { message: 'Baris tidak ditemukan', code: 'PGRST116' },
          count,
        };
      }
      return { data: rows[0], error: null, count };
    }
    if (this.maybeSingleRow) {
      return { data: rows?.length ? rows[0] : null, error: null, count };
    }
    return { data: rows, error: null, count };
  }

  private async executeWrite(): Promise<QueryResult> {
    const rows: Record<string, unknown>[] = Array.isArray(this.payload)
      ? this.payload
      : [this.payload];
    if (rows.length === 0) return { data: [], error: null };

    // Satu pernyataan INSERT multi-baris, bukan perulangan per baris. Ini
    // penting untuk sinkronisasi jawaban massal saat ujian: satu attempt bisa
    // menitipkan puluhan jawaban sekaligus, dan satu round-trip per jawaban
    // membuat autosave jadi hambatan nyata.
    const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
    const writeParams: unknown[] = [];
    const pushWrite = (value: unknown): string => {
      writeParams.push(value);
      return `$${writeParams.length}`;
    };

    const valuesSql = rows
      .map(
        (row) =>
          `(${columns
            .map((column) =>
              // DEFAULT dipakai saat kolom tidak ada di baris ini, supaya baris
              // dengan kumpulan kolom berbeda tetap bisa satu pernyataan.
              Object.prototype.hasOwnProperty.call(row, column)
                ? this.castPlaceholder(
                    column,
                    pushWrite(this.prepareValue(column, row[column])),
                  )
                : 'DEFAULT',
            )
            .join(', ')})`,
      )
      .join(', ');

    const columnsSql = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');
    let sql = `INSERT INTO public."${this.table}" (${columnsSql}) VALUES ${valuesSql}`;

    if (this.operation === 'upsert') {
      const conflictColumns = this.conflictTarget
        ? this.conflictTarget.split(',').map((c) => c.trim()).filter(Boolean)
        : [this.registry.primaryKeyOf(this.table)];

      const target = conflictColumns.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');
      const updatable = columns.filter((c) => !conflictColumns.includes(c));

      if (this.ignoreDuplicates) {
        sql += ` ON CONFLICT (${target}) DO NOTHING`;
      } else {
        // Bila SELURUH kolom payload adalah kolom konflik, tidak ada yang bisa
        // diperbarui — tetapi barisnya tetap harus dikembalikan. Dulu kasus itu
        // jatuh ke DO NOTHING, sehingga RETURNING tidak menghasilkan apa-apa dan
        // pemanggil menerima `data: null` TANPA error. Yang paling parah:
        // sinkronisasi peran SSO membaca id keanggotaan dari hasil upsert
        // `{organization_id, user_id}` ini, mendapat null, lalu diam-diam
        // melewati seluruh penyamaan peran — peran dari acca-new tidak pernah
        // sampai ke CBT.
        //
        // PostgREST menyelesaikannya dengan merge-duplicates: kolomnya
        // ditugaskan ke dirinya sendiri, yang sah di PostgreSQL dan membuat
        // barisnya ikut terkembalikan.
        const assignable = updatable.length > 0 ? updatable : columns;
        const assignments = assignable
          .map((c) => `"${c}" = EXCLUDED."${c}"`)
          .join(', ');
        sql += ` ON CONFLICT (${target}) DO UPDATE SET ${assignments}`;
      }
    }

    sql += ' RETURNING *';

    const result = serializeValue(await this.run<any[]>(sql, writeParams)) as any[];

    if (this.singleRow || this.maybeSingleRow) {
      return { data: result[0] ?? null, error: null };
    }
    // Supabase mengembalikan objek tunggal saat yang dikirim juga objek tunggal.
    return { data: Array.isArray(this.payload) ? result : (result[0] ?? null), error: null };
  }

  private async executeUpdate(): Promise<QueryResult> {
    const entries = Object.entries(this.payload || {});
    if (entries.length === 0) return { data: null, error: null };

    // Parameter SET harus mendahului parameter WHERE. Nomor placeholder di
    // kondisi yang sudah terbentuk karena itu digeser sebanyak jumlah kolom SET.
    const setParams: unknown[] = [];
    const setClauses = entries.map(([column, value]) => {
      setParams.push(this.prepareValue(column, value));
      const placeholder = this.castPlaceholder(column, `$${setParams.length}`);
      return `"${column.replace(/"/g, '""')}" = ${placeholder}`;
    });

    // Parameter WHERE dilanjutkan pada daftar yang sama dengan SET, sehingga
    // nomornya benar tanpa perlu digeser belakangan — versi sebelumnya
    // menulis ulang `$n` dengan regex, yang rapuh begitu ada literal `$` di
    // dalam nilai.
    const pushWhere = (value: unknown): string => {
      setParams.push(value);
      return `$${setParams.length}`;
    };
    const conditions = this.buildLocalConditions(pushWhere);

    const sql =
      `UPDATE public."${this.table}" AS "${this.table}" SET ${setClauses.join(', ')}` +
      this.whereClause(conditions) +
      ' RETURNING *';

    const rows = serializeValue(await this.run<any[]>(sql, setParams)) as any[];

    if (this.singleRow || this.maybeSingleRow) {
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }

  private async executeDelete(): Promise<QueryResult> {
    const conditions = this.buildLocalConditions(this.push);
    const sql =
      `DELETE FROM public."${this.table}" AS "${this.table}"` +
      this.whereClause(conditions) +
      ' RETURNING *';

    const rows = serializeValue(await this.run<any[]>(sql, this.params)) as any[];

    if (this.singleRow || this.maybeSingleRow) {
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }

  /** Membuat builder ini bisa langsung di-`await`, sama seperti klien Supabase. */
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

/**
 * Pengganti `getSupabaseAdmin()` di dalam NestJS.
 *
 *   constructor(private readonly db: DbService) {}
 *   const { data, error } = await this.db.from('cbt_exams').select('*').eq('id', id);
 */
@Injectable()
export class DbService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RelationRegistry,
  ) {}

  from(table: string): PostgrestQueryBuilder {
    return new PostgrestQueryBuilder(table, this.prisma, this.registry);
  }

  /** Jalan keluar untuk SQL yang tidak terwakili builder. */
  async raw<T = unknown>(sql: string, ...params: unknown[]): Promise<T> {
    return this.prisma.$queryRawUnsafe<T>(sql, ...params);
  }

  /** Every builder inside the callback uses the same database transaction. */
  async transaction<T>(work: (db: DbSession) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async connection => work({
      from: table => new PostgrestQueryBuilder(table, connection, this.registry),
      raw: <R = unknown>(sql: string, ...params: unknown[]) => connection.$queryRawUnsafe<R>(sql, ...params),
    }), { timeout: 30000 });
  }
}

export interface DbSession {
  from(table: string): PostgrestQueryBuilder;
  raw<T = unknown>(sql: string, ...params: unknown[]): Promise<T>;
}
