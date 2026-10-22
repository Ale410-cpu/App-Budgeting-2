# Registro budget

Spazio di lavoro desktop per macOS costruito con Electron, React, Vite e TypeScript.

## Cosa include

- Shell moderna e adatta a macOS per i flussi di budgeting
- Dashboard dettagliata per flusso di cassa, budget, transazioni e patrimonio netto
- Processo principale Electron con bridge di preload sicuro
- Renderer React basato su Vite
- Persistenza automatica su file system per non perdere i dati durante gli aggiornamenti dell'app

## Design System 🎨

L'interfaccia segue un design system dedicato (profilo di prodotto
*Personal Finance Tracker*: Glassmorphism + Dark Mode OLED, densità dashboard,
palette "trust blue + profit green"), definito a mano e documentato nel repo.

- **Token a 3 livelli** — primitivi → semantici → componenti, definiti in
  `src/renderer/styles.css` (`:root` + `:root.light-theme`)
- **Contratto dei token** → [`design-system/budget-ledger/TOKENS.md`](design-system/budget-ledger/TOKENS.md)
- **Regole del sistema** → [`design-system/budget-ledger/MASTER.md`](design-system/budget-ledger/MASTER.md)
- **Tipografia** Fira Sans + Fira Code, self-hosted in `src/renderer/fonts/`
  (nessuna dipendenza di rete a runtime, l'app funziona offline)
- **Tema chiaro e scuro** derivati dagli stessi token semantici
- **Accento** teal, con la famiglia di varianti (`soft`, `border`, `glow`) derivata via
  `color-mix()`: se l'utente sceglie un accento personalizzato in Impostazioni, tutte
  le superfici correlate si aggiornano da sole

Regole operative:

1. Nel codice dei componenti **mai** valori hex/rgb diretti: si usano solo token.
2. Il significato non è mai affidato al solo colore (mai solo colore → sempre anche
   etichetta, icona o segno).
3. Gli elementi interattivi hanno sempre un focus visibile (`:focus-visible`).
4. `prefers-reduced-motion` è rispettato globalmente.

Verifica del rispetto delle regole:

```bash
python3 scripts/audit_tokens.py
```

## Icona dell'app 🖼️

L'icona è disegnata in modo vettoriale (CoreGraphics) e poi esportata in tutti i
formati necessari. Per rigenerarla:

```bash
npm run icons      # swift scripts/generate-icons.swift && python3 scripts/build_favicon_ico.py
```

| File | Uso |
|------|-----|
| `build/icon.icns` | icona macOS del bundle (Dock, Finder, Spotlight) |
| `build/icon.png` | sorgente 1024×1024 per electron-builder |
| `public/icon.png` | icona dell'app nel renderer (marchio laterale) + PWA |
| `public/icon-192.png`, `public/icon-512.png` | icone PWA / manifest |
| `public/favicon-16x16.png`, `public/favicon-32x32.png`, `public/favicon.ico` | favicon |
| `public/apple-touch-icon.png` | icona per iOS/iPadOS (opaca) |
| `ios/.../AppIcon.appiconset/AppIcon-1024.png` | icona dell'app iOS (opaca, senza canale alfa) |
| `electron/icon.png` | icona a runtime (Dock in sviluppo, finestra) |

**Dimensione costante nel Dock**: in un build impacchettato macOS legge da solo
`Contents/Resources/icon.icns`, quindi l'icona ha esattamente la stessa
dimensione di qualsiasi altra app. Per questo in produzione **non** viene
impostata un'icona raster a runtime (`app.dock.setIcon`): si fa solo in
sviluppo, dove non esiste un bundle da cui leggere l'`.icns`.

**L'icona resta nel Dock quando l'app è chiusa**: chiudere la finestra non
termina il processo su macOS, l'app resta nel Dock e cliccando l'icona la
finestra si riapre.

> L'icona è disegnata sulla griglia standard macOS (forma squircle con il
> padding ottico corretto): è questo dettaglio — non la risoluzione — a far
> apparire l'icona della stessa grandezza di quelle delle altre app.

## Notifiche di sistema su macOS 🔔

