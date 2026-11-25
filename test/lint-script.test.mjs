import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lintScript, parseScript, bannedLists, pronunciationList, detectLang } from '../kit/lint-script.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const guides = {
  banned: bannedLists(fs.readFileSync(path.join(ROOT, 'guides/humor.md'), 'utf8')),
  pron: pronunciationList(fs.readFileSync(path.join(ROOT, 'guides/pronunciation.md'), 'utf8')),
  lang: 'en',
};
const scene = (i, vo) => `## s${i} Szene ${i}\nVO: ${vo}\nBILD: irgendwas\n`;
// Sauberes Script: 10 Szenen à ~16 Wörter → ~60 s
const filler = 'Your internship report sits on the desk. The coffee is cold. / Nobody cares about the deadline.';
const good = (s1 = 'What if the *Roman Empire* never fell? / Like, never.', last = '// Which province would you pick? Tell me in the comments.') =>
  '# Test\nhook: What if\n\n' + [scene(1, s1), ...Array.from({ length: 8 }, (_, i) => scene(i + 2, '// ' + filler)), scene(10, last)].join('\n');
const sev = (r, s) => r.findings.filter(f => f.sev === s);
const has = (r, s, re) => r.findings.some(f => f.sev === s && re.test(f.msg));

test('sauberes Script hat keine kritischen Befunde', () => {
  const r = lintScript(good(), guides);
  assert.deepEqual(sev(r, '!!'), []);
  assert.equal(r.stats.scenes, 10);
  assert.ok(r.stats.estSeconds > 45 && r.stats.estSeconds < 75, 'Schätzung ' + r.stats.estSeconds);
});

test('parseScript liest Szenen wie voice.mjs, inkl. Fortsetzungszeilen', () => {
  const { title, scenes } = parseScript('# T\n\n## s1 Hook\nVO: Erste Zeile\nzweite Zeile\nBILD: Bild\n\n## s2a Teil\nVO: Noch was.\n');
  assert.equal(title, 'T');
  assert.deepEqual(scenes.map(s => s.id), ['s1', 's2a']);
  assert.equal(scenes[0].vo, 'Erste Zeile zweite Zeile');
});

test('Pause mitten im Satz ist kritisch, nach Satzende ok', () => {
  const r = lintScript(good(undefined, '// Huge plans, barely any sleep, / and always wrong. Tell me in the comments?'), guides);
  assert.ok(has(r, '!!', /mitten im Satz nach "sleep,"/));
  assert.ok(!has(r, '!!', /mitten im Satz nach "never\."/));
});

test('Hook zu lang oder mit Intro', () => {
  assert.ok(has(lintScript(good('What if the Roman Empire never fell and nobody ever noticed it at all?'), guides), '!!', /Hook hat 14 Wörter/));
  assert.ok(has(lintScript(good('Hey guys, what if Rome never fell?'), guides), '!!', /startet mit "hey"/));
});

test('Länge: zu lang wird mit Wortzahl zum Kürzen gemeldet', () => {
  const long = '# T\n' + [scene(1, 'What if Rome never fell?'), ...Array.from({ length: 12 }, (_, i) => scene(i + 2, filler + ' ' + filler))].join('\n');
  assert.ok(has(lintScript(long, guides), '!!', /Ziel 45–75 s → ca\. \d+ Wörter raus/));
});

test('verbotene Wörter (englisch) und Ausnahme für "Schick das an"', () => {
  assert.ok(has(lintScript(good(undefined, '// Let\'s delve into the comments. Which one?'), guides), '!!', /"delve"/));
  const de = { ...guides, lang: 'de' };
  const r = lintScript('# T\n' + scene(1, 'Was wäre, wenn Rom nie gefallen wäre?') + scene(2, 'Schick das an deinen Ausbilder.'), de);
  assert.ok(!has(r, '!!', /schick/i));
  const r2 = lintScript('# T\n' + scene(1, 'Was wäre, wenn Rom nie gefallen wäre?') + scene(2, 'Das Büro ist echt schick. Schreib es in die Kommentare.'), de);
  assert.ok(has(r2, '!!', /"schick"/));
});

test('Aussprache-Liste, Abkürzungen, Schlagwörter, Format', () => {
  const r = lintScript(good(undefined, '// You live in *Germania.* The BER is *still* *closed.* Comments?'), guides);
  assert.ok(has(r, '!', /"Germania" klingt wie/));
  assert.ok(has(r, '!', /Abkürzung BER/));
  assert.ok(has(r, '!', /2 Schlagwörter in einem Satz/));
  assert.ok(has(lintScript(good('What if *Rome never fell?'), guides), '!!', /Sternchen nicht geschlossen/));
  assert.ok(has(lintScript('nur Text', guides), '!!', /Keine Szenen/));
});

test('CTA fehlt in der letzten Szene', () => {
  assert.ok(has(lintScript(good(undefined, '// And that was it.'), guides), '!', /ohne CTA/));
});

test('Sprache wird erkannt', () => {
  assert.equal(detectLang('What if the empire never fell and you'), 'en');
  assert.equal(detectLang('Was wäre, wenn die Bahn nicht pünktlich ist und du'), 'de');
});

test('alle Scripts im Repo sind formal lesbar (keine Formatfehler)', () => {
  const reels = path.join(ROOT, 'reels');
  for (const d of fs.readdirSync(reels)) {
    const f = path.join(reels, d, 'script.md');
    if (!fs.existsSync(f)) continue;
    const r = lintScript(fs.readFileSync(f, 'utf8'), guides);
    assert.deepEqual(r.findings.filter(x => x.kind === 'format' && x.sev === '!!'), [], d);
  }
});
