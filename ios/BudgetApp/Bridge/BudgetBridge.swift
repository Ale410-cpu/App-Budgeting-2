import Foundation
import PhotosUI
import UIKit
import UniformTypeIdentifiers
import UserNotifications
import Vision
import VisionKit
import WebKit

/// Bridge nativo per la web app.
///
/// Espone `window.budgetApp` al renderer con la stessa interfaccia del preload
/// di Electron (`src/renderer/global.d.ts`), cosi' l'interfaccia utente non
/// cambia tra macOS e iOS.
///
/// Ogni metodo nativo e' invocato dal JavaScript tramite
/// `window.webkit.messageHandlers.budgetApp.postMessage(...)` e la risposta
/// torna come Promise JavaScript.
final class BudgetBridge: NSObject, WKScriptMessageHandler, UIDocumentPickerDelegate, VNDocumentCameraViewControllerDelegate, PHPickerViewControllerDelegate {

    weak var webView: WKWebView?

    /// Contesto del picker di documenti attualmente aperto.
    private var pickerContext: (kind: PickerKind, replyId: String, fileName: String?)?

    /// Id della richiesta di scansione scontrino in corso.
    private var pendingScanReplyId: String?

    /// Dati da scrivere nel file principale scelto dall'utente.
    private var pendingPrimaryData: Data?

    /// Ultima impronta "significativa" scritta (senza i timestamp volatili).
    private var lastSemanticHash: String = ""

    /// File "principale" dell'utente (puo' stare su iCloud Drive).
    private let primaryStore = PrimaryFileStore()

    override init() {
        super.init()
        // Recupera il file principale collegato in una sessione precedente.
        primaryStore.restore()
    }

    /// Da chiamare quando la WebView e' pronta: avvia la sorveglianza del
    /// file principale (iCloud Drive).
    func activate() {
        startPrimaryWatching()
    }

    private enum PickerKind {
        case importData
        case exportData
        case linkPrimaryFile
        case browseFolder
    }

    // MARK: - Bootstrap JavaScript