Le notifiche arrivano **sul Mac**, nel Notification Center (icona in alto a destra),
e non come banner dentro l'app.

### Canale di consegna

| Canale | Quando | Comportamento |
|--------|--------|----------------|
| `native` | App firmata (build standard) | `UserNotifications`: banner, Centro Notifiche, lock screen, suono di sistema, click → porta in primo piano l'app |
| `applescript` | App non firmata | Canale di compatibilità via `osascript`: la notifica arriva comunque al sistema |
| `none` | Nessun canale disponibile | L'app ripiega sul banner interno (solo build browser) |

### Requisito fondamentale: la firma del codice

macOS **rifiuta l'autorizzazione alle notifiche** per le applicazioni non firmate.
In quel caso il sistema risponde `didGrant: 0 / hasError: 1` e la notifica non
compare mai. È il motivo per cui Electron emette l'evento `failed`.

Per questo il build standard firma l'app con identità **ad-hoc**
(`"identity": "-"` in `package.json`): non serve alcun certificato a pagamento
e le notifiche funzionano subito.

```bash
npm run package:mac      # .dmg firmato ad-hoc → notifiche native attive
npm run package:dir      # app non impacchettata, comoda per il debug
```

Per una distribuzione con **Developer ID** (notarizzazione) sostituisci
`"identity": "-"` con `"identity": null` e fornisci il certificato:

```bash
CSC_LINK=/percorso/cert.p12 CSC_KEY_PASSWORD=password npm run package:mac
```

### Verifica rapida

```bash
npm run package:dir
npm run test:notification
# → {"delivered":true,"channel":"native"}
```

Il comando avvia l'app impacchettata con `--test-notification`, che pubblica una
notifica di sistema reale e riporta l'esito.

## Installazione delle dipendenze

Prima di avviare o impacchettare l'applicazione, assicurati di installare tutte le dipendenze richieste:

```bash
npm install
```

## Sviluppo Locale (Avvio)

Per avviare l'applicazione in modalità di sviluppo con ricaricamento rapido:

```bash
npm run dev
```

## Generazione dell'Eseguibile (Packaging)

L'applicazione è configurata per essere impacchettata in un eseguibile nativo per la tua piattaforma corrente (macOS, Windows, Linux) utilizzando `electron-builder`.

### 1. Creare l'eseguibile completo (Installer/Pacchetto distribuibile)
Questo comando compila l'applicazione React e genera il pacchetto pronto all'uso nella cartella `dist-electron/` (ad esempio, un file `.dmg` o `.zip` per macOS, `.exe` o `.zip` per Windows, oppure `.AppImage` per Linux):

```bash
npm run package
```

### 2. Generare specificamente il file .dmg per macOS 🍏
Se sei su macOS e desideri generare **esclusivamente l'installer .dmg** da inviare e distribuire ad altri utenti, puoi lanciare il comando dedicato:

```bash
npm run package:mac
```

#### Come funziona e dove trovare il file:
1. Il comando esegue prima la build del frontend e poi richiama `electron-builder` configurato per macOS.
2. Troverai il file `.dmg` pronto all'uso all'interno della cartella:
   ```text
   dist-electron/BudgetingMacApp-0.1.0.dmg
   ```
3. Puoi inviare questo file `.dmg` tramite email, WeTransfer, cloud storage (Google Drive, Dropbox) o qualsiasi altro canale a chiunque desideri installare l'applicazione.

#### Note importanti per la distribuzione (Gatekeeper di macOS) 🛡️
Poiché l'applicazione viene compilata localmente senza una firma digitale legata a un account Apple Developer ufficiale (a pagamento), quando altri utenti scaricheranno e apriranno il file `.dmg`, macOS mostrerà l'avviso di protezione **"Impossibile aprire l'applicazione perché lo sviluppatore non è verificato"**.

