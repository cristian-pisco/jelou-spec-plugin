export function diffAppended(prev, curr) {
  if (!prev) return curr ? curr.split('\n') : [];
  if (curr === prev) return [];
  if (curr.startsWith(prev)) {
    const tail = curr.slice(prev.length).replace(/^\n/, '');
    return tail ? tail.split('\n') : [];
  }
  return curr ? curr.split('\n') : [];
}
