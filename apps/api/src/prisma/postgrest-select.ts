import { RelationRegistry } from './relation-registry';

/**
 * Parser + compiler untuk bagian `select()` bergaya PostgREST/Supabase.
 *
 * Yang didukung — persis sebanyak yang dipakai kode CBT, tidak lebih:
 *   - daftar kolom:                 `id, full_name`
 *   - semua kolom:                  `*`
 *   - alias kolom:                  `nama:full_name`
 *   - relasi bersarang (n tingkat): `opsi:cbt_bank_question_options(id, weight)`
 *   - penyaring inner join:         `member_roles:cbt_member_roles!inner(...)`
 *   - petunjuk kolom FK:            `kelas:cbt_classes!class_id(...)`
 *   - filter jalur bertitik:        .eq('member_roles.roles.name', 'Siswa')
 *
 * Relasi diterjemahkan jadi subquery berkorelasi yang membangun JSON, sehingga
 * bentuk hasilnya identik dengan yang dikembalikan PostgREST: objek untuk
 * relasi belongs-to, array untuk has-many.
 */

export type SelectNode =
  | { type: 'star' }
  | { type: 'column'; name: string; alias?: string }
  | {
      type: 'relation';
      alias: string;
      table: string;
      inner: boolean;
      hint?: string;
      children: SelectNode[];
    };

export interface RelationFilter {
  /** Jalur alias menuju relasi, mis. ['member_roles', 'roles']. */
  path: string[];
  column: string;
  op: string;
  value: unknown;
}

export type ParamPusher = (value: unknown) => string;

/** Pecah string berdasarkan koma di tingkat terluar (mengabaikan tanda kurung). */
function splitTopLevel(input: string): string[] {
  const out: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of input) {
    if (char === '(') depth++;
    else if (char === ')') depth--;

    if (char === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out.filter(Boolean);
}

/** Cari indeks karakter `ch` pertama yang berada di kedalaman kurung nol. */
function indexOfTopLevel(input: string, ch: string): number {
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ch && depth === 0) return i;
  }
  return -1;
}

export function parseSelect(input: string): SelectNode[] {
  const cleaned = (input || '*').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned === '*') return [{ type: 'star' }];

  return splitTopLevel(cleaned).map((token) => parseToken(token));
}

function parseToken(token: string): SelectNode {
  if (token === '*') return { type: 'star' };

  // Alias dipisahkan titik dua PERTAMA di tingkat terluar. Tanda titik dua di
  // dalam kurung milik relasi anak, bukan alias di tingkat ini.
  let alias: string | undefined;
  let rest = token;
  const colon = indexOfTopLevel(token, ':');
  if (colon > -1) {
    alias = token.slice(0, colon).trim();
    rest = token.slice(colon + 1).trim();
  }

  const paren = rest.indexOf('(');
  if (paren === -1) {
    // Kolom biasa. `alias:kolom` tetap dipertahankan aliasnya.
    return { type: 'column', name: rest.trim(), alias };
  }

  const head = rest.slice(0, paren).trim();
  const body = rest.slice(paren + 1, rest.lastIndexOf(')'));

  let table = head;
  let inner = false;
  let hint: string | undefined;

  const bang = head.indexOf('!');
  if (bang > -1) {
    table = head.slice(0, bang).trim();
    const modifier = head.slice(bang + 1).trim();
    if (modifier === 'inner') inner = true;
    else if (modifier === 'left') inner = false;
    else hint = modifier;
  }

  return {
    type: 'relation',
    alias: alias || table,
    table,
    inner,
    hint,
    children: parseSelect(body),
  };
}

export interface CompileContext {
  table: string;
  /** Alias SQL tabel ini di dalam query yang sedang dibangun. */
  sqlAlias: string;
  registry: RelationRegistry;
  push: ParamPusher;
  filters: RelationFilter[];
  /** Penghitung bersama agar alias subquery tidak pernah bentrok. */
  counter: { value: number };
  /**
   * Hanya bangun kondisi WHERE, jangan bangun ekspresi JSON apa pun.
   *
   * Dipakai saat menyusun klausa EXISTS untuk `!inner`. Tanpa penanda ini,
   * penyusunan EXISTS ikut membangkitkan subquery JSON yang hasilnya dibuang,
   * sementara parameternya terlanjur ter-push — PostgreSQL lalu menolak query
   * dengan "could not determine data type of parameter" karena ada placeholder
   * yang tidak pernah muncul di SQL akhir.
   */
  conditionsOnly?: boolean;
}

