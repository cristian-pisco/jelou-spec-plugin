export const LIFECYCLE_STATES = Object.freeze([
  'draft',
  'refining',
  'planned',
  'implementing',
  'validating',
  'ready_to_publish',
  'done',
  'closed',
]);

export const PHASE_STATUSES = Object.freeze(['pending', 'in_progress', 'done', 'blocked']);

export const SETUP_MODES = Object.freeze(['branch', 'worktree']);

export const OBSERVED_TOKEN_CLASSES = Object.freeze([
  'absent',
  'placeholder',
  'out_of_allowlist',
  'unparseable_date',
  'freeform_heading',
]);

const PLACEHOLDER_WORDS = Object.freeze(['—', 'tbd', 'n/a']);

const LIFECYCLE_MARKERS = Object.freeze({
  Created: 'draft',
  Planned: 'planned',
  Implementing: 'implementing',
  'Ready to publish': 'ready_to_publish',
  Closed: 'closed',
});

const GRAMMAR = Object.freeze({
  status:
    "'## Status: <state>', '- **Lifecycle**: <state>' or a '| **Status** | <state> |' metadata row, state in the 8-state lifecycle allowlist",
  title: "the first '# <title>' heading of the task SPEC.md",
  setupMode: `'- Mode: <${SETUP_MODES.join('|')}>' inside '## Branching'`,
  sprint: "'- Sprint: <value>'",
  services: "'- Primary: <service-id>' and '- Affected: <service-ids>', slug-shaped service ids only",
  phaseStatus: `'- Status: <status>' or a canonical table cell, status in ${PHASE_STATUSES.join('|')} after leading decoration is dropped`,
  phaseHeading: "'### Phase <n>[ (<qualifier>)]: <name>' under '## Phases', <n> an integer",
  phaseSection:
    "under '## Phase Progress' or '## Phases': a '| # | Phase Name | Status |' table, '### Phase <n>: <name>' headings, or '- Phase <n>: <name>' bullets",
  lifecycleDate: 'an ISO 8601 timestamp after the lifecycle marker',
  lifecycleMarker: `'- <${Object.keys(LIFECYCLE_MARKERS).join('|')}>: <timestamp>' inside '## Lifecycle'`,
  clickup: "'ClickUp: <id>' or 'ClickUp: <clickup-url>' inside '## External Links'",
});

const PHASE_SECTIONS = Object.freeze(['Phase Progress', 'Phases']);

const SERVICE_ID = /^[\p{L}\p{N}][\p{L}\p{N}_./@-]*$/u;

const CANONICAL_PHASE_HEADING = /^(?:Phase|Fase)\s+0*(\d+)\b\s*(?:\([^)]*\))?\s*[:—–-]\s*(\S.*)$/i;

const PHASE_BULLET = /^-\s*(?:\[[ xX]\]\s*)?(?:Phase|Fase)\s+0*(\d+)\b\s*(?:\([^)]*\))?\s*[:—–-]\s*(\S.*)$/i;

const BULLET_SEGMENT_SEPARATOR = /\s+[—–·]\s+/;

const BULLET_PHASE_CONFIDENCE = 0.8;

const LEADING_DECORATION = /^[^\p{L}]+/u;

function derivationIssue(field, observedTokenClass, expectedGrammar) {
  return { field, observed_token_class: observedTokenClass, expected_grammar: expectedGrammar };
}

export function isPlaceholder(value) {
  if (value === null || value === undefined) return false;
  const trimmed = String(value).trim();
  if (trimmed === '') return false;
  if (trimmed.startsWith('(')) return true;
  return PLACEHOLDER_WORDS.includes(trimmed.toLowerCase());
}

export function normalizeDate(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const dayFirst = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!dayFirst) return null;
  return `${dayFirst[3]}-${dayFirst[2]}-${dayFirst[1]}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sectionBody(text, heading) {
  const lines = text.split('\n');
  const opener = new RegExp(`^##\\s+${escapeRegExp(heading)}(\\s|:|$)`);
  const start = lines.findIndex((line) => opener.test(line));
  if (start === -1) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join('\n');
}

