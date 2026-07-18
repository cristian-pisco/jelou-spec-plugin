// tests/unit/stack-ports.test.mjs
//
// Run: `node --test tests/unit/stack-ports.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { allocateHostPorts, parseOccupiedPorts } from '../../bin/lib/dev-orchestrator/stack/ports.mjs';

describe('allocateHostPorts', () => {
  test('allocates sequentially from basePort', () => {
    const out = allocateHostPorts({ mappings: [{ internal: 8080 }, { internal: 9001 }], occupied: new Set(), basePort: 3100 });
    assert.deepEqual(out, [{ internal: 8080, host: 3100 }, { internal: 9001, host: 3101 }]);
  });

  test('skips occupied host ports', () => {
    const out = allocateHostPorts({ mappings: [{ internal: 8080 }, { internal: 9001 }], occupied: new Set([3100, 3101]), basePort: 3100 });
    assert.deepEqual(out, [{ internal: 8080, host: 3102 }, { internal: 9001, host: 3103 }]);
  });

  test('does not reuse a port within the same allocation', () => {
    const out = allocateHostPorts({ mappings: [{ internal: 8080 }, { internal: 8081 }], occupied: new Set([3101]), basePort: 3100 });
    assert.deepEqual(out, [{ internal: 8080, host: 3100 }, { internal: 8081, host: 3102 }]);
  });

  test('throws when the search would exceed 65535', () => {
    assert.throws(
      () => allocateHostPorts({ mappings: [{ internal: 8080 }], occupied: new Set(), basePort: 65536 }),
      /no free host port/
    );
  });
});

describe('parseOccupiedPorts', () => {
  test('extracts host-bound ports from docker ps output', () => {
    const out = parseOccupiedPorts('0.0.0.0:3100->8080/tcp, 0.0.0.0:5433->5432/tcp');
    assert.equal(out.has(3100), true);
    assert.equal(out.has(5433), true);
    assert.equal(out.has(8080), false);
  });
});
