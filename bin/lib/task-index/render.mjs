const DEFAULT_COLUMNS = 80;
const MIN_COLUMNS = 60;
const GAP = ' ';
const COLUMN_COUNT = 7;
const SERVICES_CAP = 24;
const SERVICES_FLOOR = 8;
const FLEX_FLOOR = 5;
const EMPTY = '—';

const FIXED = Object.freeze({ date: 10, status: 16, sprint: 6, prs: 4 });

const HEADERS = Object.freeze({
  date: 'fecha',
  slug: 'slug',
  title: 'título',
  status: 'status',
  sprint: 'sprint',
  services: 'servicios',
  prs: 'PRs',
});

const CARD_LABEL_WIDTH = 11;

export function computeWidths(terminalColumns) {
  const requested = Number(terminalColumns) > 0 ? Number(terminalColumns) : DEFAULT_COLUMNS;
  const total = Math.max(requested, MIN_COLUMNS);
  const gaps = (COLUMN_COUNT - 1) * GAP.length;
  const budget = total - FIXED.date - FIXED.status - FIXED.sprint - FIXED.prs - gaps;

  const services = Math.min(SERVICES_CAP, Math.max(SERVICES_FLOOR, Math.floor(budget * 0.35)));
  const flex = Math.max(FLEX_FLOOR * 2, budget - services);
  const slug = Math.ceil(flex / 2);
  const title = flex - slug;

  const widths = { ...FIXED, services, slug, title };
  widths.total =
    widths.date + widths.slug + widths.title + widths.status + widths.sprint + widths.services + widths.prs + gaps;
  return widths;
}

export function truncate(text, width) {
  const value = String(text ?? '');
  const characters = [...value];
  if (characters.length <= width) return value;
  if (width <= 1) return characters.slice(0, Math.max(0, width)).join('');
  return `${characters.slice(0, width - 1).join('')}…`;
}

function pad(text, width) {
  const value = truncate(text, width);
  return value + ' '.repeat(Math.max(0, width - [...value].length));
}

export function formatServices(ids, width) {
  const list = ids ?? [];
  if (!list.length) return EMPTY;
  for (let keep = list.length; keep > 0; keep--) {
    const joined = list.slice(0, keep).join(', ');
    const suffix = keep < list.length ? ` +${list.length - keep}` : '';
    if ([...(joined + suffix)].length <= width) return joined + suffix;
  }
  return truncate(`+${list.length}`, width);
}

function tableRow(cells, widths) {
  return [
    pad(cells.date, widths.date),
    pad(cells.slug, widths.slug),
    pad(cells.title, widths.title),
    pad(cells.status, widths.status),
    pad(cells.sprint, widths.sprint),
    pad(cells.services, widths.services),
    pad(cells.prs, widths.prs),
  ]
    .join(GAP)
    .trimEnd();
}

export function renderTable(tasks, terminalColumns) {
  const widths = computeWidths(terminalColumns);
  const lines = [tableRow(HEADERS, widths)];
  lines.push(
    [
      '-'.repeat(widths.date),
      '-'.repeat(widths.slug),
      '-'.repeat(widths.title),
      '-'.repeat(widths.status),
      '-'.repeat(widths.sprint),
      '-'.repeat(widths.services),
      '-'.repeat(widths.prs),
    ].join(GAP),
  );

  if (!tasks.length) {
    lines.push('(sin tareas)');
    return lines.join('\n');
  }

  for (const task of tasks) {
    lines.push(
      tableRow(
        {
          date: task.date,
          slug: task.slug,
          title: task.title,
          status: task.status,
          sprint: task.sprint ?? EMPTY,
          services: formatServices(task.service_ids, widths.services),
          prs: String((task.pull_requests ?? []).length),
        },
        widths,
      ),
    );
  }
  return lines.join('\n');
}

export function renderPageFooter({ page, pages, total }) {
  return `página ${page}/${pages} · ${total} tareas`;
}

export function paginate(rows, page, pageSize) {
  const size = Number(pageSize) > 0 ? Number(pageSize) : 20;
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const requested = Number(page) > 0 ? Number(page) : 1;
  const start = (requested - 1) * size;
  return { rows: rows.slice(start, start + size), page: requested, pages, total, pageSize: size };
}

function formatConfidence(confidence) {
  return confidence === 1 ? '' : `  (${Number(confidence).toFixed(1)})`;
}

function cardLine(label, value) {
  return `  ${label.padEnd(CARD_LABEL_WIDTH)} ${value}`.trimEnd();
}

function cardContinuation(value) {
  return `  ${' '.repeat(CARD_LABEL_WIDTH)} ${value}`.trimEnd();
}

function phaseLine(phase) {
  const number = phase.phase_number === null ? '·' : String(phase.phase_number);
  const status = phase.status ?? EMPTY;
  const marker = phase.classification === 'freeform' ? ' [freeform]' : '';
  return `${number.padStart(2)} ${pad(phase.heading, 38)} ${status.padEnd(12)}${formatConfidence(phase.confidence)}${marker}`;
}