    /// Script iniettato in `documentStart`: definisce `window.budgetApp`.
    static let bootstrapJS = #"""
    (function () {
      if (window.__budgetAppBootstrapped) return;
      window.__budgetAppBootstrapped = true;

      var pending = Object.create(null);
      var seq = 0;
      var listeners = { updateProgress: [], dataUpdatedOnDisk: [] };

      function call(method, args) {
        return new Promise(function (resolve, reject) {
          var id = 'c' + (++seq);
          pending[id] = { resolve: resolve, reject: reject };
          try {
            window.webkit.messageHandlers.budgetApp.postMessage({
              id: id,
              method: method,
              args: args === undefined ? null : args
            });
          } catch (err) {
            delete pending[id];
            reject(err);
          }
        });
      }

      window.__budgetAppResolve = function (id, result) {
        var entry = pending[id];
        if (!entry) return;
        delete pending[id];
        entry.resolve(result);
      };

      window.__budgetAppReject = function (id, message) {
        var entry = pending[id];
        if (!entry) return;
        delete pending[id];
        entry.reject(new Error(message || 'Errore nativo'));
      };

      window.__budgetAppEmit = function (event, payload) {
        (listeners[event] || []).slice().forEach(function (callback) {
          try { callback(payload); } catch (err) { console.error(err); }
        });
      };

      function subscribe(event) {
        return function (callback) {
          if (typeof callback !== 'function') return function () {};
          listeners[event].push(callback);
          return function () {
            var index = listeners[event].indexOf(callback);
            if (index >= 0) listeners[event].splice(index, 1);
          };
        };
      }

      window.budgetApp = {
        platform: 'ios',
        ping: function () { return call('ping'); },
        saveData: function (data) { return call('saveData', data); },
        loadData: function () { return call('loadData'); },
        getDataFileInfo: function () { return call('getDataFileInfo'); },
        selectDataFile: function () { return call('selectDataFile'); },
        chooseSaveDataLocation: function (data, startInICloud) {
          return call('chooseSaveDataLocation', { data: data, startInICloud: !!startInICloud });
        },
        useICloudDataLocation: function (data) {
          return call('useICloudDataLocation', { data: data });
        },
        openDataFolder: function () { return call('openDataFolder'); },
        getTickerPrice: function (ticker) { return call('getTickerPrice', ticker); },
        checkForUpdates: function (repo, token) {
          return call('checkForUpdates', { repo: repo, token: token });
        },
        downloadAndInstallUpdate: function (options) { return call('downloadAndInstallUpdate', options || {}); },
        sendNotification: function (payload) { return call('sendNotification', payload || {}); },
        getNotificationCapability: function () { return call('getNotificationCapability'); },
        openExternal: function (url) { return call('openExternal', url); },
        saveFile: function (payload) { return call('saveFile', payload || {}); },
        scanReceipt: function () { return call('scanReceipt'); },
        unlinkPrimaryFile: function () { return call('unlinkPrimaryFile'); },
        linkPrimaryFile: function () { return call('linkPrimaryFile'); },
        reloadPrimaryFile: function () { return call('reloadPrimaryFile'); },
        debugEval: function (code) {
          window.webkit.messageHandlers.budgetApp.postMessage({
            id: 'debug-' + Date.now(), method: 'debugEval', args: { code: code }
          });
          return true;
        },
        onUpdateProgress: subscribe('updateProgress'),
        onDataUpdatedOnDisk: subscribe('dataUpdatedOnDisk')
      };
    })();
    """#

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let method = body["method"] as? String else {
            return
        }

        let args = body["args"]

        switch method {
        case "ping":
            reply(id, value: [
                "ok": true,
                "version": appVersion(),
                "platform": "ios",
                "dataFilePath": dataFileURL.path,
            ])
        case "saveData":
            saveData(args, replyTo: id)
        case "loadData":
            reply(id, value: loadData())
        case "getDataFileInfo":
            reply(id, value: dataFileInfo())
        case "selectDataFile":
            selectDataFile(replyTo: id)
        case "chooseSaveDataLocation":
            chooseSaveDataLocation(args, replyTo: id)
        case "useICloudDataLocation":
            chooseSaveDataLocation(args, replyTo: id)
        case "openDataFolder":
            openDataFolder(replyTo: id)
        case "getTickerPrice":
            getTickerPrice(args, replyTo: id)
        case "checkForUpdates":
            checkForUpdates(args, replyTo: id)
        case "downloadAndInstallUpdate":
            downloadAndInstallUpdate(args, replyTo: id)
        case "sendNotification":
            sendNotification(args, replyTo: id)
        case "getNotificationCapability":
            getNotificationCapability(replyTo: id)
        case "openExternal":
            openExternal(args, replyTo: id)
        case "saveFile":
            saveFile(args, replyTo: id)
        case "scanReceipt":
            scanReceipt(replyTo: id)
        case "linkPrimaryFile":
            linkPrimaryFile(replyTo: id)
        case "reloadPrimaryFile":
            reloadPrimaryFile(replyTo: id)
        case "unlinkPrimaryFile":
            primaryStore.unlink()
            stopPrimaryWatching()
            reply(id, value: ["success": true])
        case "console":
            if let payload = args as? [String: Any],
               let level = payload["level"] as? String,
               let text = payload["text"] as? String {
                NSLog("[Web %@] %@", level, text)
            }
        case "debugEval":
            // Strumento di diagnostica: esegue un'espressione JS nella WebView
            // e riporta il risultato nel log del dispositivo.
            if let payload = args as? [String: Any],
               let code = payload["code"] as? String {
                DispatchQueue.main.async {
                    self.webView?.evaluateJavaScript(code) { result, error in
                        if let error {
                            NSLog("[Debug] errore: %@", error.localizedDescription)
                        } else {
                            NSLog("[Debug] risultato: %@", String(describing: result ?? "nil"))
                        }
                    }
                }
            }
        default:
            reply(id, error: "Metodo nativo sconosciuto: \(method)")
        }
    }

    // MARK: - Persistenza

    private var documentsURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    private var dataFileURL: URL {
        documentsURL.appendingPathComponent("user-data.json")
    }

    private func appVersion() -> String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    }

    /// Avvia la sorveglianza del file principale: quando cambia (per esempio
    /// perché iCloud Drive lo ha sincronizzato da un altro dispositivo) il
    /// renderer viene avvisato e ricarica i dati.
    private func startPrimaryWatching() {
        primaryStore.onExternalChange = { [weak self] payload in
            guard let self else { return }
            self.emit(event: "dataUpdatedOnDisk", payload: payload)
        }
        primaryStore.startWatching()
    }

    /// Scrive subito sul file principale i dati in attesa (quando l'app va
    /// in background: e' l'ultima occasione per allineare iCloud Drive).
    func flushPrimaryFile() {
        primaryStore.flushPendingWrite()
    }

    /// Controlla subito se il file principale e' cambiato (quando l'app
    /// torna in primo piano).
    func checkPrimaryFileNow() {
        primaryStore.checkNow()
    }

    /// Sospende la sorveglianza (quando la cartella viene scollegata).
    private func stopPrimaryWatching() {
        primaryStore.onExternalChange = nil
        primaryStore.stopWatching()
    }

    /// Invia un evento al renderer (usato per `onDataUpdatedOnDisk`).
    private func emit(event: String, payload: Any) {
        let json = BudgetBridge.jsonString(payload)
        DispatchQueue.main.async {
            self.webView?.evaluateJavaScript("window.__budgetAppEmit('\(event)', \(json));")
        }
    }

    private func saveData(_ args: Any?, replyTo id: String) {
        guard let payload = args, JSONSerialization.isValidJSONObject(payload) else {
            reply(id, error: "Dati non serializzabili")
            return
        }

        do {
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])

            // Se il contenuto non e' cambiato, non riscrivere: evita che il
            // file condiviso su iCloud Drive venga riscritto di continuo (e
            // che l'altra piattaforma interpreti la riscrittura come una
            // modifica esterna).
            let semanticHash = BudgetBridge.semanticHash(of: payload)
            if semanticHash == lastSemanticHash && FileManager.default.fileExists(atPath: dataFileURL.path) {
                reply(id, value: ["success": true, "filePath": dataFileURL.path])
                return
            }
            lastSemanticHash = semanticHash

            // Copia locale (sempre disponibile, anche offline).
            try data.write(to: dataFileURL, options: .atomic)

            // File principale (iCloud Drive o altra cartella scelta).
            if primaryStore.hasPrimaryFile() {
                if primaryStore.hasExternalChanges() {
                    // Il file e' stato modificato dall'esterno (Mac, altro
                    // dispositivo): non lo si sovrascrive, si ricarica.
                    NSLog("[PrimaryFile] il file e' cambiato esternamente: ricarico invece di scrivere")
                    if let parsed = primaryStore.readParsed() {
                        emit(event: "dataUpdatedOnDisk", payload: parsed)
                    }
                } else {
                    _ = primaryStore.write(data)
                }
            }

            reply(id, value: ["success": true, "filePath": dataFileURL.path])
        } catch {
            reply(id, error: error.localizedDescription)
        }
    }

    private func loadData() -> Any {
        // Il file principale ha la precedenza: è quello che l'utente ha
        // scelto di tenere sincronizzato.
        if primaryStore.hasPrimaryFile(), let data = primaryStore.read(),
           let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) {
            return parsed
        }

        guard FileManager.default.fileExists(atPath: dataFileURL.path),
              let data = try? Data(contentsOf: dataFileURL),
              let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else {
            return NSNull()
        }
        return parsed
    }

    private func dataFileInfo() -> [String: Any] {
        let primaryInfo = primaryStore.info()
        if !primaryInfo.isEmpty {
            return primaryInfo
        }

        let manager = FileManager.default
        let exists = manager.fileExists(atPath: dataFileURL.path)

        var size: Int64 = 0
        var modified = Date()
        if let attributes = try? manager.attributesOfItem(atPath: dataFileURL.path) {
            size = (attributes[.size] as? NSNumber)?.int64Value ?? 0
            modified = (attributes[.modificationDate] as? Date) ?? Date()
        }

        return [
            "filePath": dataFileURL.path,
            "fileName": dataFileURL.lastPathComponent,
            "folderPath": documentsURL.path,
            "displayLocation": "Budget App (sul mio iPhone)",
            "isICloud": false,
            "isCustomPrimary": false,
            "iCloudAvailable": true,
            "iCloudDefaultPath": "iCloud Drive",
            "exists": exists,
            "size": size,
            "lastModified": modified.timeIntervalSince1970 * 1000,
            "candidates": [dataFileURL.path],
        ]
    }

    // MARK: - Import / export file

    private func selectDataFile(replyTo id: String) {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.json], asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        pickerContext = (kind: .importData, replyId: id, fileName: nil)
        present(picker)
    }

    /// Rilegge subito il file principale (per esempio dopo che iCloud Drive
    /// ha consegnato la versione aggiornata dal Mac) e restituisce i dati.
    private func reloadPrimaryFile(replyTo id: String) {
        guard let data = primaryStore.read(),
              let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else {
            reply(id, error: "Nessun file principale da rileggere.")
            return
        }

        // Allinea anche la copia locale.
        if let local = try? data.write(to: dataFileURL, options: .atomic) {
            _ = local
        }

        reply(id, value: ["success": true, "data": parsed])
    }

    /// Collega un file user-data.json ESISTENTE (o una cartella) come
    /// posizione principale, senza sovrascriverlo: e' il flusso simmetrico a
    /// quello del Mac e permette a Mac e iPhone di usare lo stesso file su
    /// iCloud Drive.
    private func linkPrimaryFile(replyTo id: String) {
        let picker = UIDocumentPickerViewController(
            forOpeningContentTypes: [.json, .folder],
            asCopy: false
        )
        picker.delegate = self
        picker.allowsMultipleSelection = false

        if let icloudRoot = BudgetBridge.iCloudDriveRoot() {
            picker.directoryURL = icloudRoot
        }

        pendingPrimaryData = nil
        pickerContext = (kind: .linkPrimaryFile, replyId: id, fileName: nil)
        NSLog("[PrimaryFile] aperto il picker per collegare file/cartella")
        present(picker)
    }

    private func chooseSaveDataLocation(_ args: Any?, replyTo id: String) {
        guard let wrapper = args as? [String: Any],
              let payload = wrapper["data"],
              JSONSerialization.isValidJSONObject(payload) else {
            reply(id, error: "Nessun dato da salvare")
            return
        }

        do {
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])

            // Si chiede all'utente di scegliere la CARTELLA in cui tenere
            // il file user-data.json (per esempio una cartella dentro
            // iCloud Drive): aprendola l'app riceve i permessi di scrittura
            // e può aggiornarla automaticamente.
            let picker = UIDocumentPickerViewController(
                forOpeningContentTypes: [.json, .folder],
                asCopy: false
            )
            picker.delegate = self
            picker.allowsMultipleSelection = false

            if let icloudRoot = BudgetBridge.iCloudDriveRoot() {
                picker.directoryURL = icloudRoot
            }

            pendingPrimaryData = data
            pickerContext = (kind: .linkPrimaryFile, replyId: id, fileName: nil)
            NSLog("[PrimaryFile] aperto il picker per scegliere file/cartella")
            present(picker)
        } catch {
            reply(id, error: error.localizedDescription)
        }
    }

    /// Radice di iCloud Drive, se accessibile (con un account Developer
    /// gratuito l'app non ha il container, ma l'utente può comunque
    /// scegliere i file di iCloud Drive dal picker).
    private static func iCloudDriveRoot() -> URL? {
        FileManager.default.url(forUbiquityContainerIdentifier: nil)
    }

    private func openDataFolder(replyTo id: String) {
        // "Apri cartella dati" apre l'app di File dentro la cartella dell'app
        // (visibile in "sul mio iPhone" grazie a UIFileSharingEnabled).
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.data], asCopy: false)
        picker.delegate = self
        picker.directoryURL = documentsURL
        pickerContext = (kind: .browseFolder, replyId: id, fileName: nil)
        present(picker)
    }

    /// Salva un file generato dal renderer (export JSON / Excel) tramite il
    /// picker di sistema: su iOS il download "classico" del browser non esiste.
    private func saveFile(_ args: Any?, replyTo id: String) {
        guard let payload = args as? [String: Any],
              let fileName = payload["fileName"] as? String,
              let base64 = payload["content"] as? String,
              let data = Data(base64Encoded: base64) else {
            reply(id, error: "Contenuto del file non valido")
            return
        }

        let sanitized = fileName.replacingOccurrences(of: "/", with: "-")
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(sanitized)
        do {
            try data.write(to: tempURL, options: .atomic)
            let picker = UIDocumentPickerViewController(forExporting: [tempURL], asCopy: true)
            picker.delegate = self
            pickerContext = (kind: .exportData, replyId: id, fileName: sanitized)
            present(picker)
        } catch {
            reply(id, error: error.localizedDescription)
        }
    }

    // MARK: - UIDocumentPickerDelegate

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let context = pickerContext else { return }
        pickerContext = nil

        switch context.kind {
        case .importData:
            guard let url = urls.first else {
                reply(context.replyId, value: ["success": false, "canceled": true])
                return
            }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }

            do {
                let data = try Data(contentsOf: url)
                let parsed = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
                reply(context.replyId, value: [
                    "success": true,
                    "data": parsed,
                    "filePath": url.path,
                    "displayLocation": url.lastPathComponent,
                    "isICloud": url.path.contains("Mobile Documents") || url.path.contains("CloudDocs"),
                ])
            } catch {
                reply(context.replyId, error: "Impossibile leggere il file selezionato")
            }

        case .linkPrimaryFile:
            guard let folder = urls.first else {
                reply(context.replyId, value: ["success": false, "canceled": true])
                return
            }

            // Permessi di scrittura sulla cartella scelta (persistono fra un
            // avvio e l'altro grazie al bookmark).
            let scoped = folder.startAccessingSecurityScopedResource()
            defer { if scoped { folder.stopAccessingSecurityScopedResource() } }

            do {
                try primaryStore.link(to: folder)

                // Se la cartoria contiene già un user-data.json, lo si usa:
                // l'app si allinea al file di iCloud Drive.
                var existing: Any = NSNull()
                if let data = primaryStore.read(),
                   let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) {
                    existing = parsed
                } else if let data = pendingPrimaryData {
                    _ = primaryStore.write(data)
                }
                pendingPrimaryData = nil

                startPrimaryWatching()

                let info = primaryStore.info()
                reply(context.replyId, value: [
                    "success": true,
                    "data": existing,
                    "filePath": info["filePath"] as? String ?? folder.path,
                    "displayLocation": info["displayLocation"] as? String ?? folder.lastPathComponent,
                    "isICloud": info["isICloud"] as? Bool ?? false,
                ])
            } catch {
                pendingPrimaryData = nil
                reply(context.replyId, error: "Impossibile collegare la cartella: \(error.localizedDescription)")
            }

        case .exportData:
            reply(context.replyId, value: [
                "success": true,
                "filePath": context.fileName ?? "",
                "displayLocation": context.fileName ?? "File salvato",
                "isICloud": true,
            ])

        case .browseFolder:
            reply(context.replyId, value: true)
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let context = pickerContext else { return }
        pickerContext = nil
        pendingPrimaryData = nil
        reply(context.replyId, value: ["success": false, "canceled": true])
    }

    // MARK: - VNDocumentCameraViewControllerDelegate (scanner integrato)

    func documentCameraViewController(
        _ controller: VNDocumentCameraViewController,
        didFinishWith scan: VNDocumentCameraScan
    ) {
        controller.dismiss(animated: true)

        guard let replyId = pendingScanReplyId else { return }
        pendingScanReplyId = nil

        guard scan.pageCount > 0 else {
            reply(replyId, error: "Nessuna pagina scansionata.")
            return
        }

        // Gli scontrini sono normalmente su una pagina: si prende la prima.
        let image = scan.imageOfPage(at: 0)
        finishScan(with: image, replyId: replyId)
    }

    func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)

        guard let replyId = pendingScanReplyId else { return }
        pendingScanReplyId = nil
        reply(replyId, value: ["success": false, "canceled": true])
    }

    func documentCameraViewController(
        _ controller: VNDocumentCameraViewController,
        didFailWithError error: Error
    ) {
        controller.dismiss(animated: true)

        guard let replyId = pendingScanReplyId else { return }
        pendingScanReplyId = nil
        reply(replyId, error: "Scansione non riuscita: \(error.localizedDescription)")
    }

    // MARK: - PHPickerViewControllerDelegate (fallback libreria foto)

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)

        guard let replyId = pendingScanReplyId else { return }
        pendingScanReplyId = nil

        guard let provider = results.first?.itemProvider,
              provider.canLoadObject(ofClass: UIImage.self) else {
            reply(replyId, value: ["success": false, "canceled": true])
            return
        }

        provider.loadObject(ofClass: UIImage.self) { [weak self] object, error in
            guard let self else { return }

            if let error {
                self.reply(replyId, error: "Impossibile caricare la foto: \(error.localizedDescription)")
                return
            }
            guard let image = object as? UIImage else {
                self.reply(replyId, error: "Foto non leggibile.")
                return
            }
            self.finishScan(with: image, replyId: replyId)
        }
    }

    // MARK: - Rete

    private func getTickerPrice(_ args: Any?, replyTo id: String) {
        let raw: String?
        if let value = args as? String {
            raw = value
        } else if let wrapper = args as? [String: Any] {
            raw = wrapper["ticker"] as? String
        } else {
            raw = nil
        }

        guard let raw else {
            reply(id, error: "Ticker mancante")
            return
        }

        let ticker = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard ticker.range(of: "^[A-Z0-9.\\-]{1,12}$", options: .regularExpression) != nil else {
            reply(id, error: "Formato del ticker non valido")
            return
        }

        var components = URLComponents(string: "https://query1.finance.yahoo.com/v8/finance/chart/\(ticker)")
        components?.queryItems = [
            URLQueryItem(name: "range", value: "1y"),
            URLQueryItem(name: "interval", value: "1d"),
        ]

        guard let url = components?.url else {
            reply(id, error: "URL non valido")
            return
        }

        var request = URLRequest(url: url)
        request.setValue(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            forHTTPHeaderField: "User-Agent"
        )
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 15

        URLSession.shared.dataTask(with: request) { data, response, error in
            if error != nil {
                self.reply(id, error: "Impossibile recuperare i dati del ticker")
                return
            }
            guard let data,
                  let http = response as? HTTPURLResponse,
                  http.statusCode == 200,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let chart = json["chart"] as? [String: Any],
                  let results = chart["result"] as? [[String: Any]],
                  let result = results.first,
                  let meta = result["meta"] as? [String: Any] else {
                self.reply(id, error: "Ticker non trovato")
                return
            }

            let price = (meta["regularMarketPrice"] as? NSNumber)?.doubleValue ?? 0
            let previousClose = (meta["chartPreviousClose"] as? NSNumber)?.doubleValue ?? 0
            let currency = meta["currency"] as? String ?? "USD"
            let symbol = meta["symbol"] as? String ?? ticker
            let longName = meta["longName"] as? String ?? symbol

            var history: [[String: Any]] = []
            let formatter = ISO8601DateFormatter()
            if let timestamps = result["timestamp"] as? [Double],
               let indicators = result["indicators"] as? [String: Any],
               let quotes = indicators["quote"] as? [[String: Any]],
               let closes = quotes.first?["close"] as? [NSNumber] {
                for (index, timestamp) in timestamps.enumerated() {
                    guard index < closes.count else { break }
                    let value = closes[index].doubleValue
                    guard value > 0 else { continue }
                    let date = formatter.string(from: Date(timeIntervalSince1970: timestamp))
                    history.append(["date": String(date.prefix(10)), "price": value])
                }
            }

            self.reply(id, value: [
                "price": price,
                "previousClose": previousClose,
                "currency": currency,
                "symbol": symbol,
                "longName": longName,
                "history": history,
            ])
        }.resume()
    }

    private func checkForUpdates(_ args: Any?, replyTo id: String) {
        let wrapper = args as? [String: Any]
        let rawRepo = (wrapper?["repo"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let token = (wrapper?["token"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let repo = BudgetBridge.normalizeRepo(rawRepo)
        let currentVersion = appVersion()

        var components = URLComponents(string: "https://api.github.com/repos/\(repo)/releases")
        components?.queryItems = [URLQueryItem(name: "per_page", value: "30")]

        guard let url = components?.url else {
            reply(id, error: "URL non valido")
            return
        }

        var request = URLRequest(url: url)
        request.setValue("BudgetApp-iOS-Updater/1.0", forHTTPHeaderField: "User-Agent")
        request.setValue("application/vnd.github.v3+json", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        if !token.isEmpty {
            request.setValue("token \(token)", forHTTPHeaderField: "Authorization")
        }
        request.timeoutInterval = 15

        URLSession.shared.dataTask(with: request) { data, response, error in
            if error != nil {
                self.reply(id, value: [
                    "updateAvailable": false,
                    "currentVersion": currentVersion,
                    "latestVersion": currentVersion,
                    "error": "Impossibile verificare gli aggiornamenti su GitHub.",
                    "repo": repo,
                ])
                return
            }

            guard let data,
                  let http = response as? HTTPURLResponse,
                  http.statusCode == 200,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
                self.reply(id, value: [
                    "updateAvailable": false,
                    "currentVersion": currentVersion,
                    "latestVersion": currentVersion,
                    "error": "Risposta non valida da GitHub.",
                    "repo": repo,
                ])
                return
            }

            let candidates = json.filter { ($0["draft"] as? Bool) != true }
            guard let best = candidates.max(by: { lhs, rhs in
                let left = BudgetBridge.extractVersion(from: lhs) ?? "0.0.0"
                let right = BudgetBridge.extractVersion(from: rhs) ?? "0.0.0"
                if BudgetBridge.compareVersions(left, right) != .orderedSame {
                    return BudgetBridge.compareVersions(left, right) == .orderedAscending
                }
                return BudgetBridge.date(from: lhs) < BudgetBridge.date(from: rhs)
            }) else {
                self.reply(id, value: [
                    "updateAvailable": false,
                    "currentVersion": currentVersion,
                    "latestVersion": currentVersion,
                    "message": "Nessuna release pubblicata trovata nel repository \"\(repo)\".",
                    "repo": repo,
                ])
                return
            }

            let latestVersion = BudgetBridge.extractVersion(from: best) ?? currentVersion
            let tagName = (best["tag_name"] as? String) ?? "v\(latestVersion)"

            var payload: [String: Any] = [
                "updateAvailable": BudgetBridge.compareVersions(latestVersion, currentVersion) == .orderedDescending,
                "currentVersion": currentVersion,
                "latestVersion": latestVersion,
                "tagName": tagName,
                "releaseName": (best["name"] as? String) ?? tagName,
                "releaseNotes": (best["body"] as? String) ?? "Nessuna nota di rilascio fornita per questo aggiornamento.",
                "publishedAt": (best["published_at"] as? String) ?? (best["created_at"] as? String) ?? "",
                "htmlUrl": (best["html_url"] as? String) ?? "https://github.com/\(repo)/releases",
                "isPrerelease": (best["prerelease"] as? Bool) ?? false,
                "repo": repo,
            ]

            // L'asset puo' non esistere: in quel caso il campo resta assente
            // (JSONSerialization non accetta Optional dentro un dizionario).
            if let asset = BudgetBridge.pickIOSAsset(best["assets"] as? [[String: Any]]) {
                payload["asset"] = asset
            }

            self.reply(id, value: payload)
        }.resume()
    }

    private func downloadAndInstallUpdate(_ args: Any?, replyTo id: String) {
        let wrapper = args as? [String: Any]
        let rawUrl = (wrapper?["downloadUrl"] as? String) ?? (wrapper?["apiUrl"] as? String)

        guard let rawUrl, let url = URL(string: rawUrl) else {
            reply(id, error: "Link di download non disponibile")
            return
        }

        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { success in
                self.reply(id, value: [
                    "success": success,
                    "message": "Aggiornamento iOS: il pacchetto IPA si apre nel browser. Per installarlo, apri AltStore (o Sideloadly) sul telefono e reinstalla l'app.",
                ])
            }
        }
    }

    // MARK: - Notifiche

    private func sendNotification(_ args: Any?, replyTo id: String) {
        let payload = args as? [String: Any] ?? [:]
        let title = payload["title"] as? String ?? "Budget App"
        let body = payload["body"] as? String ?? ""
        let silent = (payload["silent"] as? Bool) ?? false

        let center = UNUserNotificationCenter.current()
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        if !silent {
            content.sound = .default
        }

        let request = UNNotificationRequest(
            identifier: "budget-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )

        center.getNotificationSettings { settings in
            let deliver: (Bool) -> Void = { granted in
                guard granted else {
                    self.reply(id, value: [
                        "success": false,
                        "channel": "none",
                        "reason": "Permesso di notifica non concesso",
                    ])
                    return
                }
                center.add(request) { error in
                    if let error {
                        self.reply(id, value: ["success": false, "error": error.localizedDescription])
                    } else {
                        self.reply(id, value: ["success": true, "channel": "native"])
                    }
                }
            }

            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                deliver(true)
            case .notDetermined:
                center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                    deliver(granted)
                }
            default:
                deliver(false)
            }
        }
    }

    private func getNotificationCapability(replyTo id: String) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let authorized = settings.authorizationStatus == .authorized
                || settings.authorizationStatus == .provisional
                || settings.authorizationStatus == .ephemeral

            self.reply(id, value: [
                "supported": authorized,
                "channel": authorized ? "native" : "none",
                "bundleId": Bundle.main.bundleIdentifier ?? "com.budgeting.macapp",
                "appName": Bundle.main.infoDictionary?["CFBundleDisplayName"] as? String ?? "Budget App",
                "platform": "ios",
                "signed": true,
            ])
        }
    }

    // MARK: - Esterno

    private func openExternal(_ args: Any?, replyTo id: String) {
        guard let raw = args as? String, let url = URL(string: raw) else {
            reply(id, value: false)
            return
        }

        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { success in
                self.reply(id, value: success)
            }
        }
    }

    // MARK: - Diagnostica

    /// Esegue un'espressione JavaScript nella WebView e riporta il risultato
    /// nel log del dispositivo (solo diagnostica).
    func debugEval(_ code: String) {
        DispatchQueue.main.async {
            self.webView?.evaluateJavaScript(code) { result, error in
                if let error {
                    NSLog("[Debug] errore: %@", error.localizedDescription)
                } else {
                    NSLog("[Debug] %@", String(describing: result ?? "nil"))
                }
            }
        }
    }

    // MARK: - Riconoscimento scontrini (OCR)

    /// Scansione di uno scontrino: fotocamera (VisionKit) o libreria foto,
    /// poi riconoscimento del testo con il framework Vision (on-device,
    /// gratuito e senza rete).
    private func scanReceipt(replyTo id: String) {
        DispatchQueue.main.async {
            guard let presenter = BudgetBridge.topViewController() else {
                self.reply(id, error: "Impossibile presentare la fotocamera")
                return
            }

            self.pendingScanReplyId = id

            if VNDocumentCameraViewController.isSupported {
                let scanner = VNDocumentCameraViewController()
                scanner.delegate = self
                presenter.present(scanner, animated: true)
                return
            }

            // Fallback: scelta di una foto dalla libreria.
            var configuration = PHPickerConfiguration()
            configuration.filter = .images
            configuration.selectionLimit = 1
            let picker = PHPickerViewController(configuration: configuration)
            picker.delegate = self
            presenter.present(picker, animated: true)
        }
    }

    /// Riconosce il testo di un'immagine con Vision.
    private func recognizeText(in image: UIImage, completion: @escaping (Result<String, Error>) -> Void) {
        guard let cgImage = image.cgImage else {
            completion(.failure(NSError(
                domain: "BudgetApp.OCR",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Immagine non valida"]
            )))
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            // Motore condiviso con la versione macOS: pre-elabora l'immagine
            // e ricostruisce le righe usando le bounding box (cosi' le colonne
            // di uno scontrino termico tornano a essere righe intere).
            let lines = ReceiptOCR.recognize(image: cgImage)
            NSLog("[OCR] %d righe riconosciute:\n%@", lines.count, lines.joined(separator: "\n"))
            completion(.success(lines.joined(separator: "\n")))
        }
    }

    private func finishScan(with image: UIImage, replyId: String) {
        self.recognizeText(in: image) { result in
            switch result {
            case .success(let text):
                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.isEmpty {
                    self.reply(replyId, error: "Nessun testo riconosciuto nell'immagine.")
                } else {
                    self.reply(replyId, value: [
                        "success": true,
                        "text": trimmed,
                        "source": "vision",
                    ])
                }
            case .failure(let error):
                self.reply(replyId, error: "Riconoscimento fallito: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Risposte

    private func reply(_ id: String, value: Any) {
        let payload = BudgetBridge.jsonString(value)
        DispatchQueue.main.async {
            self.webView?.evaluateJavaScript(
                "window.__budgetAppResolve(\(BudgetBridge.jsonString(id)), \(payload));"
            ) { _, error in
                if let error {
                    print("[BudgetBridge] errore nella risposta: \(error.localizedDescription)")
                }
            }
        }
    }

    private func reply(_ id: String, error: String) {
        DispatchQueue.main.async {
            self.webView?.evaluateJavaScript(
                "window.__budgetAppReject(\(BudgetBridge.jsonString(id)), \(BudgetBridge.jsonString(error)));"
            ) { _, evalError in
                if let evalError {
                    print("[BudgetBridge] errore nel rifiuto: \(evalError.localizedDescription)")
                }
            }
        }
    }

    /// Impronta del contenuto significativo di un payload: esclude i campi
    /// volatili (`exportedAt`, `_fileMeta.updatedAt`) che cambiano a ogni
    /// salvataggio e farebbero sembrare il file sempre modificato.
    private static func semanticHash(of payload: Any) -> String {
        guard var dictionary = payload as? [String: Any] else { return "" }
        dictionary.removeValue(forKey: "exportedAt")
        if var meta = dictionary["_fileMeta"] as? [String: Any] {
            meta.removeValue(forKey: "updatedAt")
            dictionary["_fileMeta"] = meta
        }
        guard let data = try? JSONSerialization.data(withJSONObject: dictionary, options: [.sortedKeys]) else {
            return ""
        }
        var hash: UInt64 = 5381
        for byte in data {
            hash = (hash &* 33) &+ UInt64(byte)
        }
        return String(hash)
    }

    private static func jsonString(_ value: Any) -> String {
        if value is NSNull { return "null" }
        if let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys]),
           let text = String(data: data, encoding: .utf8) {
            return text
        }
        return "null"
    }

    // MARK: - Helper

    private func present(_ controller: UIViewController) {
        DispatchQueue.main.async {
            guard let presenter = BudgetBridge.topViewController() else { return }
            presenter.present(controller, animated: true)
        }
    }

    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let windows = scenes.flatMap { $0.windows }
        guard var top = (windows.first(where: { $0.isKeyWindow }) ?? windows.first)?.rootViewController else {
            return nil
        }
        while let presented = top.presentedViewController {
            top = presented
        }
        return top
    }

    private static func normalizeRepo(_ raw: String?) -> String {
        let fallback = "Ale410-cpu/App-Budgeting-2"
        guard let raw else { return fallback }

        var cleaned = raw
            .replacingOccurrences(of: "https://github.com/", with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: ".git", with: "", options: [.regularExpression, .caseInsensitive])
            .trimmingCharacters(in: .whitespacesAndNewlines)

        cleaned = cleaned.replacingOccurrences(of: "App-Budegting-2", with: "App-Budgeting-2")

        let parts = cleaned.split(separator: "/").map(String.init)
        guard parts.count >= 2 else { return fallback }
        return "\(parts[0])/\(parts[1])"
    }

    private static func extractVersion(from release: [String: Any]) -> String? {
        let sources = [
            release["tag_name"] as? String,
            release["name"] as? String,
            release["body"] as? String,
        ].compactMap { $0 }

        let pattern = "[0-9]+\\.[0-9]+(?:\\.[0-9]+)?"
        for source in sources {
            guard let range = source.range(of: pattern, options: .regularExpression) else { continue }
            return String(source[range]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return nil
    }

    private static func compareVersions(_ lhs: String, _ rhs: String) -> ComparisonResult {
        let left = lhs.split(separator: ".").map { Int($0) ?? 0 }
        let right = rhs.split(separator: ".").map { Int($0) ?? 0 }

        for index in 0..<max(left.count, right.count) {
            let a = index < left.count ? left[index] : 0
            let b = index < right.count ? right[index] : 0
            if a != b {
                return a < b ? .orderedAscending : .orderedDescending
            }
        }
        return .orderedSame
    }

    private static func date(from release: [String: Any]) -> Date {
        let formatter = ISO8601DateFormatter()
        for key in ["published_at", "created_at", "updated_at"] {
            if let value = release[key] as? String, let parsed = formatter.date(from: value) {
                return parsed
            }
        }
        return Date(timeIntervalSince1970: 0)
    }

    /// Sceglie l'asset `.ipa` della release (l'equivalente iOS del `.dmg`).
    private static func pickIOSAsset(_ assets: [[String: Any]]?) -> [String: Any]? {
        guard let assets, !assets.isEmpty else { return nil }

        let ipa = assets.first { ($0["name"] as? String)?.lowercased().hasSuffix(".ipa") == true }
        guard let chosen = ipa ?? assets.first else { return nil }

        return [
            "name": chosen["name"] as? String ?? "BudgetApp.ipa",
            "downloadUrl": chosen["browser_download_url"] as? String ?? "",
            "apiUrl": chosen["url"] as? String ?? "",
            "size": (chosen["size"] as? NSNumber)?.intValue ?? 0,
            "contentType": chosen["content_type"] as? String ?? "application/octet-stream",
        ]
    }
}