Per permettere ai tuoi utenti di installare ed avviare l'applicazione in sicurezza, puoi fornire loro queste brevi e semplici istruzioni:
1. **Spostare l'applicazione**: Aprire il file `.dmg` e trascinare l'icona di **BudgetingMacApp** dentro la cartella **Applicazioni** (Applications) del Mac.
2. **Aprire l'applicazione la prima volta**:
   - Andare nella cartella *Applicazioni*.
   - Invece di fare doppio clic, fare **clic destro** (o `Control + clic`) sull'icona di **BudgetingMacApp**.
   - Selezionare **Apri** dal menu contestuale.
   - Apparirà una finestra con l'opzione di forzare l'avvio: fare clic su **Apri**.
3. Da questo momento in poi, l'applicazione si avvierà normalmente con un semplice doppio clic, senza mostrare ulteriori messaggi di avviso.

---

### 3. Creare una versione "unpacked" (Senza installer per test veloci)
Se vuoi solo testare la build pre-compilata senza attendere la creazione dell'installer o del file compresso:

```bash
npm run package:dir
```

Tutti gli output generati saranno disponibili nella cartella `/dist-electron`.

---

## Versione iOS (sideloading) 📲

La stessa web app e' disponibile anche per **iPhone e iPad**, installabili
**senza passare dall'App Store** tramite AltStore o Sideloadly.

L'app iOS e' un progetto **Xcode nativo** (Swift, nessuna dipendenza esterna)
che contiene la web app React/Vite in una WebView:

```
ios/
├── BudgetApp.xcodeproj          progetto Xcode
└── BudgetApp/
    ├── AppDelegate.swift         avvio, WebView, dialoghi JS
    ├── Bridge/
    │   ├── AppSchemeHandler.swift  serve il bundle web (budgetapp://app.local)
    │   └── BudgetBridge.swift       ponte nativo (window.budgetApp)
    └── Resources/                Info.plist, icona, bundle web
```

| Componente | Ruolo |
|------------|-------|
| `budgetapp://localhost` | schema URL custom: dà alla WebView un'origine reale e persistente (`localStorage`, `IndexedDB`, moduli ES e worker pdf.js funzionano; con `file://` la schermata sarebbe nera) |
| `BudgetBridge.swift` | espone `window.budgetApp` con la **stessa API del preload di Electron**: dati su disco, notifiche di sistema, prezzi dei titoli, controllo aggiornamenti, picker dei file |
| `AppSchemeHandler.swift` | serve il bundle Vite (`ios/BudgetApp/Resources/web/`) all'interno dell'app |
| `vite.config.ios.ts` | build iOS "single-file": script e CSS inlineati nell'HTML (necessario su iOS 26+, vedi la guida) |

### Build

```bash
npm run package:ios              # → dist-ios/BudgetApp-<versione>.ipa  (non firmato: verrà firmato da AltStore/Sideloadly)
npm run package:ios:signed -- ID # → IPA firmato con il tuo ID Apple (valido 7 giorni)
npm run package:ios:source       # → dist-ios/BudgetApp-<versione>-xcode.zip (progetto Xcode pronto: firma in proprio)
```

### Installazione

Vedi la guida completa: **[`GUIDA_INSTALLAZIONE_ALTSTORE_IOS.md`](GUIDA_INSTALLAZIONE_ALTSTORE_IOS.md)**

**AltStore non e' obbligatorio**: serve solo qualcosa che firmi l'IPA con il
tuo ID Apple e lo installi sul telefono.

| Strumento | Pro |
|-----------|-----|
| **Sideloadly** 🏆 | un programma sul computer, installa anche via Wi-Fi senza cavo |
| **AltStore + AltServer** | rinnovo automatico in background se il computer resta sulla stessa Wi-Fi |
| **Xcode diretto** | niente IPA: `npm run ios:sync` e premi *Run* sul telefono |

### Il modello "ogni utente firma in proprio" 🔏

Se non vuoi comprare l'account Developer (99$/anno), puoi distribuire il
**progetto Xcode** (`npm run package:ios:source`): ogni utente lo apre sul
proprio Mac, sceglie il proprio Team gratuito e preme *Run* sul proprio
telefono. Non serve Xcode (né Node.js) su chi riceve il pacchetto.

**Dopo 7 giorni** la firma scade e l'app smette di avviarsi: va **riffirmata**.
Serve sempre un computer (iOS non firma da solo), ma **non serve il cavo**:
basta abilitare il debug wireless (`Xcode > Settings > Platforms > iOS >
Connect via network`) e poi rilanciare *Run*. Reinstallando l'app i dati
restano intatti, purché il Bundle Identifier non cambi.