export function renderCard(task) {
  const lines = [task.task_key];
  lines.push(cardLine('título', `${task.title}${formatConfidence(task.title_confidence)}`));
  lines.push(cardLine('status', `${task.status}${formatConfidence(task.status_confidence)}`));
  lines.push(
    cardLine('setup mode', `${task.setup_mode ?? EMPTY}${formatConfidence(task.setup_mode_confidence)}`),
  );
  lines.push(cardLine('sprint', task.sprint ?? EMPTY));
  lines.push(cardLine('ruta', `${task.root_path}/`));

  const services = task.services.length
    ? task.services.map((entry) => `${entry.id} (${entry.role})`).join(' · ')
    : EMPTY;
  lines.push(cardLine('servicios', services));

  if (task.pull_requests.length) {
    task.pull_requests.forEach((pr, index) => {
      const label = `${pr.owner}/${pr.repository}#${pr.number}`;
      lines.push(index === 0 ? cardLine('PRs', label) : cardContinuation(label));
    });
  } else {
    lines.push(cardLine('PRs', EMPTY));
  }

  if (task.external_refs.length) {
    task.external_refs.forEach((ref, index) => {
      const label = `${ref.ref_id}   ${ref.url}`;
      lines.push(index === 0 ? cardLine('ClickUp', label) : cardContinuation(label));
    });
  } else {
    lines.push(cardLine('ClickUp', EMPTY));
  }

  if (task.phases.length) {
    task.phases.forEach((phase, index) => {
      const label = phaseLine(phase);
      lines.push(index === 0 ? cardLine('fases', label) : cardContinuation(label));
    });
  }

  if (task.lifecycle.length) {
    task.lifecycle.forEach((transition, index) => {
      const label = `${transition.state.padEnd(17)} ${transition.occurred_at ?? EMPTY}${formatConfidence(transition.confidence)}`;
      lines.push(index === 0 ? cardLine('lifecycle', label) : cardContinuation(label));
    });
  }

  if (task.derivation_issues.length) {
    task.derivation_issues.forEach((issue, index) => {
      const label = `${issue.field} — ${issue.observed_token_class}, se esperaba ${issue.expected_grammar}`;
      lines.push(index === 0 ? cardLine('defectos', label) : cardContinuation(label));
    });
  }

  return lines.join('\n');
}

function renderInteractiveFrame(rows, page, pageSize, terminalColumns) {
  const view = paginate(rows, page, pageSize);
  return `${renderTable(view.rows, terminalColumns)}\n${renderPageFooter(view)}\nn siguiente · p anterior · g<n> ir a página · q salir\n`;
}

export function writeFlushed(stream, text) {
  if (stream.write(text)) return Promise.resolve();
  return new Promise((resolve) => {
    const settle = () => {
      stream.off('drain', settle);
      stream.off('error', settle);
      resolve();
    };
    stream.on('drain', settle);
    stream.on('error', settle);
  });
}

export function exitQuietlyOnBrokenPipe(stream, onOtherError) {
  stream.on('error', (error) => {
    if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') process.exit(0);
    onOtherError(error);
  });
}

export function runPager({ rows, out, keys, pageSize = 20, initialPage = 1 }) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / (Number(pageSize) > 0 ? Number(pageSize) : 20)));
  let page = Math.min(Math.max(1, Number(initialPage) || 1), pages);
  const visited = [];
  let gotoBuffer = null;

  return new Promise((resolve) => {
    let settled = false;
    const supportsRawMode = typeof keys.setRawMode === 'function';

    const draw = () => {
      visited.push(page);
      out.write(renderInteractiveFrame(rows, page, pageSize, out.columns));
    };

    const goTo = (next) => {
      const clamped = Math.min(Math.max(1, next), pages);
      if (clamped === page) return;
      page = clamped;
      draw();
    };

    const flushGoto = () => {
      if (gotoBuffer === null) return;
      const target = gotoBuffer;
      gotoBuffer = null;
      if (target !== '') goTo(Number(target));
    };

    const finish = (reason) => {
      if (settled) return;
      settled = true;
      keys.off('data', onData);
      keys.off('end', onEnd);
      if (typeof out.off === 'function') out.off('resize', onResize);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      if (supportsRawMode) keys.setRawMode(false);
      if (typeof keys.pause === 'function') keys.pause();
      resolve({ page, pages, total, visited, reason });
    };

    function onKey(key) {
      if (gotoBuffer !== null && /^[0-9]$/.test(key)) {
        gotoBuffer += key;
        return;
      }
      if (gotoBuffer !== null) {
        flushGoto();
        if (key === '\r' || key === '\n') return;
      }
      if (key === 'q' || key === 'Q') return finish('quit');
      if (key === '\x04') return finish('eof');
      if (key === '\x03') return finish('interrupt');
      if (key === 'n' || key === 'N') return goTo(page + 1);
      if (key === 'p' || key === 'P') return goTo(page - 1);
      if (key === 'g' || key === 'G') gotoBuffer = '';
    }

    function onData(chunk) {
      for (const key of String(chunk)) {
        if (settled) return;
        onKey(key);
      }
    }

    function onEnd() {
      flushGoto();
      finish('eof');
    }

    function onResize() {
      if (settled) return;
      draw();
    }

    function onSignal() {
      finish('signal');
    }

    keys.on('data', onData);
    keys.on('end', onEnd);
    if (typeof out.on === 'function') out.on('resize', onResize);
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    if (supportsRawMode) keys.setRawMode(true);
    if (typeof keys.resume === 'function') keys.resume();
    draw();
  });
}