function readMarkerValue(text, label) {
  const re = new RegExp(`^-\\s+\\*?\\*?${escapeRegExp(label)}\\*?\\*?:\\s*(\\S.*)$`, 'im');
  const match = text.match(re);
  return match ? match[1].replace(/\*\*/g, '').trim() : null;
}

function tableCells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparator(line) {
  return /^\|[\s:|-]+\|?\s*$/.test(line.trim());
}

function readInlineStatus(text) {
  const match = text.match(/^##\s+Status:\s*(\S.*)$/im);
  return match ? match[1].replace(/\*\*/g, '').trim() : null;
}

function readTableRowValue(text, label) {
  const re = new RegExp(`^\\|\\s*\\*?\\*?${escapeRegExp(label)}\\*?\\*?\\s*\\|\\s*([^|]*?)\\s*\\|`, 'im');
  const match = text.match(re);
  if (!match) return null;
  const value = match[1].replace(/\*\*/g, '').trim();
  return value === '' ? null : value;
}

function readMetadataTableStatus(text) {
  const metadata = sectionBody(text, 'Metadata');
  return readTableRowValue(metadata ?? text, 'Status');
}

function unknownStatus(tokenClass) {
  return {
    value: 'unknown',
    confidence: 0,
    issues: [derivationIssue('task.status', tokenClass, GRAMMAR.status)],
  };
}

export function parseStatus(text) {
  const raw =
    readInlineStatus(text) ??
    readMarkerValue(text, 'Lifecycle') ??
    readMarkerValue(text, 'Status') ??
    readMetadataTableStatus(text);
  if (raw === null) return unknownStatus('absent');
  if (isPlaceholder(raw)) return unknownStatus('placeholder');
  const value = raw.toLowerCase();
  if (!LIFECYCLE_STATES.includes(value)) return unknownStatus('out_of_allowlist');
  return { value, confidence: 1, issues: [] };
}

export function parseSprint(text) {
  const raw = readMarkerValue(text, 'Sprint');
  if (raw === null) return { value: null, confidence: 0, issues: [] };
  if (isPlaceholder(raw)) {
    return {
      value: null,
      confidence: 0,
      issues: [derivationIssue('task.sprint', 'placeholder', GRAMMAR.sprint)],
    };
  }
  return { value: raw, confidence: 1, issues: [] };
}

export function parseTitle(specText, fallback) {
  const absent = {
    value: fallback,
    confidence: 0,
    issues: [derivationIssue('task.title', 'absent', GRAMMAR.title)],
  };
  if (typeof specText !== 'string' || specText.trim() === '') return absent;
  const match = specText.match(/^#\s+(.+)$/m);
  if (!match) return absent;
  const value = match[1].trim();
  if (isPlaceholder(value)) {
    return {
      value: fallback,
      confidence: 0,
      issues: [derivationIssue('task.title', 'placeholder', GRAMMAR.title)],
    };
  }
  return { value, confidence: 1, issues: [] };
}

function rejectedSetupMode(tokenClass) {
  return {
    value: null,
    confidence: 0,
    issues: [derivationIssue('task.setup_mode', tokenClass, GRAMMAR.setupMode)],
  };
}

export function parseSetupMode(text) {
  const body = sectionBody(text, 'Branching');
  if (body === null) return rejectedSetupMode('absent');

  const line = body.match(/^-\s+\*?\*?Mode\*?\*?:\s*(\S.*)$/im);
  if (!line) return rejectedSetupMode('absent');

  const raw = line[1].replace(/\*\*/g, '').trim();
  if (isPlaceholder(raw)) return rejectedSetupMode('placeholder');

  const token = raw.split(/\s+/)[0].toLowerCase();
  if (isPlaceholder(token)) return rejectedSetupMode('placeholder');
  if (!SETUP_MODES.includes(token)) return rejectedSetupMode('out_of_allowlist');
  return { value: token, confidence: 1, issues: [] };
}

function splitOutsideGroups(value) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const character of value) {
    if (character === '(' || character === '[') depth++;
    else if (character === ')' || character === ']') depth = Math.max(0, depth - 1);
    if ((character === ',' || character === ';') && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function stripAnnotation(value) {
  const annotated = value.match(/^([^([]+?)\s*[([]/);
  return (annotated ? annotated[1] : value).trim();
}

function collectServiceIds(rawValue, into, issues) {
  for (const part of splitOutsideGroups(rawValue)) {
    if (isPlaceholder(part)) {
      issues.push(derivationIssue('task_service', 'placeholder', GRAMMAR.services));
      continue;
    }
    const id = stripAnnotation(part);
    if (!SERVICE_ID.test(id)) {
      issues.push(derivationIssue('task_service', 'out_of_allowlist', GRAMMAR.services));
      continue;
    }
    into.push(id);
  }
}

function parseFrontmatterServices(text) {
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) return [];
  const block = frontmatter[1];
  const start = block.search(/^affected_services:\s*$/im);
  if (start === -1) return [];
  const ids = [];
  for (const line of block.slice(start).split('\n').slice(1)) {
    if (/^\S/.test(line) && !/^\s*-/.test(line)) break;
    const match = line.match(/^\s*-\s+id:\s*(\S+)/);
    if (match) ids.push(match[1]);
  }
  return ids;
}

function parseServiceTableIds(text, issues) {
  const lines = text.split('\n');
  const header = lines.findIndex((line) => /^\|\s*Service ID\s*\|/i.test(line.trim()));
  if (header === -1) return [];
  const ids = [];
  for (let i = header + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) break;
    if (isTableSeparator(line)) continue;
    const cell = tableCells(line)[0];
    if (!cell || isPlaceholder(cell)) continue;
    collectServiceIds(cell, ids, issues);
  }
  return ids;
}

function hasServicesSection(text) {
  return sectionBody(text, 'Services') !== null || sectionBody(text, 'Affected Services') !== null;
}

export function parseServices(text) {
  const issues = [];
  const primaryIds = [];
  const affectedIds = [];

  const primary = readMarkerValue(text, 'Primary');
  if (primary !== null) collectServiceIds(primary, primaryIds, issues);

  const affected = readMarkerValue(text, 'Affected');
  if (affected !== null) collectServiceIds(affected, affectedIds, issues);

  affectedIds.push(...parseFrontmatterServices(text));
  affectedIds.push(...parseServiceTableIds(text, issues));

  const entries = [
    ...primaryIds.map((id) => ({ id, role: 'primary' })),
    ...affectedIds.map((id) => ({ id, role: 'affected' })),
  ];

  const claimed = new Set();
  const value = [];
  for (const entry of entries) {
    if (claimed.has(entry.id)) continue;
    claimed.add(entry.id);
    value.push(entry);
  }

  const ids = value.map((entry) => entry.id);
  if (!ids.length && !issues.length && hasServicesSection(text)) {
    issues.push(derivationIssue('task_service', 'absent', GRAMMAR.services));
  }
  return { value, ids, confidence: ids.length ? 1 : 0, issues };
}

export function parsePullRequests(text) {
  const pattern = /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/g;
  const byUrl = new Map();
  for (const match of text.matchAll(pattern)) {
    const [url, owner, repository, number] = match;
    if (byUrl.has(url)) continue;
    byUrl.set(url, { url, owner, repository, number: Number(number) });
  }
  return { value: [...byUrl.values()], confidence: 1, issues: [] };
}

function classifyPhaseStatus(raw, issues) {
  if (raw === null || raw === undefined || raw === '') {
    issues.push(derivationIssue('phase.status', 'absent', GRAMMAR.phaseStatus));
    return null;
  }
  if (isPlaceholder(raw)) {
    issues.push(derivationIssue('phase.status', 'placeholder', GRAMMAR.phaseStatus));
    return null;
  }
  const token = raw.replace(LEADING_DECORATION, '');
  if (token === '') {
    issues.push(derivationIssue('phase.status', 'placeholder', GRAMMAR.phaseStatus));
    return null;
  }
  if (!PHASE_STATUSES.includes(token)) {
    issues.push(derivationIssue('phase.status', 'out_of_allowlist', GRAMMAR.phaseStatus));
    return null;
  }
  return token;
}

function phaseTableColumns(headerCells) {
  const status = headerCells.findIndex((cell) => /^status$/i.test(cell));
  if (status === -1) return null;
  const numbered = headerCells.findIndex((cell) => /^(#|n|nn|no\.?)$/i.test(cell));
  const named = headerCells.findIndex((cell) => /^phase(\s+name)?$/i.test(cell));
  if (numbered === -1) return named === -1 ? null : { number: named, name: named, status };
  const name = named === -1 || named === numbered ? numbered + 1 : named;
  return { number: numbered, name, status };
}

function numberedPhaseRow(cell, nameCell) {
  return /^\d+$/.test(cell) ? { number: Number(cell), heading: nameCell ?? '' } : null;
}

function splitCombinedPhaseCell(cell) {
  const match = cell.match(/^0*(\d+)\s*[-—–:.]\s*(\S.*)$/);
  return match ? { number: Number(match[1]), heading: match[2].trim() } : null;
}

function unreadablePhaseRow(cell, issues) {
  if (cell.trim() === '') return;
  issues.push(
    derivationIssue('phase', isPlaceholder(cell.trim()) ? 'placeholder' : 'out_of_allowlist', GRAMMAR.phaseSection),
  );
}

function parsePhaseTable(body) {
  const lines = body.split('\n');

  let columns = null;
  let header = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('|')) continue;
    columns = phaseTableColumns(tableCells(lines[i]));
    if (columns) {
      header = i;
      break;
    }
  }
  if (!columns) return null;

  const combined = columns.number === columns.name;
  const value = [];
  const issues = [];
  for (let i = header + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) break;
    if (isTableSeparator(line)) continue;
    const cells = tableCells(line);
    const cell = cells[columns.number] ?? '';
    const row = combined ? splitCombinedPhaseCell(cell) : numberedPhaseRow(cell, cells[columns.name]);
    if (!row) {
      unreadablePhaseRow(cell, issues);
      continue;
    }
    value.push({
      ordinal: value.length + 1,
      phase_number: row.number,
      heading: row.heading,
      classification: 'canonical',
      status: classifyPhaseStatus(cells[columns.status] ?? '', issues),
      confidence: 1,
    });
  }
  if (!value.length) return null;
  return { value, grammar: 'table', issues };
}

function parsePhaseHeaders(body) {
  const lines = body.split('\n');
  const starts = [];
  for (let i = 0; i < lines.length; i++) if (/^###\s+/.test(lines[i])) starts.push(i);
  if (!starts.length) return null;

  const value = [];
  const issues = [];
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index];
    const end = index + 1 < starts.length ? starts[index + 1] : lines.length;
    const heading = lines[start].replace(/^###\s+/, '').trim();
    const block = lines.slice(start + 1, end).join('\n');
    const canonical = heading.match(CANONICAL_PHASE_HEADING);
    if (!canonical) {
      issues.push(derivationIssue('phase', 'freeform_heading', GRAMMAR.phaseHeading));
      value.push({
        ordinal: value.length + 1,
        phase_number: null,
        heading,
        classification: 'freeform',
        status: null,
        confidence: 0.3,
      });
      continue;
    }
    const statusLine = block.match(/^-\s+\*?\*?Status\*?\*?:\s*(\S.*)$/im);
    const raw = statusLine ? statusLine[1].replace(/\*\*/g, '').trim() : null;
    value.push({
      ordinal: value.length + 1,
      phase_number: Number(canonical[1]),
      heading: canonical[2].trim(),
      classification: 'canonical',
      status: classifyPhaseStatus(raw, issues),
      confidence: 1,
    });
  }
  return { value, grammar: 'headers', issues };
}

function bulletStatus(remainder, segments, issues) {
  const explicit = remainder.match(/\bstatus:\s*([A-Za-z_]+)/i);
  if (explicit) return classifyPhaseStatus(explicit[1].toLowerCase(), issues);

  for (const [index, segment] of segments.entries()) {
    const token = segment.trim().split(/\s+/)[0].toLowerCase();
    if (!PHASE_STATUSES.includes(token)) continue;
    if (index === 0 && segment.trim().toLowerCase() !== token) continue;
    return token;
  }
  return classifyPhaseStatus(null, issues);
}

function bulletHeading(segments) {
  const first = segments[0] ?? '';
  const isBareStatus = PHASE_STATUSES.includes(first.trim().toLowerCase());
  return isBareStatus && segments.length > 1 ? segments[1].trim() : first.trim();
}

function parsePhaseBullets(body) {
  const value = [];
  const issues = [];
  for (const line of body.split('\n')) {
    const bullet = line.match(PHASE_BULLET);
    if (!bullet) continue;
    const remainder = bullet[2].trim();
    const segments = remainder.split(BULLET_SEGMENT_SEPARATOR);
    value.push({
      ordinal: value.length + 1,
      phase_number: Number(bullet[1]),
      heading: bulletHeading(segments),
      classification: 'canonical',
      status: bulletStatus(remainder, segments, issues),
      confidence: BULLET_PHASE_CONFIDENCE,
    });
  }
  if (!value.length) return null;
  return { value, grammar: 'bullets', issues };
}

function presentPhaseSections(text) {
  return PHASE_SECTIONS.map((heading) => sectionBody(text, heading)).filter((body) => body !== null);
}

function unparsedPhaseSection(bodies) {
  const allPlaceholders = bodies.every((body) => isPlaceholder(body.trim()) || body.trim() === '');
  return derivationIssue('phase', allPlaceholders ? 'placeholder' : 'out_of_allowlist', GRAMMAR.phaseSection);
}

export function parsePhases(text) {
  const bodies = presentPhaseSections(text);
  for (const body of bodies) {
    const parsed = parsePhaseTable(body) ?? parsePhaseHeaders(body) ?? parsePhaseBullets(body);
    if (parsed) return parsed;
  }
  if (!bodies.length) return { value: [], grammar: null, issues: [] };
  return { value: [], grammar: null, issues: [unparsedPhaseSection(bodies)] };
}

function toIsoTimestamp(token) {
  if (!token) return null;
  let candidate = token;
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) candidate += 'T00:00:00Z';
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(candidate)) candidate += ':00Z';
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(candidate)) candidate += 'Z';
  else if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(candidate)) return null;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function parseLifecycle(text) {
  const body = sectionBody(text, 'Lifecycle');
  if (body === null) return { value: [], issues: [] };

  const labels = Object.keys(LIFECYCLE_MARKERS).map(escapeRegExp).join('|');
  const marker = new RegExp(`^-\\s+(${labels}):\\s*(\\S.*)$`, 'i');
  const value = [];
  const issues = [];
  const seen = new Set();

  for (const line of body.split('\n')) {
    const match = line.match(marker);
    if (!match) continue;
    const label = Object.keys(LIFECYCLE_MARKERS).find((key) => key.toLowerCase() === match[1].toLowerCase());
    const state = LIFECYCLE_MARKERS[label];
    if (seen.has(state)) continue;
    seen.add(state);
    const occurredAt = toIsoTimestamp(match[2].trim().split(/\s+/)[0]);
    if (occurredAt === null) {
      issues.push(derivationIssue('lifecycle_transition.occurred_at', 'unparseable_date', GRAMMAR.lifecycleDate));
    }
    value.push({ state, occurred_at: occurredAt, confidence: occurredAt === null ? 0.5 : 1 });
  }
  if (!value.length) {
    issues.push(derivationIssue('lifecycle_transition', 'absent', GRAMMAR.lifecycleMarker));
  }
  return { value, issues };
}

export function parseExternalRefs(text) {
  const scope = sectionBody(text, 'External Links') ?? text;
  const match = scope.match(/ClickUp:\s*(\S+)/i);
  if (!match) {
    return { value: [], issues: [derivationIssue('external_ref.clickup', 'absent', GRAMMAR.clickup)] };
  }
  const raw = match[1].replace(/[.,;)]+$/, '');
  if (isPlaceholder(raw)) {
    return { value: [], issues: [derivationIssue('external_ref.clickup', 'placeholder', GRAMMAR.clickup)] };
  }
  const isUrl = /^https?:\/\//i.test(raw);
  const refId = isUrl ? raw.match(/\/t\/(?:[A-Za-z0-9]+\/)*([A-Za-z0-9]+)/)?.[1] ?? null : raw;
  if (!refId) {
    return { value: [], issues: [derivationIssue('external_ref.clickup', 'placeholder', GRAMMAR.clickup)] };
  }
  return {
    value: [
      {
        system: 'clickup',
        ref_id: refId,
        url: isUrl ? raw : `https://app.clickup.com/t/${refId}`,
        confidence: 1,
      },
    ],
    issues: [],
  };
}
