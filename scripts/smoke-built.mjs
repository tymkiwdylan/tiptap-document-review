import assert from 'node:assert/strict';
import * as esm from '../dist/index.js';
import * as entry from 'tiptap-document-review';
const original = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original paragraph' }] }] };
const revised = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Revised paragraph' }] }] };
for (const [format, api] of [['ESM', esm], ['package entry', entry]]) {
  const schema = api.buildServerSchema();
  const tracked = api.buildTrackedDocument(original, revised);
  assert.equal(tracked.ok, true, format + ' diff builds');
  const accepted = api.resolveTrackedDocument(tracked.document, 'accept');
  const rejected = api.resolveTrackedDocument(tracked.document, 'reject');
  assert.equal(accepted.ok, true, format + ' accepts');
  assert.equal(rejected.ok, true, format + ' rejects');
  assert.deepEqual(accepted.document, schema.nodeFromJSON(revised).toJSON());
  assert.deepEqual(rejected.document, schema.nodeFromJSON(original).toJSON());
  console.log(format + ': built-package accept/reject round trip passed');
}
