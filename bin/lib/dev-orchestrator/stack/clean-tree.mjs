export function gitStatusPorcelainArgs() {
  return ['status', '--porcelain'];
}

export function isCleanTree(porcelainOutput) {
  return String(porcelainOutput || '').trim().length === 0;
}
