function stripComment(line) {
  let inS = false, inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '#' && !inS && !inD && (i === 0 || line[i - 1] === ' ')) return line.slice(0, i);
  }
  return line;
}

function scalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'")) return s.slice(1, -1);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

function parseValue(s) {
  const t = s.trim();
  if (t[0] === '[' && t[t.length - 1] === ']') {
    const inner = t.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((x) => scalar(x));
  }
  return scalar(t);
}

function parseMap(lines, start, indent) {
  const obj = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent) {
    const content = lines[i].content;
    const ci = content.indexOf(':');
    const key = content.slice(0, ci).trim();
    const rest = content.slice(ci + 1).trim();
    if (rest === '') {
      if (i + 1 < lines.length && lines[i + 1].indent > indent) {
        const [child, next] = parseMap(lines, i + 1, lines[i + 1].indent);
        obj[key] = child;
        i = next;
      } else {
        obj[key] = null;
        i += 1;
      }
    } else {
      obj[key] = parseValue(rest);
      i += 1;
    }
  }
  return [obj, i];
}

export function parseYamlLite(text) {
  const lines = [];
  for (const raw of String(text || '').split('\n')) {
    const noComment = stripComment(raw);
    if (noComment.trim() === '') continue;
    lines.push({ indent: noComment.length - noComment.trimStart().length, content: noComment.trim() });
  }
  if (lines.length === 0) return {};
  return parseMap(lines, 0, lines[0].indent)[0];
}
