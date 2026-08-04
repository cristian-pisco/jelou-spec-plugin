const GROWTH_FACTOR = 2;

export function classifyMountOutcome({ initial, current }) {
  if (!current || current.shellPresent) return 'pending';
  if (current.interactiveCount > 0) return 'mounted';
  const baseline = initial?.rootHtmlLength || 0;
  if (current.rootChildCount > 0 && current.rootHtmlLength >= Math.max(1, baseline) * GROWTH_FACTOR) {
    return 'mounted';
  }
  return 'pending';
}

export function summarizeMountFailure({ elapsedS, consoleErrors, finalUrl, lastSample }) {
  return [
    `not_mounted after=${elapsedS}s`,
    `console_errors=${consoleErrors}`,
    `last_url=${finalUrl}`,
    `shell_present=${lastSample ? lastSample.shellPresent : 'unknown'}`,
    `interactive_count=${lastSample ? lastSample.interactiveCount : 'unknown'}`,
  ].join(' ');
}
