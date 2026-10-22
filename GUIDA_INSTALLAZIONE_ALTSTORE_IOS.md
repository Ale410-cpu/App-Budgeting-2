# Installazione dell'app iOS su iPhone e iPad (sideloading) 📲

Questa guida spiega come compilare e installare **Budget App** su iPhone e iPad
**senza passare dall'App Store**, usando un normale account ID Apple gratuito
con **AltStore** (o **Sideloadly**, che funziona con lo stesso file).

---

## 1. Come funziona la versione iOS 🧩

La versione iOS e' un'app nativa che contiene la stessa web app React che gira
su macOS:

```
ios/
├── BudgetApp.xcodeproj        progetto Xcode
└── BudgetApp/
    ├── AppDelegate.swift       avvio e WebView
    ├── Bridge/
    │   ├── AppSchemeHandler.swift   serve il bundle web (budgetapp://app.local)
    │   └── BudgetBridge.swift        ponte nativo (window.budgetApp)
    └── Resources/
        ├── Info.plist
        ├── Assets.xcassets      icona dell'app
        └── web/                 bundle Vite generato dalla build
```

Punti chiave:

- **Lo schema `budgetapp://app.local`** al posto di `file://`: con lo schema
  custom la WebView ha un'origine reale e persistente, quindi `localStorage`,
  `IndexedDB`, i moduli ES e i web worker (pdf.js) funzionano esattamente come
  su un browser. Con `file://` la schermata resterebbe nera.
- **Il ponte nativo (`window.budgetApp`)** espone la stessa API del preload di
  Electron: salvataggio dei dati, notifiche di sistema, prezzi dei titoli,
  controllo aggiornamenti, apertura di link esterni e picker dei file.
- **I dati vivono in** `Budget App/user-data.json`, dentro la cartella
  dell'app. La cartella e' visibile nell'app **File** (grazie a
  `UIFileSharingEnabled`) e si puo' copiare su iCloud Drive.

---

## 2. Requisiti 🛠️

| Cosa | Perche' serve |
|------|---------------|
| **Mac con macOS 13+** | la compilazione iOS si fa solo su macOS |
| **Xcode 15 o superiore** | contiene l'iOS SDK (le Command Line Tools non bastano) |
| **iPhone / iPad con iOS 15+** | requisito minimo dell'app |
| **Account ID Apple gratuito** | firma il pacchetto per 7 giorni |
| **AltStore** (o Sideloadly) | installa l'IPA firmato sul telefono |

Verifica che Xcode sia installato e selezionato:

```bash
xcode-select -p
# deve puntare a: /Applications/Xcode.app/Contents/Developer
```

Se punta alle Command Line Tools:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

> Xcode si scarica dall'App Store (o da [developer.apple.com/download](https://developer.apple.com/download/))
> e occupa circa 15-40 GB di spazio.

---

## 3. Generare il pacchetto `.ipa` 📦

```bash
npm install
npm run package:ios
```

Il comando:

1. compila il renderer React/Vite (`dist/`);
2. copia il bundle dentro `ios/BudgetApp/Resources/web/`;
3. compila il progetto Xcode in modalita' Release;
4. impacchetta il risultato in `dist-ios/BudgetApp-<versione>.ipa`.

Il file prodotto **non e' firmato**: e' esattamente il formato che si installa
con AltStore o Sideloadly (sono loro a firmarlo con il tuo ID Apple).

Se preferisci un IPA **gia' firmato** (installabile anche senza AltStore,
valido 7 giorni):

```bash
npm run package:ios:signed -- <TEAM_ID>
```

Il `TEAM_ID` si trova in Xcode > Settings > Accounts (o in
`~/Library/MobileDevice/Provisioning Profiles`). In quel caso la firma usa il
tuo certificato e l'app si installa con AirDrop + "Installa" (iOS 16+).

### 3.1 Se invece vuoi che siano gli utenti a firmare l'app 🔏

```bash
npm run package:ios:source
# → dist-ios/BudgetApp-<versione>-xcode.zip
```

E' il **progetto Xcode** pronto all'uso (con il bundle web gia' compilato
dentro): ognuno lo apre sul proprio Mac, sceglie il proprio Team e preme
*Run* sul proprio telefono. **Non richiede Xcode sul computer che distribuisce**
e non richiede Node.js a chi lo riceve.

Vedi la sezione 5 per i dettagli.

---

## 4. Installare l'app sul telefono 📲

