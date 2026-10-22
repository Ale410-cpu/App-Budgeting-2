import Foundation

/// Gestione del file dati "principale" su iOS.
///
/// L'app salva sempre una copia locale in `Documents/user-data.json`, ma
/// l'utente puo' **collegare una cartella** (per esempio dentro iCloud Drive):
/// da quel momento il file `user-data.json` contenuto in quella cartella
/// diventa il file principale e viene **aggiornato automaticamente** a ogni
/// modifica.
///
/// Note piattaforma:
/// - su iOS l'URL restituito dal document picker e' gia' "security scoped" e
///   il permesso persiste fra un avvio e l'altro; per ritrovarlo basta un
///   bookmark *minimal* (`.withSecurityScope` esiste solo su macOS);
/// - l'accesso va comunque aperto con `startAccessingSecurityScopedResource()`
///   e chiuso con `stopAccessingSecurityScopedResource()`.
final class PrimaryFileStore {

    private enum Keys {
        static let bookmark = "budgetapp.primaryFolder.bookmark"
        static let displayName = "budgetapp.primaryFolder.displayName"
    }

    /// Nome del file dati dentro la cartella collegata.
    static let fileName = "user-data.json"

    /// Cartella collegata dall'utente (nil se non collegata).
    private(set) var folderURL: URL?

    /// File JSON collegato direttamente (quando l'utente sceglie il file
    /// invece della cartella).
    private(set) var fileURL: URL?

    /// Callback invocata quando il file principale cambia dall'esterno
    /// (iCloud Drive, altro dispositivo, editor esterno).
    var onExternalChange: ((Any) -> Void)?

    private var pollTimer: Timer?
    private var lastWrittenContent: String?
    private var isWriting = false
    private var lastWrite: Date?
    private var pendingWrite: Data?

    // MARK: - Percorsi

    /// File dati principale.
    ///
    /// Se l'utente ha collegato una cartella, il file e' `user-data.json`
    /// dentro la cartella; se ha collegato direttamente un file (per
    /// esempio lo stesso `user-data.json` usato dal Mac), si usa quello.
    var primaryFileURL: URL? {
        if let fileURL { return fileURL }
        if let folderURL { return folderURL.appendingPathComponent(PrimaryFileStore.fileName) }
        return nil
    }

    /// Cartella che contiene il file principale (per le informazioni).
    private var containerURL: URL? {
        if let fileURL { return fileURL.deletingLastPathComponent() }
        return folderURL
    }

    // MARK: - Persistenza del collegamento

    /// Collega il file o la cartella scelta dall'utente.
    ///
    /// Su iOS l'URL restituito dal picker e' gia' "security scoped" e il
    /// permesso persiste fra un avvio e l'altro: per ritrovarlo basta un
    /// bookmark *minimal* (`.withSecurityScope` esiste solo su macOS).
    func link(to url: URL) throws {
        let isDirectory = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true

        let bookmark = try url.bookmarkData(
            options: [.minimalBookmark],
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        )

        UserDefaults.standard.set(bookmark, forKey: Keys.bookmark)
        UserDefaults.standard.set(url.lastPathComponent, forKey: Keys.displayName)

        releaseAccess()

        if isDirectory {
            folderURL = url
            fileURL = nil
        } else {
            fileURL = url
            folderURL = nil
        }

        _ = url.startAccessingSecurityScopedResource()
    }

    /// Scioglie il collegamento (si torna al file locale).
    func unlink() {
        releaseAccess()
        folderURL = nil
        fileURL = nil
        lastWrittenContent = nil
        UserDefaults.standard.removeObject(forKey: Keys.bookmark)
        UserDefaults.standard.removeObject(forKey: Keys.displayName)
    }

    /// Recupera il collegamento salvato in una sessione precedente.
    func restore() {
        guard let bookmark = UserDefaults.standard.data(forKey: Keys.bookmark) else { return }

        var isStale = false
        guard let url = try? URL(
            resolvingBookmarkData: bookmark,
            options: [.withoutUI],
            relativeTo: nil,
            bookmarkDataIsStale: &isStale
        ) else {
            UserDefaults.standard.removeObject(forKey: Keys.bookmark)
            return
        }

        let isDirectory = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
        if isDirectory {
            folderURL = url
            fileURL = nil
        } else {
            fileURL = url
            folderURL = nil
        }

        _ = url.startAccessingSecurityScopedResource()
    }

    private func releaseAccess() {
        if let url = folderURL ?? fileURL {
            url.stopAccessingSecurityScopedResource()
        }
    }

    // MARK: - Lettura / scrittura

    /// Esiste un file principale collegato (e leggibile)?
    func hasPrimaryFile() -> Bool {
        guard let url = primaryFileURL else { return false }
        return FileManager.default.fileExists(atPath: url.path)
    }