export interface CompiledSelect {
  /** Ekspresi untuk klausa SELECT di tingkat ini. */
  expressions: string[];
  /** Kondisi EXISTS dari relasi `!inner` dan filter bertitik. */
  conditions: string[];
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Bangun predikat SQL untuk satu filter pada kolom yang sudah dikualifikasi.
 * Bentuk operatornya mengikuti klien Supabase.
 *
 * `castType` WAJIB diisi bila kolomnya bukan text. Prisma mengikat string
 * JavaScript sebagai `text`, dan PostgreSQL menolak `uuid = text` dengan
 * "operator does not exist" — bukan mengonversinya diam-diam. Karena hampir
 * seluruh id di basis data ini bertipe uuid, tanpa cast praktis setiap query
 * berfilter akan gagal.
 */
export function buildPredicate(
  qualified: string,
  op: string,
  value: unknown,
  push: ParamPusher,
  castType?: string | null,
): string {
  // udt_name PostgreSQL memakai awalan garis bawah untuk tipe array
  // (`_text` = `text[]`), jadi bentuk itu diterjemahkan kembali.
  const suffix = castType
    ? `::${castType.startsWith('_') ? `${castType.slice(1)}[]` : castType}`
    : '';
  const bind = (v: unknown) => `${push(v)}${suffix}`;
  switch (op) {
    case 'eq':
      return value === null || value === undefined
        ? `${qualified} IS NULL`
        : `${qualified} = ${bind(value)}`;
    case 'neq':
      return value === null || value === undefined
        ? `${qualified} IS NOT NULL`
        : `${qualified} <> ${bind(value)}`;
    case 'gt':
      return `${qualified} > ${bind(value)}`;
    case 'gte':
      return `${qualified} >= ${bind(value)}`;
    case 'lt':
      return `${qualified} < ${bind(value)}`;
    case 'lte':
      return `${qualified} <= ${bind(value)}`;
    case 'like':
      return `${qualified} LIKE ${bind(value)}`;
    case 'ilike':
      return `${qualified} ILIKE ${bind(value)}`;
    case 'is':
      if (value === null) return `${qualified} IS NULL`;
      if (value === true) return `${qualified} IS TRUE`;
      if (value === false) return `${qualified} IS FALSE`;
      return `${qualified} IS NOT DISTINCT FROM ${bind(value)}`;
    case 'in': {
      const list = Array.isArray(value) ? value : [value];
      // Daftar kosong berarti "tidak ada yang cocok". Menghasilkan `IN ()` akan
      // membuat PostgreSQL menolak query, jadi dipendekkan jadi predikat palsu.
      if (list.length === 0) return '1 = 0';
      return `${qualified} IN (${list.map((v) => bind(v)).join(', ')})`;
    }
    case 'contains':
      // jsonb containment — dipakai `.contains('metadata', { is_public: true })`.
      return `${qualified} @> ${push(JSON.stringify(value))}::jsonb`;
    default:
      throw new Error(`Operator filter '${op}' belum didukung adapter.`);
  }
}

/**
 * Kenali sintaks agregat `relasi(count)` milik PostgREST.
 *
 * Tanpa penanganan khusus, `count` diperlakukan sebagai nama kolom dan menjadi
 * `"r0"."count"`. PostgreSQL menafsirkan `alias.nama` yang bukan kolom sebagai
 * pemanggilan fungsi `nama(alias)` — jadi ekspresi itu berubah jadi agregat
 * `count(r0)` di dalam `json_agg`, dan query ditolak dengan "aggregate function
 * calls cannot be nested". Kesalahannya menyesatkan, penyebabnya halus.
 */
function isCountEmbed(children: SelectNode[]): boolean {
  return (
    children.length === 1 &&
    children[0].type === 'column' &&
    children[0].name === 'count' &&
    !children[0].alias
  );
}

/** Filter yang menyasar relasi tepat di bawah `alias`, dengan jalur dipotong satu. */
function descendFilters(filters: RelationFilter[], alias: string): RelationFilter[] {
  return filters
    .filter((f) => f.path.length > 0 && f.path[0] === alias)
    .map((f) => ({ ...f, path: f.path.slice(1) }));
}

/** Filter yang berlaku langsung pada tabel di tingkat ini. */
function localFilters(filters: RelationFilter[]): RelationFilter[] {
  return filters.filter((f) => f.path.length === 0);
}

export function compileSelect(nodes: SelectNode[], ctx: CompileContext): CompiledSelect {
  const expressions: string[] = [];
  const conditions: string[] = [];
  const parent = quoteIdent(ctx.sqlAlias);

  const relations = nodes.filter(
    (n): n is Extract<SelectNode, { type: 'relation' }> => n.type === 'relation',
  );
  const hasStar = nodes.some((n) => n.type === 'star');

  for (const node of nodes) {
    if (node.type === 'star') {
      if (!ctx.conditionsOnly) expressions.push(`${parent}.*`);
    } else if (node.type === 'column') {
      if (ctx.conditionsOnly) continue;
      const expr = `${parent}.${quoteIdent(node.name)}`;
      expressions.push(node.alias ? `${expr} AS ${quoteIdent(node.alias)}` : expr);
    } else {
      const compiled = compileRelation(node, ctx);
      if (!ctx.conditionsOnly) {
        expressions.push(`${compiled.expression} AS ${quoteIdent(node.alias)}`);
      }
      conditions.push(...compiled.parentConditions);
    }
  }

  // Filter bertitik yang menyasar relasi yang TIDAK ada di select tetap harus
  // menyaring baris induk. Tanpa ini, .eq('relasi.kolom', x) akan terabaikan
  // diam-diam — kelas bug yang sangat sulit terlihat.
  const coveredAliases = new Set(relations.map((r) => r.alias));
  const orphanPaths = new Map<string, RelationFilter[]>();
  for (const f of ctx.filters) {
    if (f.path.length === 0 || coveredAliases.has(f.path[0])) continue;
    const key = f.path[0];
    if (!orphanPaths.has(key)) orphanPaths.set(key, []);
    orphanPaths.get(key)!.push(f);
  }
  for (const [aliasName, group] of orphanPaths) {
    const synthetic: Extract<SelectNode, { type: 'relation' }> = {
      type: 'relation',
      alias: aliasName,
      table: aliasName,
      inner: true,
      children: [],
    };
    const compiled = compileRelation(synthetic, {
      ...ctx,
      filters: group,
      conditionsOnly: true,
    });
    conditions.push(...compiled.parentConditions);
  }

  if (hasStar && relations.length > 0) {
    // `*` bersama relasi: `row_to_json` saja akan membuang kolom relasi, jadi
    // ekspresi dibiarkan terpisah — penggabungannya dilakukan pemanggil lewat
    // daftar ekspresi di atas. Tidak ada yang perlu dilakukan di sini.
  }

  return { expressions, conditions };
}

interface CompiledRelation {
  expression: string;
  parentConditions: string[];
}

function compileRelation(
  node: Extract<SelectNode, { type: 'relation' }>,
  ctx: CompileContext,
): CompiledRelation {
  const relation = ctx.registry.resolve(ctx.table, node.table, node.hint);
  if (!relation) {
    throw new Error(
      `Tidak ditemukan foreign key antara '${ctx.table}' dan '${node.table}'. ` +
        `Periksa nama tabel pada select, atau tambahkan petunjuk "alias:${node.table}!kolom_fk(...)".`,
    );
  }

  const descended = descendFilters(ctx.filters, node.alias);

  const joinTo = (alias: string) =>
    `${quoteIdent(alias)}.${quoteIdent(relation.childColumn)} = ` +
    `${quoteIdent(ctx.sqlAlias)}.${quoteIdent(relation.parentColumn)}`;

  // `!inner` maupun filter bertitik sama-sama menyaring baris INDUK, bukan
  // sekadar isi relasinya. Keduanya diputuskan dari bentuk permintaan, bukan
  // dari hasil kompilasi, supaya penentuannya tetap sama di kedua mode.
  const filtersParent = node.inner || descended.length > 0;

  let expression = '';
  if (!ctx.conditionsOnly && isCountEmbed(node.children)) {
    const countAlias = `r${ctx.counter.value++}`;
    const ownFilters = localFilters(descended).map((f) =>
      buildPredicate(
        `${quoteIdent(countAlias)}.${quoteIdent(f.column)}`,
        f.op,
        f.value,
        ctx.push,
        ctx.registry.columnType(node.table, f.column),
      ),
    );
    const where = [joinTo(countAlias), ...ownFilters].join(' AND ');
    // Bentuk hasilnya disamakan dengan PostgREST: array berisi satu objek,
    // karena kode CBT membacanya sebagai `rel?.[0]?.count`.
    expression =
      `(SELECT json_build_array(json_build_object('count', COUNT(*))) ` +
      `FROM public.${quoteIdent(node.table)} ${quoteIdent(countAlias)} WHERE ${where})`;
  } else if (!ctx.conditionsOnly) {
    const childAlias = `r${ctx.counter.value++}`;
    const childCtx: CompileContext = {
      table: node.table,
      sqlAlias: childAlias,
      registry: ctx.registry,
      push: ctx.push,
      filters: descended,
      counter: ctx.counter,
    };

    const child = compileSelect(node.children, childCtx);

    // Baris yang tertanam ikut disaring, mengikuti perilaku PostgREST: dengan
    // `!inner` + filter, yang dikembalikan hanya relasi yang lolos filter.
    const ownFilters = localFilters(descended).map((f) =>
      buildPredicate(
        `${quoteIdent(childAlias)}.${quoteIdent(f.column)}`,
        f.op,
        f.value,
        ctx.push,
        ctx.registry.columnType(node.table, f.column),
      ),
    );

    const where = [joinTo(childAlias), ...ownFilters, ...child.conditions].join(' AND ');
    const jsonExpr = buildJsonExpression(node.children, childAlias, child.expressions);
    const from = `FROM public.${quoteIdent(node.table)} ${quoteIdent(childAlias)} WHERE ${where}`;

    expression =
      relation.kind === 'belongsTo'
        ? `(SELECT ${jsonExpr} ${from} LIMIT 1)`
        : `(SELECT COALESCE(json_agg(${jsonExpr}), '[]'::json) ${from})`;
  }

  const parentConditions: string[] = [];
  if (filtersParent) {
    const existsAlias = `x${ctx.counter.value++}`;
    const existsCtx: CompileContext = {
      table: node.table,
      sqlAlias: existsAlias,
      registry: ctx.registry,
      push: ctx.push,
      filters: descended,
      counter: ctx.counter,
      conditionsOnly: true,
    };

    const existsChild = compileSelect(node.children, existsCtx);
    const existsOwn = localFilters(descended).map((f) =>
      buildPredicate(
        `${quoteIdent(existsAlias)}.${quoteIdent(f.column)}`,
        f.op,
        f.value,
        ctx.push,
        ctx.registry.columnType(node.table, f.column),
      ),
    );

    const existsWhere = [joinTo(existsAlias), ...existsOwn, ...existsChild.conditions].join(
      ' AND ',
    );
    parentConditions.push(
      `EXISTS (SELECT 1 FROM public.${quoteIdent(node.table)} ${quoteIdent(existsAlias)} WHERE ${existsWhere})`,
    );
  }

  return { expression, parentConditions };
}

/** Rakit ekspresi JSON untuk satu baris relasi. */
function buildJsonExpression(
  children: SelectNode[],
  childAlias: string,
  expressions: string[],
): string {
  const alias = quoteIdent(childAlias);
  const hasStar = children.some((n) => n.type === 'star');
  const named = children.filter((n) => n.type !== 'star');

  if (children.length === 0 || (hasStar && named.length === 0)) {
    return `row_to_json(${alias})`;
  }

  // Nama kunci JSON harus memakai alias yang diminta pemanggil, bukan nama
  // kolom aslinya, agar `nama:full_name` benar-benar keluar sebagai `nama`.
  const pairs: string[] = [];
  let i = 0;
  for (const node of children) {
    const expr = expressions[i++];
    if (node.type === 'star') continue;
    const key = node.type === 'column' ? node.alias || node.name : node.alias;
    // Ekspresi sudah memuat `AS "alias"`; untuk json_build_object aliasnya dibuang.
    const withoutAlias = expr.replace(/\s+AS\s+"[^"]+"$/, '');
    pairs.push(`'${key.replace(/'/g, "''")}', ${withoutAlias}`);
  }

  const objectExpr = `json_build_object(${pairs.join(', ')})`;

  if (hasStar) {
    // Gabungkan seluruh kolom tabel dengan kolom relasi tambahan.
    return `(to_jsonb(${alias}) || ${objectExpr}::jsonb)::json`;
  }
  return objectExpr;
}
