/** Non-executing visual helpers for text-route JSON / SQL / XML previews. */

export type TextVisualKind = 'json' | 'sql' | 'xml' | null;

export function detectTextVisualKind(fileName: string): TextVisualKind {
  const lower = fileName.trim().toLowerCase();
  const base = lower.includes('/') ? lower.slice(lower.lastIndexOf('/') + 1) : lower;
  if (base.endsWith('.json') || base.endsWith('.jsonc')) return 'json';
  if (base.endsWith('.sql')) return 'sql';
  if (base.endsWith('.xml') || base.endsWith('.xsl') || base.endsWith('.xsd')) return 'xml';
  return null;
}

/** Strip // and /* *\/ comments plus trailing commas for JSONC → JSON. */
export function stripJsonc(source: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  let escape = false;
  while (i < source.length) {
    const ch = source[i]!;
    if (inString) {
      out += ch;
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < source.length && /[\s\r\n]/.test(source[j]!)) j += 1;
      if (source[j] === '}' || source[j] === ']') {
        i += 1;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

export type JsonTreeNode =
  | { kind: 'scalar'; value: string; type: 'string' | 'number' | 'boolean' | 'null' }
  | { kind: 'array'; items: JsonTreeNode[] }
  | { kind: 'object'; entries: Array<{ key: string; value: JsonTreeNode }> };

export function parseJsonTree(source: string): { ok: true; root: JsonTreeNode } | { ok: false; error: string } {
  try {
    const parsed: unknown = JSON.parse(stripJsonc(source));
    return { ok: true, root: toJsonTree(parsed) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function toJsonTree(value: unknown): JsonTreeNode {
  if (value === null) return { kind: 'scalar', value: 'null', type: 'null' };
  if (typeof value === 'string') return { kind: 'scalar', value: JSON.stringify(value), type: 'string' };
  if (typeof value === 'number') return { kind: 'scalar', value: String(value), type: 'number' };
  if (typeof value === 'boolean') return { kind: 'scalar', value: String(value), type: 'boolean' };
  if (Array.isArray(value)) return { kind: 'array', items: value.map(toJsonTree) };
  if (typeof value === 'object') {
    return {
      kind: 'object',
      entries: Object.entries(value as Record<string, unknown>).map(([key, child]) => ({
        key,
        value: toJsonTree(child),
      })),
    };
  }
  return { kind: 'scalar', value: String(value), type: 'string' };
}

export interface SqlStatementOutline {
  index: number;
  kind: string;
  summary: string;
  pretty: string;
}

const SQL_KIND_RE = /^(WITH|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|REPLACE|MERGE|EXPLAIN|GRANT|REVOKE|CALL|BEGIN|COMMIT|ROLLBACK|SET|USE|SHOW|DESCRIBE|DESC|ANALYZE|VACUUM|COPY|PRAGMA)\b/i;

/** Split SQL into statements without executing anything. String-aware `;` split. */
export function outlineSql(source: string): SqlStatementOutline[] {
  const parts = splitSqlStatements(source);
  return parts.map((raw, index) => {
    const trimmed = raw.trim();
    const kindMatch = trimmed.match(SQL_KIND_RE);
    const kind = (kindMatch?.[1] ?? 'SQL').toUpperCase();
    const firstLine = trimmed.split(/\r?\n/).find((line) => line.trim())?.trim() ?? kind;
    const summary = firstLine.length > 96 ? `${firstLine.slice(0, 93)}…` : firstLine;
    return { index, kind, summary, pretty: prettySql(trimmed) };
  }).filter((item) => item.pretty.trim().length > 0);
}

function splitSqlStatements(source: string): string[] {
  const parts: string[] = [];
  let current = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      i += 1;
      continue;
    }
    if (inBlockComment) {
      current += ch;
      if (ch === '*' && next === '/') {
        current += '/';
        i += 2;
        inBlockComment = false;
        continue;
      }
      i += 1;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === '-' && next === '-') {
        inLineComment = true;
        current += ch;
        i += 1;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        current += ch;
        i += 1;
        continue;
      }
      if (ch === ';') {
        parts.push(current);
        current = '';
        i += 1;
        continue;
      }
    }
    if (!inDouble && ch === "'" && !inSingle) inSingle = true;
    else if (inSingle && ch === "'") {
      if (next === "'") {
        current += "''";
        i += 2;
        continue;
      }
      inSingle = false;
    } else if (!inSingle && ch === '"' && !inDouble) inDouble = true;
    else if (inDouble && ch === '"') inDouble = false;
    current += ch;
    i += 1;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Lightweight pretty-print: newline before major clauses; never runs SQL. */
export function prettySql(sql: string): string {
  const clauses = /\b(SELECT|FROM|WHERE|JOIN|LEFT JOIN|RIGHT JOIN|INNER JOIN|OUTER JOIN|FULL JOIN|CROSS JOIN|ON|GROUP BY|ORDER BY|HAVING|LIMIT|OFFSET|UNION(?:\s+ALL)?|INSERT INTO|VALUES|UPDATE|SET|DELETE FROM|CREATE TABLE|ALTER TABLE|DROP TABLE|WITH)\b/gi;
  let out = sql.replace(/\s+/g, ' ').trim();
  out = out.replace(clauses, (match, _g, offset) => (offset === 0 ? match.toUpperCase() : `\n${match.toUpperCase()}`));
  return out;
}

export type XmlTreeNode = {
  tag: string;
  attrs: Array<{ name: string; value: string }>;
  children: Array<XmlTreeNode | { text: string }>;
};

export function parseXmlTree(source: string): { ok: true; root: XmlTreeNode } | { ok: false; error: string } {
  try {
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    const err = doc.querySelector('parsererror');
    if (err) return { ok: false, error: err.textContent?.trim() || 'Invalid XML' };
    const el = doc.documentElement;
    if (!el) return { ok: false, error: 'Empty XML' };
    return { ok: true, root: elementToXmlTree(el) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function elementToXmlTree(el: Element): XmlTreeNode {
  const attrs = Array.from(el.attributes).map((attr) => ({ name: attr.name, value: attr.value }));
  const children: XmlTreeNode['children'] = [];
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 1) children.push(elementToXmlTree(child as Element));
    else if (child.nodeType === 3) {
      const text = child.textContent?.trim();
      if (text) children.push({ text });
    }
  }
  return { tag: el.tagName, attrs, children };
}