    /// Scrive i dati sul file principale. Ritorna `false` se non c'e' un
    /// file principale o se la scrittura fallisce.
    ///
    /// Il file può essere **condiviso con il Mac** tramite iCloud Drive:
    /// per non saturare il sync e per non sovrascrivere una modifica che
    /// sta arrivando dall'altra piattaforma, le scritture sono distanziate
    /// di almeno `minInterval` secondi. `force` (usata quando l'app va in
    /// background) scrive subito.
    @discardableResult
    func write(_ data: Data, force: Bool = false, minInterval: TimeInterval = 8) -> Bool {
        guard let url = primaryFileURL else { return false }

        let now = Date()
        if !force, let lastWrite, now.timeIntervalSince(lastWrite) < minInterval {
            // Scrittura rimandata: verrà ripetuta al prossimo salvataggio.
            pendingWrite = data
            return true
        }

        isWriting = true
        defer { isWriting = false }

        // I file di iCloud Drive vanno letti e scritti con un file
        // coordinator: è il modo previsto da iOS per non andare in conflitto
        // con il daemon di iCloud (e per far scaricare la versione più
        // recente prima di scrivere).
        var coordinationError: NSError?
        var writeError: Error?
        var written = false

        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { coordinatedURL in
            do {
                try data.write(to: coordinatedURL, options: .atomic)
                written = true
            } catch {
                writeError = error
            }
        }

        if let coordinationError {
            NSLog("[PrimaryFile] coordinamento fallito: %@", coordinationError.localizedDescription)
        }
        if let writeError {
            NSLog("[PrimaryFile] scrittura fallita: %@", writeError.localizedDescription)
        }

        guard written else { return false }

        lastWrittenContent = Self.hash(of: data)
        lastWrite = now
        pendingWrite = nil
        return true
    }

    /// Scrive subito eventuali dati in attesa (chiamata periodica).
    func flushPendingWrite() {
        guard let data = pendingWrite else { return }
        _ = write(data, force: true)
    }

    /// Contenuto corrente del file principale (nil se assente).
    ///
    /// La lettura passa dal file coordinator: su iCloud Drive questo forza
    /// il sistema a materializzare localmente la versione più recente.
    func read() -> Data? {
        guard let url = primaryFileURL else { return nil }

        var result: Data?
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { coordinatedURL in
            result = try? Data(contentsOf: coordinatedURL)
        }
        return result
    }

    /// Contenuto del file principale già interpretato come JSON.
    func readParsed() -> Any? {
        guard let data = read() else { return nil }
        return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    /// Il file principale e' stato modificato dall'esterno (Mac, altro
    /// dispositivo, sync iCloud) rispetto a quello scritto dall'app?
    ///
    /// Serve a non sovrascrivere le modifiche altrui quando Mac e iPhone
    /// usano lo stesso file su iCloud Drive.
    func hasExternalChanges() -> Bool {
        guard let data = read() else { return false }
        guard let last = lastWrittenContent else { return false }
        return Self.hash(of: data) != last
    }

    /// Informazioni sul file principale, per l'interfaccia.
    func info() -> [String: Any] {
        guard let url = primaryFileURL, let container = containerURL else { return [:] }

        let manager = FileManager.default
        let exists = manager.fileExists(atPath: url.path)

        var size: Int64 = 0
        var modified = Date()
        if let attributes = try? manager.attributesOfItem(atPath: url.path) {
            size = (attributes[.size] as? NSNumber)?.int64Value ?? 0
            modified = (attributes[.modificationDate] as? Date) ?? Date()
        }

        let isICloud = container.path.contains("/Mobile Documents/")
            || container.path.contains("/CloudDocs")
            || container.path.contains("iCloud Drive")
            || container.path.contains("File Provider Storage")

        let display = isICloud ? "iCloud Drive" : "File"

        return [
            "filePath": url.path,
            "fileName": url.lastPathComponent,
            "folderPath": container.path,
            "displayLocation": "\(display) / \(url.lastPathComponent)",
            "isICloud": isICloud,
            "isCustomPrimary": true,
            "iCloudAvailable": true,
            "iCloudDefaultPath": "iCloud Drive",
            "exists": exists,
            "size": size,
            "lastModified": modified.timeIntervalSince1970 * 1000,
            "candidates": [url.path],
        ]
    }

    // MARK: - Sorveglianza dei cambiamenti esterni

    /// Controlla periodicamente se il file principale e' cambiato fuori
    /// dall'app (iCloud Drive sincronizza i file in background).
    func startWatching(interval: TimeInterval = 5) {
        stopWatching()

        let timer = Timer(timeInterval: interval, repeats: true) { [weak self] _ in
            self?.checkForExternalChange()
            self?.flushPendingWrite()
        }
        RunLoop.main.add(timer, forMode: .common)
        pollTimer = timer
    }

    func stopWatching() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    /// Controllo immediato (usato quando l'app torna in primo piano:
    /// iOS sospende i timer in background, quindi il file potrebbe essere
    /// cambiato mentre l'app era in pausa).
    func checkNow() {
        checkForExternalChange()
    }

    private func checkForExternalChange() {
        guard !isWriting else { return }
        guard let data = read() else { return }

        let content = Self.hash(of: data)

        // Ignora i cambiamenti prodotti da noi stessi.
        if content == lastWrittenContent { return }
        if lastWrittenContent == nil {
            // Primo controllo: memorizza solo l'impronta attuale.
            lastWrittenContent = content
            return
        }

        lastWrittenContent = content

        guard let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else {
            return
        }

        NSLog("[PrimaryFile] il file principale e' cambiato esternamente")
        onExternalChange?(parsed)
    }

    private static func hash(of data: Data) -> String {
        // Impronta semplice e stabile (sufficiente per il confronto).
        var hash: UInt64 = 5381
        for byte in data {
            hash = (hash &* 33) &+ UInt64(byte)
        }
        return String(hash)
    }
}
