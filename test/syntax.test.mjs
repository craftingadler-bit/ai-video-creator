import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const KIT = path.resolve(import.meta.dirname, '..', 'kit');
test('alle kit-Skripte sind syntaktisch ok', () => {
  for (const f of fs.readdirSync(KIT).filter(f => /\.(mjs|js)$/.test(f) && !f.startsWith('geo-data'))) {
    const r = spawnSync(process.execPath, ['--check', path.join(KIT, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, f + ': ' + r.stderr);
  }
});
test('config.json ist gültiges JSON mit Stimme', () => {
  const c = JSON.parse(fs.readFileSync(path.join(KIT, '..', 'config.json'), 'utf8'));
  assert.ok(c.voicestudio && c.voicestudio.voice);
});
