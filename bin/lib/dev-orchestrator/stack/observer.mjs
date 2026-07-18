import { matchLines } from '../patterns-matcher.mjs';
import { diffAppended } from './observer-diff.mjs';

export function observeTick({ services, run, compiledByService, prevCaptures, onMatch }) {
  for (const svc of services) {
    const result = run(svc.args) || {};
    const compiled = compiledByService[svc.name] || [];
    for (const stream of ['stdout', 'stderr']) {
      const key = stream === 'stdout' ? svc.name : `${svc.name} stderr`;
      const capture = result[stream] || '';
      const newLines = diffAppended(prevCaptures[key], capture);
      prevCaptures[key] = capture;
      for (const hit of matchLines(compiled, newLines)) onMatch({ service: svc.name, pattern: hit.pattern, line: hit.line });
    }
  }
}
