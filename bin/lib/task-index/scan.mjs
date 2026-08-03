import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  normalizeDate,
  parseExternalRefs,
  parseLifecycle,
  parsePhases,
  parsePullRequests,
  parseServices,
  parseSetupMode,
  parseSprint,
  parseStatus,
  parseTitle,
} from './extract.mjs';

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function deriveTask(workspacePath, dateOnDisk, slug) {
  const rootPath = join('specs', dateOnDisk, slug);
  const tasksRelative = join(rootPath, 'TASKS.md');
  const specRelative = join(rootPath, 'SPEC.md');
  const tasksText = readFileSync(join(workspacePath, tasksRelative), 'utf8');
  const specPath = join(workspacePath, specRelative);
  const hasSpec = existsSync(specPath);
  const specText = hasSpec ? readFileSync(specPath, 'utf8') : null;

  const title = parseTitle(specText, slug);
  const status = parseStatus(tasksText);
  const setupMode = parseSetupMode(tasksText);
  const sprint = parseSprint(tasksText);
  const services = parseServices(tasksText);
  const pullRequests = parsePullRequests(tasksText);
  const phases = parsePhases(tasksText);
  const lifecycle = parseLifecycle(tasksText);
  const externalRefs = parseExternalRefs(tasksText);

  const isoDate = normalizeDate(dateOnDisk);
  return {
    task_key: `${isoDate ?? dateOnDisk}/${slug}`,
    date: isoDate ?? dateOnDisk,
    date_on_disk: dateOnDisk,
    slug,
    root_path: rootPath,
    title: title.value,
    title_confidence: title.confidence,
    status: status.value,
    status_confidence: status.confidence,
    setup_mode: setupMode.value,
    setup_mode_confidence: setupMode.confidence,
    sprint: sprint.value,
    sprint_confidence: sprint.confidence,
    services: services.value,
    service_ids: services.ids,
    pull_requests: pullRequests.value,
    phases: phases.value,
    phase_grammar: phases.grammar,
    lifecycle: lifecycle.value,
    external_refs: externalRefs.value,
    derivation_issues: [
      ...title.issues,
      ...status.issues,
      ...setupMode.issues,
      ...sprint.issues,
      ...services.issues,
      ...phases.issues,
      ...lifecycle.issues,
      ...externalRefs.issues,
    ],
    sources: {
      tasks: { path: tasksRelative, sha256: sha256(tasksText) },
      spec: hasSpec ? { path: specRelative, sha256: sha256(specText) } : null,
    },
  };
}

export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date)));
}

function walkTaskDirectories(workspacePath, visit) {
  const specsDir = join(workspacePath, 'specs');
  if (!existsSync(specsDir)) return;
  for (const dateOnDisk of readdirSync(specsDir)) {
    const dateDir = join(specsDir, dateOnDisk);
    if (!isDirectory(dateDir)) continue;
    for (const slug of readdirSync(dateDir)) {
      const taskDir = join(dateDir, slug);
      if (!isDirectory(taskDir) || !existsSync(join(taskDir, 'TASKS.md'))) continue;
      visit(dateOnDisk, slug);
    }
  }
}

export function listTaskLocations(workspacePath) {
  const locations = [];
  walkTaskDirectories(workspacePath, (dateOnDisk, slug) => {
    const isoDate = normalizeDate(dateOnDisk);
    locations.push({
      task_key: `${isoDate ?? dateOnDisk}/${slug}`,
      date: isoDate ?? dateOnDisk,
      date_on_disk: dateOnDisk,
      slug,
    });
  });
  return sortTasks(locations);
}

export function scanWorkspace(workspacePath) {
  const tasks = [];
  walkTaskDirectories(workspacePath, (dateOnDisk, slug) => {
    tasks.push(deriveTask(workspacePath, dateOnDisk, slug));
  });
  return { tasks: sortTasks(tasks) };
}

export function filterTasks(tasks, filters = {}) {
  const since = filters.since ? normalizeDate(filters.since) : null;
  const status = filters.status ? String(filters.status).toLowerCase() : null;
  const sprint = filters.sprint === undefined || filters.sprint === null ? null : String(filters.sprint);
  const service = filters.service ?? null;

  return tasks.filter((task) => {
    if (status && task.status !== status) return false;
    if (sprint !== null && task.sprint !== sprint) return false;
    if (service && !task.service_ids.includes(service)) return false;
    if (since && task.date < since) return false;
    return true;
  });
}
