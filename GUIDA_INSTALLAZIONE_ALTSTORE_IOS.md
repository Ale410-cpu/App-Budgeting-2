# Guida all'Installazione dell'App iOS su iPhone tramite AltStore 📲

Questa guida spiega come installare ed utilizzare **Budget App** sul tuo iPhone o iPad utilizzando **AltStore** (o strumenti analoghi come **Sideloadly**), senza la necessità di un account Apple Developer a pagamento e senza passare per l'App Store pubblico.

---

## 1. Dov'è il file dell'applicazione iOS? 📦

L'applicazione per iOS viene generata come pacchetto **IPA** pronto all'uso:
* Percorso file: `dist-ios/BudgetApp-0.3.0.ipa`

### Come rigenerare il pacchetto in qualsiasi momento:
Se apporti modifiche al codice o alle funzionalità, puoi ricompilare il pacchetto iOS con un singolo comando da terminale:
```bash
npm run package:ios
```
Questo comando compila l'interfaccia React/Vite, sincronizza i container nativi di Capacitor e impacchetta il file `.ipa` aggiornato in `dist-ios/`.

---

## 2. Requisiti iniziali 🛠️

1. **Un computer** (Mac con macOS 10.15+ o PC con Windows 10/11).
2. **Un iPhone o iPad** con iOS 14 o superiore.
3. **Un normale account ID Apple personale** (gratuito).
4. **AltServer** installato sul computer ([altstore.io](https://altstore.io)).

---

## 3. Configurazione di AltServer (Una sola volta) ⚙️

### Su Mac:
1. Scarica **AltServer** da [altstore.io](https://altstore.io) e trascinalo nella cartella **Applicazioni**.
2. Avvia AltServer (apparirà un'icona a forma di rombo nella barra dei menu in alto).
3. Clicca sull'icona di AltServer > **Install Mail Plug-in** (richiesto per abilitare la firma dei certificati su Mac).
4. Apri l'app **Mail** del Mac, vai in **Impostazioni > Generali > Gestisci plug-in**, spunta **AltPlugin.mailbundle** e clicca **Applica e riavvia Mail**.

### Su Windows:
1. Installa la versione ufficiale di **iTunes** e **iCloud** scaricata direttamente dal sito Apple (NON le versioni del Microsoft Store).
2. Scarica e avvia **AltServer**.

---

## 4. Installazione di AltStore sul tuo iPhone 📱

1. Collega l'iPhone al computer tramite cavo USB.
2. Se richiesto sullo schermo del telefono, tocca **"Autorizza questo computer"** e inserisci il codice di sblocco.
3. Sul Mac/PC, clicca sull'icona di AltServer nella barra delle applicazioni.
4. Seleziona **Install AltStore** > Scegli il tuo iPhone.
5. Inserisci il tuo **ID Apple** e la relativa password (questi dati vengono inviati esclusivamente ai server Apple per generare il certificato di test per il tuo dispositivo).
6. Dopo circa 30 secondi, l'icona di **AltStore** apparirà sulla schermata Home del tuo iPhone.

---

## 5. Abilitare il Profilo Sviluppatore su iOS 🛡️

Quando tocchi l'icona di AltStore o dell'app installata per la prima volta, iOS mostrerà un messaggio di protezione. Segui questi due rapidi passaggi per autorizzarla:

### A. Autorizzare il certificato personale:
1. Apri **Impostazioni** sull'iPhone.
2. Vai su **Generali** > **VPN e gestione dispositivo**.
3. Sotto la voce *App sviluppatore*, tocca il tuo indirizzo email / ID Apple.
4. Tocca **"Autorizza [tua-email]"** e conferma.

### B. Abilitare la Modalità Sviluppatore (Solo per iOS 16, 17 e successivi):
1. Apri **Impostazioni** > **Privacy e sicurezza**.
2. Scorri fino in fondo e tocca **Modalità sviluppatore**.
3. Attiva l'interruttore e riavvia il telefono quando richiesto.
4. Al riavvio, tocca **Attiva** e inserisci il codice di sblocco.

---

## 6. Installare Budget App (.ipa) su iPhone 🚀

Esistono due metodi altrettanto semplici:

### Metodo A: Tramite AirDrop o app File (Consigliato)
1. Invia il file `dist-ios/BudgetApp-0.3.0.ipa` dal tuo Mac al tuo iPhone tramite **AirDrop**, oppure salvalo su **iCloud Drive / Google Drive**.
2. Sull'iPhone, apri l'app **File** e individua `BudgetApp-0.3.0.ipa`.
3. Tieni premuto sul file (o tocca l'icona di condivisione) e seleziona **"Condividi"** > Tocca **AltStore**.
4. AltStore si aprirà e installerà automaticamente l'applicazione sulla tua Home.

### Metodo B: Dall'app AltStore
1. Apri **AltStore** sull'iPhone.
2. Vai nella scheda **My Apps** in basso.
3. Tocca l'icona **"+"** in alto a sinistra.
4. Seleziona il file `BudgetApp-0.3.0.ipa`.
5. Attendi il completamento della barra di caricamento: l'icona di **Budget App** apparirà subito sulla tua schermata Home!

---

## 7. Rinnovo automatico dei 7 giorni 🔄

Gli account ID Apple personali gratuiti hanno una validità di 7 giorni per le app installate fuori dall'App Store:
* **Con AltStore non devi rifare la procedura ogni settimana**: fintanto che il tuo iPhone si trova connesso alla stessa rete Wi-Fi del tuo computer (con AltServer acceso), AltStore rinnoverà automaticamente il certificato in background senza che tu debba fare nulla.
* Puoi anche forzare il rinnovo quando vuoi aprendo AltStore > *My Apps* > premendo **"Refresh All"**.

---

## 8. Sincronizzazione Dati con Desktop ☁️

Tutte le tue transazioni, i conti e i budget possono essere sincronizzati in totale sicurezza tra iPhone e computer:
- Puoi esportare ed importare i file Excel, Numbers, PDF o JSON direttamente tramite l'app File di iOS o Google Drive.
- L'app supporta la condivisione file nativa di iOS (`UIFileSharingEnabled`) per trasferire i dati in tempo reale via cavo o cloud.
