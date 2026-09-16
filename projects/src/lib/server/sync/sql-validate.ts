// SQL 只读白名单校验：仅允许 SELECT / WITH…SELECT，禁止 DML/DDL 与多语句。
// 不依赖字符串正则硬匹配作为唯一手段——先剥离注释，再词法切分，
// 仅当首语句关键字合法且没有内嵌语句分隔时才放行。

const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'CREATE', 'DROP', 'ALTER',
  'TRUNCATE', 'CALL', 'GRANT', 'REVOKE', 'COMMIT', 'ROLLBACK', 'SET',
  'EXEC', 'EXECUTE', 'REPLACE', 'LOCK', 'GRANT', 'SHUTDOWN', 'STARTUP',
];

/** 词法切分：返回 tokens（含类型标记），同时剔除注释 */
function tokenize(sql: string): Array<{ t: string; kind: 'word' | 'str' | 'op' | 'punct' }> {
  const tokens: Array<{ t: string; kind: 'word' | 'str' | 'op' | 'punct' }> = [];
  let i = 0;
  const n = sql.length;
  let pending = '';
  const pushPending = () => {
    if (pending) {
      tokens.push({ t: pending, kind: 'word' });
      pending = '';
    }
  };
  while (i < n) {
    const c = sql[i];
    // 行注释
    if (c === '-' && sql[i + 1] === '-') {
      pushPending();
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    // 块注释
    if (c === '/' && sql[i + 1] === '*') {
      pushPending();
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'") {
      // 字符串字面量
      pushPending();
      let j = i + 1;
      let esc = false;
      while (j < n) {
        if (sql[j] === "'" && !esc) {
          if (sql[j + 1] === "'") {
            esc = true;
          } else {
            j++;
            break;
          }
        } else {
          esc = false;
        }
        j++;
      }
      tokens.push({ t: sql.slice(i, j), kind: 'str' });
      i = j;
      continue;
    }
    if (c === '"' || c === '`' || c === '[') {
      // 双引号标识符 / 反引号 / SQLServer 方括号
      const close = c === '[' ? ']' : c;
      pushPending();
      const j = sql.indexOf(close, i + 1);
      const end = j === -1 ? n : j + 1;
      tokens.push({ t: sql.slice(i, end), kind: 'str' });
      i = end;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      pending += c;
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      pending += c;
      i++;
      continue;
    }
    // 中文字符/其它：并入 pending（保持标识符/字符串完整性）
    if (c.charCodeAt(0) > 127) {
      pending += c;
      i++;
      continue;
    }
    pushPending();
    if (c === ';') {
      tokens.push({ t: c, kind: 'punct' });
    } else if ('()*+-/%;,'.includes(c)) {
      tokens.push({ t: c, kind: 'op' });
    } else {
      tokens.push({ t: c, kind: 'op' });
    }
    i++;
  }
  pushPending();
  return tokens;
}

export interface ValidateResult {
  ok: boolean;
  error?: string;
}

/** 只读校验；可被 SQL 解析失败的场景兜底（在「仅允许 SELECT/WITH」前提先做防御）。 */
export function validateReadOnly(sql: string): ValidateResult {
  if (!sql || !sql.trim()) return { ok: false, error: 'SQL 不能为空' };

  const tokens = tokenize(sql);
  // 去掉末尾可能存在的孤立分号
  while (tokens.length && tokens[tokens.length - 1].t === ';') tokens.pop();

  const words = tokens.filter((tk) => tk.kind === 'word').map((tk) => tk.t.toUpperCase());

  // 首语句关键字必须是 SELECT 或 WITH
  const first = words[0];
  if (first !== 'SELECT' && first !== 'WITH') {
    return { ok: false, error: `仅允许 SELECT / WITH … SELECT，检测到起始关键字「${first || '(为空)'}」` };
  }

  // 内嵌分号（非末尾）→ 多语句
  if (tokens.some((tk, idx) => tk.t === ';' && idx < tokens.length - 1)) {
    return { ok: false, error: '禁止多语句（不允许用分号拼接多条 SQL）' };
  }

  // 禁止关键字出现在任何非字符串 token 中（防止注释/字符串绕过）
  for (const tk of tokens) {
    if (tk.kind === 'word') {
      const up = tk.t.toUpperCase();
      if (FORBIDDEN_KEYWORDS.includes(up)) {
        return { ok: false, error: `检测到禁止关键字「${tk.t}」（仅允许只读查询）` };
      }
    }
  }

  return { ok: true };
}

/** 提取 ${param} 占位符名 */
export function extractParams(sql: string): string[] {
  const names = new Set<string>();
  const re = /\$\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) names.add(m[1].trim());
  return [...names];
}

export interface BoundSql {
  sql: string;
  binds: Record<string, unknown>;
}

/** 把 ${param} 占位符替换为命名绑定变量（:__pN），并返回 binds 映射。 */
export function bindSql(sql: string, values: Record<string, unknown>, extra?: Record<string, unknown>): BoundSql {
  let i = 0;
  const binds: Record<string, unknown> = {};
  const replaced = sql.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
    const name = key.trim();
    const bindName = `__p${i++}`;
    binds[bindName] = values[name] ?? extra?.[name];
    return `:${bindName}`;
  });
  return { sql: replaced, binds };
}

/** 危险提示：SELECT * / 无 WHERE 的大表全表 / 缺日期条件（黄色警告，不阻断） */
export function dangerHints(sql: string): string[] {
  const hints: string[] = [];
  const upper = sql.replace(/'[^']*'/g, "''").toUpperCase();
  if (/\*\s+FROM/.test(upper) && !/\bCOUNT\s*\(\s*\*/i.test(upper)) {
    hints.push('SQL 使用了 SELECT *');
  }
  if (/\bFROM\s+\w+/i.test(upper) && !/\bWHERE\b/i.test(upper)) {
    hints.push('未检测到 WHERE 条件，可能全表扫描');
  }
  if (!/(DATE|TIME|时间|日期|dt|day|date)/i.test(upper)) {
    hints.push('未检测到日期/时间过滤条件');
  }
  return hints;
}