L'unica alternativa alla scadenza è l'account Developer a pagamento: firma
annuale + distribuzione via TestFlight.

> ⚠️ La compilazione iOS richiede **Xcode completo**: le Command Line Tools
> (`xcode-select`) non contengono l'iOS SDK.

### Sviluppo da Xcode

```bash
npm run ios:sync     # copia il bundle web dentro il progetto
open ios/BudgetApp.xcodeproj
```

### Dati su iCloud Drive ☁️ (Mac e iOS sullo stesso file)

Mac e iOS possono leggere e scrivere **lo stesso file `user-data.json` su
iCloud Drive**: in questo modo, aprendo l'app su uno o sull'altro, si trovano
**gli stessi dati aggiornati**.

**Setup** (una volta sola, su ciascun dispositivo):

- **Mac** → *Impostazioni → Archiviazione & Sincronizzazione File Dati* →
  **"🔗 Collega file esistente (iCloud Drive)"** → **⌘⇧G** →
  `~/Library/Mobile Documents/com~apple~CloudDocs/user-data.json`
- **iPhone/iPad** → stessa sezione → **"🔗 Collega file esistente (iCloud
  Drive)"** → nell'app File scegli lo stesso `user-data.json`

| Direzione | Comportamento | Tempi |
|-----------|---------------|-------|
| **iPhone → Mac** | scrittura su iCloud Drive, il Mac rileva e ricarica | pochi secondi |
| **Mac → iPhone** | l'app rileva il file cambiato e **ricarica i dati** | ~10-15 s |
| **Apertura app** | controlla comunque il file e si allinea | immediato |

Cosa rende la sincronizzazione affidabile:

- le scritture su iCloud Drive sono **distanziate** (max una ogni 8 s) e
  scattano comunque quando l'app va in background → il file non resta mai
  "sporco" e iCloud può consegnare le modifiche dell'altra piattaforma;
- lettura e scrittura passano da un **`NSFileCoordinator`** (il modo previsto
  da iOS per i documenti esterni, evita conflitti con il daemon di iCloud);
- prima di scrivere l'app **verifica se il file è cambiato dall'esterno**: in
  quel caso non lo sovrascrive, ma ricarica i dati;
- c'è **"🔄 Ricarica da iCloud"** per rileggere il file su richiesta.

> ⚠️ È un file condiviso, non un database: se modifichi i dati
> **contemporaneamente** su Mac e iPhone, l'ultima modifica vince. Il formato
> consigliato è usare un dispositivo alla volta.

I dati dell'app iOS sono salvati in `user-data.json` dentro la cartella
dell'app, visibile nell'app **File** e esportabile su iCloud Drive con i
pulsanti di export.

---

## Conservazione dei Dati Utente durante gli Aggiornamenti 🛡️

È stata implementata una **pipeline di persistenza a livello di sistema operativo** per garantire che l'utente non perda MAI le proprie transazioni, budget, asset o configurazioni quando installa una nuova versione dell'applicazione.

### Come funziona:
1. **Sincronizzazione su Disco Locale**: Oltre a salvare i dati in `localStorage` all'interno del browser (che potrebbe essere cancellato durante la pulizia dei dati o gli aggiornamenti del browser), l'app comunica tramite l'IPC Bridge sicuro di Electron per salvare un file `user-data.json` nella cartella di sistema dell'utente (`app.getPath('userData')`).
2. **Indipendente dall'App**: Questa cartella è gestita direttamente dal sistema operativo ed è esterna ai file d'installazione dell'applicazione. Di conseguenza, quando l'utente disinstalla la vecchia versione o installa un aggiornamento sovrascrivendola, la cartella dei dati **non viene toccata**.
3. **Ripristino Automatico all'Avvio**: Al primo avvio della nuova versione dell'applicazione, il bridge di Electron rileva la presenza del file `user-data.json`, carica automaticamente tutti i dati storici (transazioni, budget, patrimonio netto iniziale, ecc.) e sincronizza lo stato in tempo reale.

