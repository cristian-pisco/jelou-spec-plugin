export function normalizeSourceMode(value, { hasActiveTask } = {}) {
  if (value === 'main') return 'main';
  if (value === 'task-aware' && hasActiveTask) return 'task-aware';
  if (value === 'task-aware') throw new Error('task-aware source mode is unavailable because there is no active task');
  throw new Error(`unsupported source mode ${String(value)}; expected main or task-aware`);
}

export function sourceModeChoices({ hasActiveTask }) {
  if (!hasActiveTask) {
    return [
      { value: 'main', label: 'main' },
      {
        value: 'task-aware',
        label: 'task-aware',
        disabled: true,
        reason: 'No active task is available',
      },
    ];
  }
  return [
    { value: 'main', label: 'main' },
    { value: 'task-aware', label: 'task-aware' },
  ];
}