> **Serve AltStore? No.** AltStore e' solo uno dei tre modi possibili.
> iOS non permette di installare un `.ipa` con un doppio tap: l'app deve
> essere **firmata** con un certificato di sviluppo e installata da uno
> strumento autorizzato. Scegli quello che ti comoda:
>
> | Strumento | Cosa serve | Note |
> |-----------|-----------|------|
> | **Sideloadly** 🏆 | solo il computer | Il **piu' semplice**: un programma, nessun servizio in background, installa anche via Wi-Fi senza cavo. Firma l'IPA con il tuo ID Apple. |
> | **AltStore + AltServer** | computer + telefono | L'app AltStore sul telefono + AltServer sul computer. Richiede AltServer **acceso** (o che il computer sia sulla stessa Wi-Fi) per il rinnovo automatico ogni 7 giorni. |
> | **Xcode diretto** | Mac + cavo | Salti l'IPA: apri il progetto, premi *Run* sul tuo device. La firma dura 7 giorni, poi va rifatta. |
>
> In tutti e tre i casi l'app scade dopo **7 giorni** (limite delle firme
> gratuite): va rinnovata o reinstallata. Con un account Apple Developer
> a pagamento (99$/anno) la firma dura 1 anno e puoi usare TestFlight.

### 4.1 Configurare AltServer (una sola volta, solo se scegli AltStore)

**Su Mac:**

1. Scarica AltServer da [altstore.io](https://altstore.io) e mettilo in
   Applicazioni.
2. Avvialo: appare l'icona a rombo nella barra dei menu.
3. Clicca sull'icona > **Install Mail Plug-in** (serve per firmare i
   certificati su macOS).
4. Apri **Mail** > Impostazioni > Generali > Gestisci plug-in, spunta
   `AltPlugin.mailbundle`, clicca **Applica e riavvia Mail**.

**Su Windows:** installa iTunes e iCloud dalla versione **ufficiale** di Apple
(non quella del Microsoft Store), poi installa AltServer.

### 4.2 Installare AltStore sul telefono (solo se scegli AltStore)

1. Collega l'iPhone al computer con il cavo USB.
2. Se richiesto, tocca **"Autorizza questo computer"** e inserisci il codice.
3. Nella barra dei menu clicca sull'icona di AltServer > **Install AltStore** >
   scegli il tuo iPhone.
4. Inserisci il tuo ID Apple e la password (vengono inviati **solo ai server
   Apple** per generare il certificato di test).
5. Entro 30 secondi l'icona di AltStore compare sulla Home del telefono.

### 4.3 Abilitare il profilo sviluppatore su iOS 🛡️

1. **Impostazioni** > **Generali** > **VPN e gestione dispositivo**.
2. In *App sviluppatore* tocca il tuo indirizzo email.
3. Tocca **"Autorizza [tua-email]"** e conferma.
4. **Impostazioni** > **Privacy e sicurezza** > **Modalita' sviluppatore**:
   attiva l'interruttore e riavvia il telefono quando richiesto.

### 4.4 Installare Budget App

**Metodo A — Sideloadly dal computer (consigliato: meno passaggi)**

1. Scarica Sideloadly da [sideloadly.io](https://sideloadly.io) (Windows o macOS).
2. Inserisci il file `dist-ios/BudgetApp-<versione>.ipa`, il tuo ID Apple e
   l'ID del dispositivo (lo trovi in Sideloadly, che lo rileva da solo via
   cavo; oppure in *Impostazioni > Generali > Info* sul telefono).
3. Clicca **Start**: l'app viene firmata e installata. Non serve tenere
   AltServer acceso ne' restare sulla stessa rete Wi-Fi.

**Metodo B — AltStore, dal telefono**

1. Invia `dist-ios/BudgetApp-<versione>.ipa` all'iPhone con AirDrop, oppure
   salvalo su iCloud Drive / Google Drive.
2. Apri l'app **File**, trova l'IPA, tieni premuto > **Condividi** > **AltStore**.
3. AltStore firma e installa l'app: l'icona **Budget App** appare sulla Home.

**Metodo C — AltStore, dall'app**

1. Apri AltStore > **My Apps**.
2. Tocca **"+"** in alto a sinistra e seleziona l'IPA.
3. Attendi il completamento della barra di caricamento.

**Metodo D — direttamente da Xcode (nessun IPA)**

1. `npm run ios:sync`
2. `open ios/BudgetApp.xcodeproj`, seleziona il tuo iPhone come destinazione.
3. In *Signing & Capabilities* scegli il tuo team e premi **Run**.

> In ogni caso la prima apertura mostra l'avviso di protezione: autorizza il
> certificato in *Impostazioni > Generali > VPN e gestione dispositivo* e
> attiva la *Modalita' sviluppatore* (vedi 4.3).