Le informazioni salvate e protette includono:
- Tutte le transazioni inserite o importate
- L'ordinamento personalizzato delle transazioni
- I budget mensili e le categorie di spesa modificati
- Gli asset finanziari e la cronologia delle loro quote acquistate o vendute
- I valori della cassa iniziale, del patrimonio netto iniziale e la data iniziale del capitale
- Le transazioni ricorrenti configurate (settimanali, mensili, giorni personalizzati) e attive
- I piani di accumulo del capitale (PAC) attivi legati ai tuoi asset portafoglio

---

## Aggiornamenti Automatici da GitHub 🚀

L'applicazione include un sistema integrato di aggiornamento automatico che comunica con l'API ufficiale di GitHub Releases:

### Come funziona per l'utente:
1. **Controllo automatico all'avvio**: Ad ogni apertura dell'applicazione, viene interrogata l'API di GitHub per verificare se è presente una release con versione semver superiore a quella corrente (es. `v0.2.0` rispetto a `v0.1.0`).
2. **Richiesta di Consenso**: Se un nuovo aggiornamento è disponibile, l'applicazione apre un dialogo modale dedicato che illustra:
   - Nuova versione vs versione attuale
   - Data di rilascio e note/changelog
   - Nome del file e dimensione del pacchetto (es. `BudgetingMacApp-0.2.0.dmg`)
   - Domanda esplicita di consenso: *"Vuoi scaricare e installare questo aggiornamento adesso?"*
3. **Download e Installazione**:
   - Se l'utente acconsente ("Installa ora"), il download si avvia con una barra di avanzamento e conteggio MB in tempo reale.
   - Al completamento del download nella cartella temporanea, il file DMG o l'installer viene aperto automaticamente sul sistema.
   - Tutti i dati personali e le transazioni restano al 100% protetti e preservati grazie alla persistenza in `app.getPath('userData')`.
4. **Opzioni di rinvio**: L'utente può scegliere "Più tardi" oppure "Salta questa versione" per non ricevere ulteriori avvisi per quello specifico rilascio.
5. **Configurazione & Controllo Manuale**: Nella sezione **Impostazioni > Aggiornamenti & Versioni** è possibile:
   - Attivare o disattivare il controllo automatico ad ogni avvio.
   - Modificare il repository GitHub monitorato (predefinito: `sole31012002/budgeting-mac-app`).
   - Lanciare un controllo manuale con un clic sul pulsante *"Controlla aggiornamenti adesso"*.

### Come pubblicare una nuova versione su GitHub (Per lo sviluppatore):
1. Aggiorna la versione in `package.json` (es. `"version": "0.2.0"`).
2. Compila il pacchetto macOS con:
   ```bash
   npm run package:mac
   ```
3. Vai sul tuo repository GitHub, entra nella sezione **Releases** e crea una nuova release:
   - Tag: `v0.2.0`
   - Titolo: `BudgetingMacApp v0.2.0`
   - Trascina il file generato `dist-electron/BudgetingMacApp-0.2.0.dmg` tra gli asset della release.
   - Pubblica la release.
4. All'apertura successiva, tutte le installazioni dell'app rileveranno automaticamente la nuova versione e proporranno l'aggiornamento con richiesta di consenso!

---

## Riconoscimento scontrini 🧾

L'app riconosce automaticamente i dati di uno scontrino: **esercente, data,
totale, imponibile, IVA, metodo di pagamento** e le righe di dettaglio.

| Piattaforma | Come si usa | Motore OCR |
|-------------|-------------|------------|
| **iOS** | pulsante **Scansiona scontrino** → fotocamera (scanner integrato) o libreria foto | Apple Vision, on-device |
| **macOS** | pulsante **Scansiona scontrino** → scegli la foto dello scontrino | Apple Vision, on-device |
| **Browser** | pulsante → incolla il testo dello scontrino | — (nessun OCR nel browser) |

Nessun dato lascia il dispositivo: la riconoscimento del testo avviene
localmente con il framework **Vision** di Apple (gratuito, senza rete).

### Come funziona

