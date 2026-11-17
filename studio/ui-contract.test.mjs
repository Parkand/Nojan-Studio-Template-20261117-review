import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Static UI contract; does not claim browser rendering or server integration coverage.
test('Studio rebuild button sends the selected project revision', async () => {
  const ui = await readFile(new URL('../src/app/studio/studio-panel.tsx', import.meta.url), 'utf8');
  assert.match(ui, /mutate\('build',\{id:project\.id,revision:project\.revision,confirm:confirmBuild\}/);
});
