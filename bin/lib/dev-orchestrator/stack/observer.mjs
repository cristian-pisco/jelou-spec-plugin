import { matchLines } from '../patterns-matcher.mjs';
import { diffAppended } from './observer-diff.mjs';

export function observeTick({ services, run, compiledByService, prevCaptures, onMatch }) {
  for (const svc of services) {
    const capture = run(svc.args).stdout || '';
    const newLines = diffAppended(prevCaptures[svc.name], capture);
    prevCaptures[svc.name] = capture;
    const hits = matchLines(compiledByService[svc.name] || [], newLines);
    for (const hit of hits) onMatch({ service: svc.name, pattern: hit.pattern, line: hit.line });
  }
}