```
foto scontrino ──▶ OCR nativo (Vision) ──▶ testo
                                          │
              ┌───────────────────────────┘
              ▼
   receiptParser.ts ──▶ esercente · data · totale · categoria · righe
              │
              ▼
   anteprima modificabile ──▶ conferma ──▶ transazione
```

Il **parsing** vive in `src/renderer/utils/receiptParser.ts` (TypeScript puro,
nessuna dipendenza): e' lo stesso su tutte le piattaforme ed e' testabile
senza OCR.

```bash
npm run test:receipt     # 7 scontrini reali + integrazione con l'OCR
```

Le euristiche coprono: importi europei (`1.250,50`) e anglosassoni
(`1,250.50`), totali etichettati (`TOTALE`, `DA PAGARE`, `IMPORTA`), imponibile
+ IVA, date in formato italiano/anglosassone, testuale (`12 OTT 2026`) e ISO,
ricostruzione delle colonne quando l'OCR legge descrizioni e prezzi separati,
e deduplicazione della categoria di budget.

### Il motore OCR su macOS

`electron/bin/receipt-ocr` e' un binario Swift che usa Vision:

```bash
npm run build:ocr        # compila il binario (swiftc -O)
```

Se il binario manca, l'app lo compila al volo la prima volta (richiede gli
Xcode Command Line Tools). Su iOS l'OCR e' integrato nel progetto Xcode e non
richiede nessun passo aggiuntivo.

---

## Importazione Dati Intelligente e Multiformato 📥

L'applicazione include un motore universale avanzato per l'importazione di transazioni, estratti conto e asset:

### Formati Supportati
- 🍎 **Apple Numbers (`.numbers`)**: Supporto diretto per file creati con Apple Numbers su macOS o iOS. Il motore estrae e analizza le tabelle dei movimenti e le anteprime QuickLook integrate senza richiedere conversioni manuali.
- 📄 **Estratti Conto PDF (`.pdf`)**: Lettura e ricostruzione visiva delle righe degli estratti conto PDF emessi da istituti bancari (Intesa Sanpaolo, UniCredit, Fineco, Raiffeisen, Nexi, Revolut, BancoPosta, BBVA, Banco BPM, BPER, Amex, ING, ecc.). Riconosce data, causale e importo in dare/avere.
- 📊 **Fogli di Calcolo Excel (`.xlsx`, `.xls`, `.xlsm`)**: Riconoscimento completo sia di fogli transazioni che di fogli asset/portafoglio.
- 📝 **File di Testo e CSV (`.csv`, `.tsv`, `.txt`)**: Rilevamento automatico del delimitatore (virgola, punto e virgola, tabulatore, pipe).

### Riconoscimento Flessibile e Tollerante (Fuzzy Recognition)
Non è necessario che il file segua un modello predefinito rigido:
1. **Riconoscimento automatico delle intestazioni**: Rileva le colonne essenziali (Data, Importo, Spesa, Entrata, Dare, Avere, Descrizione, Beneficiario, Categoria, Conto) in italiano, inglese o varianti gergali, indipendentemente dalla loro posizione o denominazione esatta.
2. **Supporto per file senza intestazione**: Se il file non presenta intestazioni, il motore deduce il significato delle colonne analizzando i tipi di dato (date, importi numerici, descrizioni alfanumeriche).
3. **Normalizzazione intelligente di date e importi**:
   - Formati data: `GG/MM/AAAA`, `AAAA-MM-GG`, date con nomi dei mesi per esteso o abbreviati (`15-Ott-2026`), numeri seriali Excel.
   - Formati importi: separatori europei (`1.250,50 €`) o anglosassoni (`$1,250.50`), numeri con segno esplicito, convenzioni contabili Dare/Avere (D/C).
4. **Categorizzazione e deduzione del tipo**: Assegna automaticamente la categoria e il tipo (entrata o spesa) analizzando la causale (es. stipendi, bonifici, bollette, supermercato, ecc.).
5. **Anteprima interattiva prima dell'importazione**: Prima di salvare i dati, viene mostrata una schermata con il riepilogo delle righe rilevate, il conto di destinazione selezionabile e la possibilità di filtrare o confermare solo ciò che si desidera.
