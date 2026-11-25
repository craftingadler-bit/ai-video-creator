// "check my setup": prüft Node, ffmpeg, Playwright/Chromium und VoiceStudio und listet die Stimmen
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const win = process.platform === 'win32', mac = process.platform === 'darwin';
let fail = 0;
const line = (ok, name, info, fix) => { console.log(`${ok ? '✔' : '✘'} ${name.padEnd(13)} ${info}`); if (!ok) { fail++; if (fix) console.log(`   → ${fix}`); } };

const [maj] = process.versions.node.split('.').map(Number);
line(maj >= 18, 'Node.js', process.version, 'Node 20 LTS installieren: https://nodejs.org');

const ff = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
line(ff.status === 0, 'ffmpeg', ff.status === 0 ? ff.stdout.split('\n')[0].slice(0, 40) : 'fehlt',
  mac ? 'brew install ffmpeg' : win ? 'winget install --id Gyan.FFmpeg  (danach Terminal neu öffnen)' : 'sudo apt install ffmpeg');

let pw = false;
try {
  const { chromium } = await import('playwright');
  const b = await chromium.launch(); await b.close(); pw = true;
  line(true, 'Playwright', 'Chromium startet');
} catch (e) {
  line(false, 'Playwright', String(e.message).split('\n')[0].slice(0, 70), 'npm install  und danach  npx playwright install chromium');
}

const VS = cfg.voicestudio, headers = VS.apiKey ? { Authorization: 'Bearer ' + VS.apiKey } : {};
const h = await fetch(VS.url + '/health', { headers }).catch(() => null);
line(!!h?.ok, 'VoiceStudio', h?.ok ? VS.url + ' erreichbar' : VS.url + ' nicht erreichbar', 'VoiceStudio-App starten (die lokale API läuft mit der App) oder "url" in config.json anpassen');
if (h?.ok) {
  const v = await fetch(VS.url + '/v1/audio/voices', { headers }).then(r => r.json()).catch(() => null);
  const list = (v?.voices || v?.data || []).filter(x => x.type === 'profile');
  if (list.length) {
    console.log('\n  Deine Stimmen (voice_id → config.json "voicestudio.voice"):');
    list.forEach(x => console.log(`   ${x.voice_id === VS.voice ? '→' : ' '} ${x.voice_id}  ${x.name}  ${x.language || ''}`));
  } else console.log('  Noch keine eigene Stimme. In VoiceStudio eine klonen oder designen.');
  line(!!VS.voice, 'Stimme', VS.voice || 'nicht gesetzt', 'voice_id aus der Liste oben in config.json eintragen');
}
console.log(fail ? `\n${fail} Punkt(e) offen.` : '\nAlles bereit. Nächstes Reel: Thema in einem Satz an Claude schicken.');