---

## 5. Firmare l'app in proprio con Xcode (il modello "ogni utente firma") 🔏

Questo e' il modello consigliato se vuoi distribuire l'app a utenti **non
tecnici**, senza account Developer a pagamento:

> **Tu distribuisci il progetto, l'utente finale firma l'app con il suo ID
> Apple e la installa sul proprio telefono.**

Per questo serve distribuire il **progetto Xcode** (non l'IPA: un `.ipa` non
e' ri-firmabile da Xcode, serve il sorgente).

### 5.1 Generare il pacchetto da distribuire

```bash
npm run package:ios:source
# → dist-ios/BudgetApp-<versione>-xcode.zip
```

Il `.zip` contiene:

```
BudgetApp-iOS-<versione>/
├── LEGGIMI.txt          istruzioni per l'utente finale
└── ios/                 progetto Xcode (Swift, nessuna dipendenza esterna)
    └── BudgetApp/Resources/web/   bundle web gia' compilato
```

**L'utente finale non ha bisogno di Node.js, npm o Vite**: il bundle web e'
gia' dentro. (Se invece distribuisci il repository Git, l'utente deve prima
eseguire `npm install && npm run ios:sync`.)

> Non serve Xcode nemmeno sul computer che distribuisce il pacchetto:
> `npm run package:ios:source` funziona senza iOS SDK.

### 5.2 Cosa fa l'utente finale

1. **Scarica e decomprime** il `.zip`.
2. **Apre** `ios/BudgetApp.xcodeproj` con Xcode 15 o superiore.
3. Seleziona il target **BudgetApp** > scheda **Signing & Capabilities**:
   - spunta **"Automatically manage signing"**;
   - scegli il proprio **Team** (il "Personal Team" gratuito va benissimo);
   - se Xcode segnala un conflitto sul Bundle Identifier, cambialo in qualcosa
     di unico, ad esempio `com.<tuouso>.budgetapp`.
4. **Collega l'iPhone** al Mac (o usa il debug wireless, vedi 6.1), selezionalo
   come destinazione e preme **Run**.
5. Sul telefono: **Impostazioni > Generali > VPN e gestione dispositivo >
   autorizza il certificato** del proprio ID Apple, poi attiva la
   **Modalita' sviluppatore** (Impostazioni > Privacy e sicurezza).

Da questo momento l'app e' sul telefono e si comporta come una normale app
installata: icona sulla Home, notifiche, dati persistenti.

---

## 6. Rinnovo ogni 7 giorni: cosa fare esattamente 🔄

La firma gratuita di Apple dura **7 giorni**. Poi l'app smette di avviarsi
(al tap si rifiuta di aprire). La rinnovi **riffirmandola**, e questo
**richiede sempre un computer**: iOS, da solo, non sa firmare nulla.

| Come l'hai installata | Cosa fare dopo 7 giorni | Serve il cavo? |
|-----------------------|--------------------------|----------------|
| **Xcode** (Run sul device) | Ricollega (o usa il wireless) e premi **Run** di nuovo | **No, se abiliti il debug wireless** |
| **Sideloadly** | Rilancia Sideloadly con lo stesso IPA | No (funziona via Wi-Fi) |
| **AltStore + AltServer** | Niente: il rinnovo parte in automatico | No (basta AltServer acceso sulla stessa Wi-Fi) |
| **IPA firmato da `package:ios:signed`** | Reinstalla il pacchetto firmato | No |

### 6.1 Rifirmare con Xcode senza cavo 🔌

Basta abilitare il **debug wireless** (iOS 11.4+):

1. Una volta sola, collega l'iPhone con il cavo.
2. Apri **Xcode > Settings > Platforms > iOS** (o *Window > Devices and
   Simulators*), seleziona il telefono e spunta **"Connect via network"**.
3. Da quel momento puoi staccare il cavo: Xcode continua a parlare col
   telefono via Wi-Fi.

Alla scadenza dei 7 giorni: apri Xcode, seleziona il telefono, premi **Run**.
Xcode rifirma, reinstalla e l'app riparte — **i dati restano intatti**.

### 6.2 Attenzione ai dati durante la rifirma ⚠️

Reinstallare l'app da Xcode **conserva** i dati (stesso Bundle Identifier).
Perderesti tutto solo se:

- **cambi il Bundle Identifier** (iOS la tratta come un'app diversa);
- **cancelli l'app** dalla Home prima di reinstallarla;
- **cambi l'ID Apple** con cui firmi.

Prima di qualsiasi operazione di questo tipo, fai un backup:
*Impostazioni > Archiviazione > Esporta copia user-data.json* e salvalo su
iCloud Drive. Lo stesso file si reimporta su un altro telefono o sul Mac.

### 6.3 Come evitare la scadenza del tutto

Serve un **account Apple Developer a pagamento (99$/anno)**: la firma vale
allora **1 anno** e puoi distribuire tramite **TestFlight** (build senza
l'installazione manuale, aggiornamenti invisibili all'utente). Il codice
dell'app non cambia: cambia solo il team con cui firmi.

---

## 7. I tuoi dati su iOS 💾

| Dove | Come si arriva |
|------|----------------|
| `Budget App/user-data.json` | salvataggio automatico a ogni modifica (copia locale) |
| App **File** > "sul mio iPhone" > Budget App | accesso diretto alla copia locale |
| **iCloud Drive** | collegando una cartella (vedi sotto) |
| Export JSON / Excel | pulsanti di export: su iOS si apre il picker di sistema |

### Collegare iCloud Drive (sincronizzazione con il Mac) ☁️

L'app può tenere il file `user-data.json` **dentro iCloud Drive**, lo
stesso che usa il Mac: in questo modo i due dispositivi mostrano **gli stessi
dati, sempre aggiornati**.

#### Setup (una volta sola)

1. **Sul Mac**: *Impostazioni → Archiviazione & Sincronizzazione File Dati* →
   **"🔗 Collega file esistente (iCloud Drive)"** → nella finestra di dialogo
   premi **⌘⇧G** e digita:

   ```
   ~/Library/Mobile Documents/com~apple~CloudDocs/user-data.json
   ```

   (oppure crea la cartella `BudgetingMacApp` dentro iCloud Drive e salvali
   lì il file)

2. **Su iPhone**: *Impostazioni → Archiviazione & Sincronizzazione File Dati* →
   **"🔗 Collega file esistente (iCloud Drive)"** → nell'app File scegli
   **iCloud Drive → lo stesso `user-data.json`**

3. Fatto: da ora in poi Mac e iPhone leggono e scrivono **lo stesso file**.

#### Cosa succede in pratica

| Direzione | Comportamento | Tempi |
|-----------|---------------|-------|
| **iPhone → Mac** | ogni modifica viene scritta su iCloud Drive; il Mac la rileva e ricarica | pochi secondi |
| **Mac → iPhone** | l'app rileva il file cambiato e **ricarica i dati** | ~10-15 secondi |
| **Apertura dell'app** | all'avvio controlla comunque il file e si allinea | immediato |

Dettagli tecnici che rendono la sincronizzazione affidabile:

- le scritture su iCloud Drive sono **distanziate** (max una ogni 8 secondi) e
  scattano comunque quando l'app va in background: il file non resta mai
  "sporco" e iCloud può consegnare le modifiche dell'altra piattaforma;
- il file viene letto e scritto con un **`NSFileCoordinator`**, il modo
  previsto da iOS per i documenti esterni (evita conflitti con il daemon di
  iCloud);
- prima di scrivere, l'app **controlla se il file è cambiato dall'esterno**: in
  quel caso non lo sovrascrive, ma ricarica i dati;
- se preferisci non aspettare, il pulsante **"🔄 Ricarica da iCloud"** rilegge
  il file su richiesta.

> ⚠️ **Attenzione**: è un file condiviso, non un database. Se modifichi i dati
> **contemporaneamente** su Mac e iPhone, l'ultima modifica vince. Il formato
> consigliato è: usa un dispositivo alla volta, l'altro si aggiorna da solo.

Con un account Apple **gratuito** l'app non può creare cartelle dentro
iCloud Drive autonomamente: il file va scelto una volta dall'utente (come
sopra). Con un account Developer a pagamento si può usare il container iCloud
dell'app.

