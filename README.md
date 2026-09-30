# Registro budget

Spazio di lavoro desktop per macOS, Windows e Linux costruito con Electron, React, Vite e TypeScript.

## Cosa include

- Shell moderna e adatta a macOS per i flussi di budgeting
- Dashboard dettagliata per flusso di cassa, budget, transazioni e patrimonio netto
- Processo principale Electron con bridge di preload sicuro
- Renderer React basato su Vite
- Persistenza automatica su file system per non perdere i dati durante gli aggiornamenti dell'app

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
