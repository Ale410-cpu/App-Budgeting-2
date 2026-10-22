#!/usr/bin/env tsx
/**
 * Test "realistici" del parser scontrini: formati diversi di scontrino
 * italiano (supermercato, bar, benzinaio, farmaci, catena, POS) con le
 * trappole tipiche dell'OCR.
 *
 *   npx tsx scripts/test-receipt-realistic.ts
 */

import { parseReceiptText } from '../src/renderer/utils/receiptParser';

interface Case {
  name: string;
  text: string;
  expect: {
    merchant?: string;
    date?: string;
    amount?: number;
    category?: string;
    paymentMethod?: string;
  };
}

const cases: Case[] = [
  {
    name: 'Supermercato con SUBTOTALE prima del TOTALE',
    text: `CONAD
Via Roma 45
20090 Assago (MI)
P.IVA 01234567890
Scontrino n. 2026/004512      12/10/2026  18:42
Cassa 1
LATTE PARLATO 1L          1,25
BAGNETTO PANE            2,50
GORGONZOLA 200G          4,99
SUBTOTALE               8,74
IVA 10%                0,87
TOTALE                 9,61
CONTANTI               10,00
CAMBIO                  0,39`,
    expect: { merchant: 'CONAD', date: '2026-10-12', amount: 9.61, category: 'Supermercato / Spesa', paymentMethod: 'Contanti' },
  },
  {
    name: 'Totale con conteggio articoli sulla stessa riga',
    text: `BASKET
VIA TITO SPERI 8
00187 ROMA
P.IVA 11122233344
12/10/2026 - 19:02
ARTICOLI 3
MOZZARELLA 250G        3,99
YOGURT NATURALE        1,79
BISCOTTI               2,50
TOTALE ARTICOLI           3
TOTALE COMPLESSO        8,28
PAGA CARTA DI CREDITO   8,28`,
    expect: { merchant: 'BASKET', date: '2026-10-12', amount: 8.28, paymentMethod: 'Carta di credito' },
  },
  {
    name: 'Scontrino con IMPORTAZIONE (non deve diventare il totale)',
    text: `SELERIA MARCONI
Via Po 3, Milano
12 OTT 2026  11:20
GOMMA PERSO 20        1,50
IMPALLA 10 LT         3,20
IMPORTAZIONE         4,70
TOTALE               4,70
CONTANTI             5,00
CAMBIO               0,30`,
    expect: { merchant: 'SELERIA MARCONI', date: '2026-10-12', amount: 4.7 },
  },
  {
    name: 'Data con mese in lettere esteso',
    text: `CAFFE TORINO
Via Garibaldi 3
15 OTTOBRE 2026
ESPRESSO              1,30
CAPPUCCINO            1,80
TOTALE                3,10
CONTANTI              3,10`,
    expect: { merchant: 'CAFFE TORINO', date: '2026-10-15', amount: 3.1 },
  },
  {
    name: 'Scontrino terminale Nexi (IMPORTO)',
    text: `NEXI
Visa Cless
ACQUISTO
RISTORANTE PIZZ. JOLLY
NATIONALSTR.28
SATURN/SALORNO
Eser.  940002628
A. I. I. C.  00000000034
DATA 18/09/26 ORA 21:22
TML 09551994 STAN 038044
Mod. Online  CTLS ICO
PAN:  ************2608
EXP: ****  PanSegN: 000
AUT. 876922 OPER. 038251
Visa contactless
A. ID A0000200031010  APPL  VISA
ATC 0ØB1 TOC 380 TT 00 TrÜC 978 UN CC3E5F97
TVR 0000000000  A.R.Q.C. 8B2C4EDA645903FA
IAD 1F426331A00000000010030273000000004000000000
00000000000000000000
VERIFIED BY DEVICE
IMPORTO  63,80
TRANSAZIONE ESEGUITA
GRAZIE E ARRIVEDERCI
RAIFFEISEN`,
    expect: { merchant: 'RISTORANTE PIZZ. JOLLY', date: '2026-09-18', amount: 63.8, category: 'Ristoranti & Bar' },
  },
  {
    name: 'Riga con quantità (2 x 3,50)',
    text: `PIZZERIA DA LUCA
Via Roma 2
12/10/2026
2 x 3,50              7,00
MARGHERITA 1 x 6,00   6,00
TOTALE COMPLESSO     13,00
VISA                 13,00`,
    expect: { merchant: 'PIZZERIA DA LUCI' === 'x' ? '' : 'PIZZERIA DA LUCA', date: '2026-10-12', amount: 13, category: 'Ristoranti & Bar', paymentMethod: 'Carta di credito' },
  },
  {
    name: 'Totale senza parola chiave (solo importi)',
    text: `SUPERCONAD
12/10/2026
PANNA 1L            1,35
PANE                2,20
GORGONZOLA          5,99
BANCOMAT            9,54`,
    expect: { merchant: 'SUPERCONAD', date: '2026-10-12', amount: 9.54 },
  },
  {
    name: 'Scontrino con sconto e totale',
    text: `DECATHLON
12/10/2026
SCARPA RUN 42        59,99
SCONTO -10%         -6,00
TOTALE              53,99
CARTA               53,99`,
    expect: { merchant: 'DECATHLON', date: '2026-10-12', amount: 53.99 },
  },
  {
    name: 'Importi con punto migliaia e virgola decimali',
    text: `ELETTROSHOP
12/10/2026
TV 55 POLI           1.250,00
CAVO                 19,99
TOTALE             1.269,99
CONTANTI         1.269,99`,
    expect: { merchant: 'ELETTROSHOP', date: '2026-10-12', amount: 1269.99 },
  },
  {
    name: 'Data formato 2 cifre anno',
    text: `BAR SMOKE
12/10/26
SIGARETTE           5,00
TOTALE               5,00`,
    expect: { merchant: 'BAR SMOKE', date: '2026-10-12', amount: 5 },
  },
  {
    name: 'Riga totale con importo prima della parola chiave',
    text: `FARMACIA
12/10/2026
TOTALE 22,34
BANCOMAT 22,34`,
    expect: { merchant: 'FARMACIA', date: '2026-10-12', amount: 22.34 },
  },
];

let failures = 0;

console.log('▸ Scontrini realistici\n');
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

  if (problems.length > 0) failures += 1;
  console.log(`  ${problems.length === 0 ? '✓' : '✗'} ${testCase.name}`);
  console.log(
    `      esercente="${result.merchant}" data=${result.date} importo=${result.amount} cat="${result.category}" pag="${result.paymentMethod}"`
  );
  problems.forEach((problem) => console.log(`      → ${problem}`));
}

console.log(`\n${failures === 0 ? '✅ Tutti i test passano' : `❌ ${failures} test falliti`}`);
process.exit(failures === 0 ? 0 : 1);