La persistenza è doppia: `localStorage` + `IndexedDB` nella WebView (veloce,
sincrono) e il file `user-data.json` sul disco (dati permanenti anche dopo un
riavvio dell'app).

**Backup consigliato**: una volta a settimana usa *Esporta JSON* e salva il
file su iCloud Drive. Lo stesso file si può reimportare su macOS (e viceversa)
con *Importa dati*.

---

## 8. Riconoscimento scontrini 🧾

Su iPhone e iPad puoi **scansionare uno scontrino con la fotocamera** e
inserire la spesa automaticamente:

1. Apri la sezione **Transazioni**.
2. Tocca **Scansiona scontrino**.
3. Inquadra lo scontrino con lo scanner integrato di iOS (oppure scegli una
   foto gia' scansionata dalla libreria).
4. L'app legge il testo con il framework Vision (sul dispositivo, senza rete)
   e ti propone **esercente, data, importo, categoria** e le righe di
   dettaglio.
5. Controlla, correggi se serve e tocca **Aggiungi transazione**.

iOS chiede il permesso della fotocamera e della libreria foto alla prima
scansione: tocca **Consenti** (le autorizzazioni si gestiscono in
*Impostazioni > Budget App*).

---

## 9. Notifiche di sistema 🔔
Le notifiche su iOS usano `UNUserNotificationCenter` (Centro Notifiche del
telemono), non banner interni:

- alla prima notifica iOS chiede il permesso: tocca **"Consenti"**;
- se il permesso viene negato, i permessi si riattivano in
  *Impostazioni > Budget App > Notifiche*.

---

## 10. Sviluppo e debug 🛠️

### Da Xcode (consigliato)

```bash
npm run ios:sync     # copia il bundle web dentro il progetto
open ios/BudgetApp.xcodeproj
```

- seleziona un simulatore (iPhone 15) e premi **Run**;
- per il debug sul telefono: apri il progetto, seleziona il tuo device, e in
  *Signing & Capabilities* scegli il tuo team (Xcode crea il profilo
  automaticamente);
- con `Safari > Develop > [telefono] > Budget App` apri il Web Inspector.

Ogni volta che modifichi il renderer ricorda di eseguire `npm run ios:sync`.

### Solo il bundle web (iterazione veloce)

```bash
npm run dev          # server Vite su http://localhost:3000
```

Su iPhone puoi aprire `http://<ip-del-mac>:3000` dal browser: utile per
verificare il layout, ma **non** per testare il bridge nativo.

---

## 11. Problemi frequenti 🩺

| Sintomo | Causa | Soluzione |
|---------|-------|-----------|
| Schermata nera all'avvio | bundle web non copiato nel progetto | `npm run ios:sync` e ricompila |
| `Non riesco a trovare l'app` | Xcode non installato / selezionato | vedi sezione 2 |
| Errore di firma in AltStore | certificato scaduto | *Refresh All* in AltStore |
| "App non verificata" al primo avvio | profilo sviluppatore non autorizzato | sezione 4.3 |
| I dati non sono sincronizzati | export non fatto | *Esporta JSON* su iCloud Drive |
| Notifiche non arrivano | permesso negato | Impostazioni > Budget App > Notifiche |

---

## 12. Note tecniche 🧪

- **Bundle id**: `com.budgeting.macapp` (lo stesso del desktop: sono piattaforme
  diverse, non si confliggono).
- **Deployment target**: iOS 15.0 (Xcode 27 rifiuta target inferiori).
- **Link esterni** (GitHub, documentazione) si aprono nel browser di sistema.
- **Aggiornamenti**: l'app controlla le release di GitHub come su macOS; su iOS
  non puo' installare aggiornamenti da sola (iOS lo vieta): il pulsante apre il
  pacchetto `.ipa` nel browser, e lo reinstalli con AltStore.
- **Nessuna dipendenza esterna**: il progetto Xcode non usa CocoaPods ne' SPM,
  quindi la build e' veloce e non richiede rete oltre a quella del renderer.

### Note tecniche sul bundle web (iOS 26+)

Tre dettagli non ovvi, emersi testando l'app su un iPhone con **iOS 26.5**:

1. **La risposta del `WKURLSchemeHandler` deve avere l'URL della *richiesta*
   (`budgetapp://localhost/...`), non il percorso del file nel bundle.**
   Passando il path locale, WebKit scarta la navigazione e la WebView resta
   bianca.

2. **Il bundle web viene compilato come HTML "single-file"**: lo script e il
   CSS sono inlineati nell'HTML (`vite.config.ios.ts` + `scripts/build-ipa.cjs`).
   Con un `<script src=...>` esterno, WebKit su iOS 26+ fa terminare il
   processo WebContent ([bug 296698](https://bugs.webkit.org/show_bug.cgi?id=296698)).
   Inoltre lo script inline va in fondo al `<body>`: nell'<head>' girerebbe
   prima che esista il `<div id="root">` (React error #299).

3. **Il CSP va adattato**: la WebView serve l'app da uno schema custom, quindi
   `'self'` non basta e servono anche `budgetapp:` nelle direttive.

> Nota: in fase di sviluppu la WebView non mostra la console JavaScript.
> Per questo nel progetto c'è un `WKUserScript` che inoltra `console.*` e gli
> errori al log del dispositivo: basta guardare l'output di `devicectl ... --console`.
