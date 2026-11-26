// The line jig verify records as why a check failed. For node --test, the
// output ends in the error object's closing brace, which says nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheck } from '../cli/lib/verify.mjs';
import { tempRepo } from './verify.test.mjs';

const check = (script) => runCheck(tempRepo().dir, { id: 'C1', slice: 'S1', cmd: `node -e ${JSON.stringify(script)}`, timeout_s: 10 });

test('a node --test failure records the assertion, not the closing brace', () => {
  const r = check("console.log(['✖ totals an order', '  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:', '  ', '  7 !== 6', '  ', '      at TestContext.<anonymous> (file:///t.test.mjs:3:38) {', '    generatedMessage: true,', \"    code: 'ERR_ASSERTION',\", '    actual: 7,', '  }'].join('\\n')); process.exit(1)");
  assert.match(r.why, /7 !== 6$/);
});

test('a summary line at the end is still the one recorded', () => {
  assert.match(check("console.log('Tests:       1 failed, 1 total'); process.exit(1)").why, /Tests: +1 failed, 1 total$/);
  assert.match(check("console.error('boom'); process.exit(1)").why, /boom$/);
});

test("an uncaught error records the error, not node's version line", () => {
  const r = check("console.error(['AssertionError [ERR_ASSERTION]: total([1, 2, 3]) should be 6', '    at file:///t.js:3:8 {', '  generatedMessage: false,', \"  operator: 'strictEqual'\", '}', '', 'Node.js v20.19.5'].join('\\n')); process.exit(1)");
  assert.match(r.why, /total\(\[1, 2, 3\]\) should be 6$/);
});
