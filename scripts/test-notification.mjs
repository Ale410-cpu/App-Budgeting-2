#!/usr/bin/env node
/**
 * Smoke test for the macOS notification pipeline.
 *
 * Launches the packaged app with `--test-notification`, which posts a real
 * system notification and writes the outcome to a temporary log.
 *
 * Usage:
 *   npm run package:dir        # build first
 *   npm run test:notification
 *
 * Expected output:
 *   {"delivered":true,"channel":"native"}
 *
 * `channel: "native"` means macOS accepted the notification through
 * UserNotifications (Notification Center, lock screen, banner, system sound).
 * `channel: "applescript"` means the app is not code-signed and the
 * compatibility channel was used instead.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT_DIR = join(process.cwd(), 'dist-electron');
const LOG_FILE = join(tmpdir(), 'budget-notification-smoke.log');

function findPackagedApp() {
  if (!existsSync(OUT_DIR)) return null;
  for (const entry of readdirSync(OUT_DIR)) {
    if (!entry.startsWith('mac')) continue;
    const candidate = join(OUT_DIR, entry, 'BudgetingMacApp.app');
    const binary = join(candidate, 'Contents', 'MacOS', 'BudgetingMacApp');
    if (existsSync(binary)) return binary;
  }
  return null;
}

const binary = findPackagedApp();
if (!binary) {
  console.error('❌ Nessuna app impacchettata trovata in dist-electron/.');
  console.error('   Esegui prima: npm run package:dir');
  process.exit(1);
}

try {
  rmSync(LOG_FILE, { force: true });
} catch {
  /* ignore */
}

console.log(`▶️  Avvio smoke test: ${binary}`);
const child = spawn(binary, ['--test-notification'], { stdio: 'inherit' });

child.on('exit', () => {
  let report = '';
  try {
    report = readFileSync(LOG_FILE, 'utf8').trim();
  } catch {
    /* ignore */
  }

  if (!report) {
    console.error('❌ Il processo non ha prodotto alcun risultato.');
    process.exit(1);
  }

  console.log(`\n${report}`);
  const delivered = /"delivered":\s*true/.test(report);
  const channel = report.match(/"channel":\s*"([^"]+)"/)?.[1];

  if (delivered && channel === 'native') {
    console.log('✅ Notifica di sistema consegnata (Notification Center di macOS).');
  } else if (delivered) {
    console.log(`⚠️  Consegnata tramite canale di compatibilità "${channel}".`);
    console.log('   Firma l’app (identity: "-") per usare il canale nativo.');
  } else {
    console.log('❌ Notifica non consegnata.');
    process.exit(1);
  }
});
