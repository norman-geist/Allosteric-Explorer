"use strict";

// Residue-level Boolean selectors. Precedence: not, and, or. No eval.
function expressionSelection(text, residues, legacy) {
  const tokens = [];
  const scan = /\s*(\(|\)|,|;|"[^"\n]*"|'[^'\n]*'|[^\s(),;"']+)/gy;
  let position = 0;
  while (position < text.length) {
    scan.lastIndex = position;
    const match = scan.exec(text);
    if (!match) {
      if (!text.slice(position).trim()) break;
      throw new Error(`Invalid selection near “${text.slice(position, position + 20)}”.`);
    }
    tokens.push(match[1]); position = scan.lastIndex;
  }
  let cursor = 0;
  const peek = () => tokens[cursor]?.toLowerCase();
  const unquote = value => /^["']/.test(value) ? value.slice(1, -1) : value;
  const fail = message => { throw new Error(`${message} Example: segid PROA and resid 40:60.`); };
  function primary() {
    if (peek() === '(') {
      cursor++; const inner = or();
      if (peek() !== ')') fail('Missing closing parenthesis.');
      cursor++; return inner;
    }
    const field = peek();
    if (!field || [')', 'and', 'or'].includes(field)) fail('Expected a residue selector.');
    cursor++;
    if (field === 'all' || field === 'protein') return () => true;
    if (!['chain', 'segid', 'resid', 'resname'].includes(field)) {
      const match = legacy(tokens[cursor - 1]);
      return r => match.ids.has(r.id);
    }
    const values = [];
    while (cursor < tokens.length && !['(', ')', 'and', 'or', 'not'].includes(peek())) {
      if (['chain', 'segid', 'resid', 'resname'].includes(peek())) fail('Join separate selectors with and/or.');
      const token = tokens[cursor++];
      if (![',', ';'].includes(token)) values.push(unquote(token));
    }
    if (!values.length) fail(`Missing values after ${field}.`);
    if (field === 'resid') {
      const ranges = values.map(value => {
        const m = /^(-?\d+)([A-Za-z]?)(?:(:|-)(-?\d+))?$/.exec(value);
        if (!m || (m[4] != null && (m[2] || Number(m[4]) < Number(m[1])))) fail(`Invalid residue range “${value}”.`);
        return { start: Number(m[1]), code: m[2].toUpperCase(), end: m[4] == null ? null : Number(m[4]) };
      });
      return r => ranges.some(v => v.end === null ? r.resid === v.start && (!v.code || r.icode.toUpperCase() === v.code) : r.resid >= v.start && r.resid <= v.end);
    }
    const patterns = values.map(value => new RegExp('^' + value.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.') + '$', field === 'resname' ? 'i' : ''));
    return r => patterns.some(pattern => pattern.test(field === 'resname' ? r.name : r[field] || '_'));
  }
  function not() { if (peek() === 'not') { cursor++; const next = not(); return r => !next(r); } return primary(); }
  function and() { let result = not(); while (peek() === 'and') { cursor++; const left = result, right = not(); result = r => left(r) && right(r); } return result; }
  function or() { let result = and(); while (peek() === 'or') { cursor++; const left = result, right = and(); result = r => left(r) || right(r); } return result; }
  if (!tokens.length) return { ids: new Set(), unknown: [] };
  const predicate = or();
  if (cursor !== tokens.length) fail(`Unexpected “${tokens[cursor]}”; join selectors with and/or.`);
  const ids = new Set([...residues].filter(predicate).map(r => r.id));
  return { ids, unknown: ids.size ? [] : [text] };
}
