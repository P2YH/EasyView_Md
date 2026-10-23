import { describe, expect, it } from 'vitest';
import {
  detectTextVisualKind,
  outlineSql,
  parseJsonTree,
  prettySql,
  stripJsonc,
} from './textVisual';

describe('textVisual', () => {
  it('detects json/sql/xml kinds from filenames', () => {
    expect(detectTextVisualKind('a.json')).toBe('json');
    expect(detectTextVisualKind('b.jsonc')).toBe('json');
    expect(detectTextVisualKind('q.SQL')).toBe('sql');
    expect(detectTextVisualKind('doc.xml')).toBe('xml');
    expect(detectTextVisualKind('app.py')).toBeNull();
  });

  it('parses JSON and JSONC into a tree', () => {
    const json = parseJsonTree('{"a":1,"b":[true,null]}');
    expect(json.ok).toBe(true);
    if (json.ok) {
      expect(json.root.kind).toBe('object');
    }
    const jsonc = parseJsonTree(`{
      // comment
      "x": 1,
    }`);
    expect(jsonc.ok).toBe(true);
    expect(stripJsonc('{"a":1,}')).toContain('"a":1');
  });

  it('outlines SQL statements without executing', () => {
    const outline = outlineSql(`
      SELECT id FROM users WHERE active = 1;
      INSERT INTO logs(msg) VALUES ('ok');
    `);
    expect(outline).toHaveLength(2);
    expect(outline[0]?.kind).toBe('SELECT');
    expect(outline[1]?.kind).toBe('INSERT');
    expect(prettySql('select a from t where b=1')).toMatch(/SELECT/);
    expect(prettySql('select a from t where b=1')).toMatch(/\nFROM/);
  });

  it('keeps semicolons inside string literals', () => {
    const outline = outlineSql(`SELECT 'a;b' AS x; SELECT 2;`);
    expect(outline).toHaveLength(2);
    expect(outline[0]?.pretty).toContain("'a;b'");
  });
});
