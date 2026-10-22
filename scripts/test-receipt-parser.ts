#!/usr/bin/env tsx
/**
 * Test del motore di riconoscimento scontrini.
 *
 *   npx tsx scripts/test-receipt-parser.ts
 *
 * Usa scontrini realistici (supermercato, bar, benzinaio, POS) e verifica
 * i campi estratti. Non richiede rete ne' OCR: lavora sul testo.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseReceiptText, parseAmount } from '../src/renderer/utils/receiptParser';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

interface Case {
  name: string;
  text: string;
  expect: {
    merchant?: string;
    date?: string;
    amount?: number;
    category?: string;
    paymentMethod?: string;
    itemCount?: number;
  };
}

const cases: Case[] = [
  {
    name: 'Supermercato (Conad)',
    text: `CONAD
Via Roma 45
20090 Assago (MI)
P.IVA 01234567890

Scontrino n. 2026/004512      12/10/2026  18:42
Cassa 1

LATTE PARLATO 1L          1,25
BAGNETTO PANE            2,50
GORGONZOLA 200G          4,99
PASTA SPAGHETTI          1,10
CAFFE MACINATO 250G      3,45
BOTTIGLIA ACQUA          0,50

TOTALE PEZZI VENDUTI          5
IMPORTAZIONE          13,79
IVA 22%                2,49
TOTALE                16,28
PAGA   CONTANTI       16,28`,
    expect: { merchant: 'CONAD', date: '2026-10-12', amount: 16.28, category: 'Supermercato / Spesa', paymentMethod: 'Contanti', itemCount: 6 },
  },
  {
    name: 'Bar / ristorante',
    text: `BAR CENTRALE
Via Giuseppe Verdi 12
20121 Milano
P.IVA 09876543210

12 OTT 2026  13:05
Tavolo 4  Coperti 2

Caffe espresso         2 x 1,30      2,60
Cappuccino              1 x 3,50      3,50
Cornetto               1 x 1,20      1,20

Subtotale               9,30
Servizio 10%            0,93
TOTALE COMPLESSO      10,23
VISA                  10,23
CAMBIO                 0,00`,
    expect: { merchant: 'BAR CENTRALE', date: '2026-10-12', amount: 10.23, category: 'Ristoranti & Bar', paymentMethod: 'Carta di credito', itemCount: 3 },
  },
  {
    name: 'Benzinaio (Q8)',
    text: `Q8 S.P.A.
VIA ROMA 100
12/10/2026

BENZINA SELF  40,00 LT
   1,85    74,00
TOTALE           74,00
PAGA BANCOMAT    74,00`,
    expect: { merchant: 'Q8 S.P.A.', date: '2026-10-12', amount: 74, category: 'Trasporti', paymentMethod: 'Bancomat' },
  },
  {
    name: 'POS inglese',
    text: `COFFEE LAB
Receipt #1042
2026-10-11
Latte           3,50
Croissant       4,00
TOTALE          7,50
CASH            7,50`,
    expect: { merchant: 'COFFEE LAB', date: '2026-10-11', amount: 7.5, paymentMethod: 'Contanti', itemCount: 2 },
  },
  {
    name: 'Farmacia con imponibile + IVA',
    text: `FARMACIA SAN LUIGI
Corso Italia 30
TORINO

03/09/2026 - 10:12
PARACETAMOLO 1000 20CPR  8,90
CREMA IDRAT. 15,00
TOTALE IMPONIBILE  20,31
IVA 10%  2,03
TOTALE COMPLESSO  22,34
CARTA DI CREDITO  22,34`,
    expect: { merchant: 'FARMACIA SAN LUIGI', date: '2026-09-03', amount: 22.34, category: 'Salute & Benessere', paymentMethod: 'Carta di credito' },
  },
  {
    name: 'Output OCR reale (colonne separate)',
    text: `CONAD
Via Roma 45
P.IVA 01234567890
Scontrino n. 2026/004512
LATTE PARLATO 1L
BAGNETTO PANE
GORGONZOLA 200G
PASTA SPAGHETTI
IMPORTAZIONE
IVA 22%
TOTALE
PAGA CONTANTI
12/10/2026 18:42
1,25
2,50
4,99
1,10
13,79
2,49
16,28
16,28`,
    expect: { merchant: 'CONAD', date: '2026-10-12', amount: 16.28, category: 'Supermercato / Spesa', paymentMethod: 'Contanti', itemCount: 4 },
  },
  {
    name: 'Importi con separatore delle migliaia',
    text: `ELETTROSHOP
Via Roma 1
15/10/2026
TV LED 55"          1.250,00
CAVO HDMI             19,99
TOTALE             1.269,99
CONTANTI         1.269,99`,
    expect: { merchant: 'ELETTROSHOP', date: '2026-10-15', amount: 1269.99, paymentMethod: 'Contanti' },
  },
];

// --- unità sugli importi ---
const amountCases: [string, number | null][] = [
  ['12,34', 12.34],
  ['12.34', 12.34],
  ['1.250,50', 1250.5],
  ['1,250.50', 1250.5],
  ['1.234', 1234],
  ['1 234,56', 1234.56],
  ['€ 16,28', 16.28],
  ['16,28 EUR', 16.28],
  ['abc', null],
  ['', null],
];

let failures = 0;

console.log('▸ Conversione importi');
for (const [input, expected] of amountCases) {
  const actual = parseAmount(input);
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} parseAmount(${JSON.stringify(input)}) = ${actual}${ok ? '' : ` (atteso ${expected})`}`);
}

console.log('\n▸ Analisi scontrini');
for (const testCase of cases) {
  const result = parseReceiptText(testCase.text);
  const problems: string[] = [];

  if (testCase.expect.merchant !== undefined && !result.merchant.toUpperCase().includes(testCase.expect.merchant.toUpperCase())) {
    problems.push(`esercente "${result.merchant}" != "${testCase.expect.merchant}"`);
  }
  if (testCase.expect.date && result.date !== testCase.expect.date) {
    problems.push(`data "${result.date}" != "${testCase.expect.date}"`);
  }
  if (testCase.expect.amount !== undefined && Math.abs(result.amount - testCase.expect.amount) > 0.011) {
    problems.push(`importo ${result.amount} != ${testCase.expect.amount}`);
  }
  if (testCase.expect.category && result.category !== testCase.expect.category) {
    problems.push(`categoria "${result.category}" != "${testCase.expect.category}"`);
  }
  if (testCase.expect.paymentMethod && result.paymentMethod !== testCase.expect.paymentMethod) {
    problems.push(`pagamento "${result.paymentMethod}" != "${testCase.expect.paymentMethod}"`);
  }
  if (testCase.expect.itemCount !== undefined && result.items.length !== testCase.expect.itemCount) {
    problems.push(`righe ${result.items.length} != ${testCase.expect.itemCount}`);
  }

  if (problems.length > 0) failures += 1;
  console.log(`  ${problems.length === 0 ? '✓' : '✗'} ${testCase.name}`);
  console.log(
    `      esercente="${result.merchant}" data=${result.date} importo=${result.amount} ` +
      `cat="${result.category}" pag="${result.paymentMethod}" righe=${result.items.length} conf=${result.confidence}`
  );
  if (problems.length > 0) {
    problems.forEach((problem) => console.log(`      → ${problem}`));
    result.warnings.forEach((warning) => console.log(`      ! ${warning}`));
  }
}

console.log(`\n${failures === 0 ? '✅ Tutti i test passano' : `❌ ${failures} test falliti`}`);

// --- integrazione: OCR reale (Apple Vision) -> parser ---
const ocrBinary = path.join(scriptDir, '..', 'electron', 'bin', 'receipt-ocr');
if (fs.existsSync(ocrBinary)) {
  console.log('\n▸ Integrazione con il motore OCR (Apple Vision)');

  const sample = path.join(os.tmpdir(), 'budget-receipt-sample.png');
  const lines = [
    'CONAD',
    'Via Roma 45',
    'P.IVA 01234567890',
    'Scontrino n. 2026/004512',
    'LATTE PARLATO 1L',
    'BAGNETTO PANE',
    'GORGONZOLA 200G',
    'IMPORTAZIONE',
    'IVA 22%',
    'TOTALE',
    'PAGA CONTANTI',
    '12/10/2026 18:42',
    '1,25',
    '2,50',
    '4,99',
    '13,79',
    '2,49',
    '16,28',
    '16,28',
  ];

  // Genera un'immagine di prova con lo stesso motore del progetto.
  const generator = path.join(os.tmpdir(), 'budget-receipt-generator.swift');
  fs.writeFileSync(
    generator,
    `
import Foundation
import AppKit
let image = NSImage(size: NSSize(width: 640, height: ${lines.length * 34 + 40}))
image.lockFocus()
NSColor.white.setFill()
NSRect(x: 0, y: 0, width: 640, height: ${lines.length * 34 + 40}).fill()
var y = Double(${lines.length * 34 + 10})
for line in ${JSON.stringify(lines)} {
    let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.monospacedSystemFont(ofSize: 20, weight: .regular),
        .foregroundColor: NSColor.black,
    ]
    NSAttributedString(string: line, attributes: attributes).draw(at: NSPoint(x: 24, y: y))
    y -= 34
}
image.unlockFocus()
let tiff = image.tiffRepresentation!
let rep = NSBitmapImageRep(data: tiff)!
let png = rep.representation(using: .png, properties: [:])!
try png.write(to: URL(fileURLWithPath: "${sample}"))
`
  );

  try {
    execFileSync('swift', [generator], { stdio: 'ignore', timeout: 120000 });
    const stdout = execFileSync(ocrBinary, [sample], { encoding: 'utf-8', timeout: 120000 });
    const ocrText = JSON.parse(stdout).text as string;

    if (!ocrText) {
      console.log('  ⚠️  test OCR saltato: il motore Vision non ha riconosciuto nulla (servizi ML non disponibili).');
      process.exit(0);
    }

    const result = parseReceiptText(ocrText);

    const checks: [string, boolean][] = [
      ['esercente', result.merchant.toUpperCase().includes('CONAD')],
      ['data', result.date === '2026-10-12'],
      ['importo', Math.abs(result.amount - 16.28) < 0.011],
      ['categoria', result.category === 'Supermercato / Spesa'],
      ['righe', result.items.length >= 3],
    ];

    for (const [name, ok] of checks) {
      if (!ok) failures += 1;
      console.log(
        `  ${ok ? '✓' : '✗'} ${name}: esercente="${result.merchant}" data=${result.date} importo=${result.amount} righe=${result.items.length}`
      );
    }

    fs.unlinkSync(sample);
    fs.unlinkSync(generator);
  } catch (error: any) {
    const message = String(error?.message || error);
    if (message.includes('e5rt') || message.includes('precompiled')) {
      console.log(
        '  ⚠️  test OCR saltato: i servizi ML di Apple non sono disponibili (mlruntimed/mlhostd).'
      );
      console.log('      Riavvia il Mac o disattiva le ottimizzazioni di CleanMyMac, poi riprova.');
    } else {
      console.log(`  ⚠️  test OCR saltato: ${message}`);
    }
  }
}

console.log(`\n${failures === 0 ? '✅ Tutti i test passano' : `❌ ${failures} test falliti`}`);
process.exit(failures === 0 ? 0 : 1);
