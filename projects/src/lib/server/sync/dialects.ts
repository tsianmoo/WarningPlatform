import type { DbType } from '@/lib/sync/types';

/** 标识符加引号（Oracle 使用双引号，统一大写） */
export function ident(name: string, type: DbType = 'oracle'): string {
  if (name.includes('.') || name.includes('(')) return name; // 已含 schema 限定或函数
  return `"${name}"`;
}

export function qualIdent(schema: string | undefined, table: string, type: DbType = 'oracle'): string {
  const t = ident(table, type);
  return schema ? `${ident(schema, type)}.${t}` : t;
}

/** 源 JDBC 类型 → 目标列类型 */
export function mapColumnType(
  jdbcType: string,
  opts: { length?: number; precision?: number; scale?: number } = {},
  type: DbType = 'oracle'
): string {
  const u = (jdbcType || '').toUpperCase();
  const len = opts.length || opts.precision || 200;
  if (type === 'oracle') {
    if (/NUMBER|INT|INTEGER|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|SMALLINT|BIGINT/.test(u)) {
      const p = opts.precision || 18;
      const s = opts.scale || 0;
      return p ? `NUMBER(${p},${s})` : 'NUMBER';
    }
    if (/CLOB/.test(u)) return 'CLOB';
    if (/BLOB|RAW|BYTEA|VARBINARY|IMAGE/.test(u)) return 'BLOB';
    if (/TIMESTAMP/.test(u)) return 'TIMESTAMP';
    if (/DATE|DATETIME|TIME/.test(u)) return 'DATE';
    if (/CHAR|VARCHAR|STRING|TEXT|TINYTEXT|MEDIUMTEXT|LONGTEXT|XML/.test(u)) {
      const L = Math.min(Math.max(len || 200, 1), 4000);
      return `VARCHAR2(${L})`;
    }
    if (/BOOLEAN|BOOL/.test(u)) return 'CHAR(1)';
    return 'VARCHAR2(4000)';
  }
  if (type === 'mysql' || type === 'starrocks') {
    if (/INT|INTEGER/.test(u)) return 'INT';
    if (/BIGINT/.test(u)) return 'BIGINT';
    if (/DECIMAL|NUMERIC/.test(u)) return 'DECIMAL(' + (opts.precision || 18) + ',' + (opts.scale || 2) + ')';
    if (/FLOAT|DOUBLE|REAL/.test(u)) return 'DOUBLE';
    if (/DATE|DATETIME|TIME/.test(u)) return u.includes('TIME') ? 'DATETIME' : 'DATE';
    if (/TIMESTAMP/.test(u)) return 'DATETIME';
    if (/CLOB|TEXT/.test(u)) return 'TEXT';
    if (/BLOB|BYTEA|VARBINARY|RAW/.test(u)) return 'BLOB';
    if (/CHAR|VARCHAR|STRING/.test(u)) return `VARCHAR(${Math.min(Math.max(len, 1), 255)})`;
    return 'TEXT';
  }
  return 'TEXT';
}

/** 将行值渲染为字面量（用于拼接 INSERT/MERGE 的 VALUES） */
export function val(v: unknown, type: DbType = 'oracle'): string {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return type === 'mysql' ? (v ? '1' : '0') : v ? "'1'" : "'0'";
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    const ts = `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
    return `TO_TIMESTAMP('${ts}','YYYY-MM-DD HH24:MI:SS')`;
  }
  const s = String(v).replace(/'/g, "''");
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  return `'${s}'`;
}