import Foundation
import WebKit

/// Serve il bundle web (build Vite) attraverso uno schema URL custom.
///
/// Vantaggi rispetto a `file://`:
/// - origine reale e persistente (`budgetapp://app.local`): `localStorage` e
///   `IndexedDB` sopravvivono alla chiusura dell'app;
/// - i moduli ES e i web worker (pdf.js) non vengono bloccati dal CORS;
/// - il CSP dichiarato in `index.html` continua a valere (`'self'`).
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {

    static let scheme = "budgetapp"
    /// Host "localhost": i domini `.local` sono riservati al mDNS e WebKit
    /// li tratta in modo anomalo (la pagina veniva ricaricata in loop e non
    /// veniva mai eseguita).
    static let host = "localhost"

    /// URL di avvio della web app.
    static var startURL: URL {
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.path = "/index.html"
        // swiftlint:disable:next force_unwrapping
        return components.url!
    }

    /// Radice del bundle web dentro l'app (`.app/web`).
    private let rootURL: URL?

    /// Path della radice (per i log).
    var rootPath: String {
        rootURL?.path ?? "(nessuna)"
    }

    override init() {
        rootURL = Bundle.main.url(forResource: "web", withExtension: nil)
        super.init()
    }

    // MARK: - WKURLSchemeHandler

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(AppSchemeHandler.makeError("URL non valido"))
            return
        }

        NSLog("[BudgetApp] richiesta: %@ (accept: %@)", url.absoluteString, urlSchemeTask.request.value(forHTTPHeaderField: "Accept") ?? "-")

        guard let rootURL else {
            urlSchemeTask.didFailWithError(AppSchemeHandler.makeError("Bundle web mancante dentro l'app"))
            return
        }

        var fileURL = rootURL
        for component in AppSchemeHandler.pathComponents(for: url) {
            fileURL.appendPathComponent(component)
        }

        if (try? fileURL.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
            fileURL.appendPathComponent("index.html")
        }

        // File trovato: lo si serve cosi' com'e'.
        if FileManager.default.fileExists(atPath: fileURL.path),
           let data = try? Data(contentsOf: fileURL) {
            respond(task: urlSchemeTask, url: fileURL, data: data)
            return
        }

        // Navigazione (SPA): qualunque percorso inesistente torna a index.html.
        let acceptsHTML = urlSchemeTask.request.value(forHTTPHeaderField: "Accept")?
            .lowercased()
            .contains("text/html") ?? false

        let indexURL = rootURL.appendingPathComponent("index.html")
        if acceptsHTML, let indexData = try? Data(contentsOf: indexURL) {
            respond(task: urlSchemeTask, url: indexURL, data: indexData)
            return
        }

        // Bundle non sincronizzato: meglio una pagina leggibile che uno schermo nero.
        if !FileManager.default.fileExists(atPath: indexURL.path) {
            respond(task: urlSchemeTask, url: indexURL, data: AppSchemeHandler.missingBundlePage)
            return
        }

        respond(task: urlSchemeTask, url: fileURL, data: Data("Risorsa non trovata".utf8), status: 404)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Nessun task asincrono da annullare: i file sono letti in modo sincrono.
    }

    // MARK: - Helpers

    /// Pagina di prova: serve a isolare i problemi di caricamento.
    /// (va tenuta `false` nelle build release)
    private static let debugPage = false

    private func respond(task: WKURLSchemeTask, url: URL, data: Data, status: Int = 200) {
        let mimeType = AppSchemeHandler.mimeType(for: url.pathExtension)

        // PAGINA DI PROVA: serve a isolare i problemi di caricamento.
        if AppSchemeHandler.debugPage {
            let probe = """
            <!doctype html>
            <html lang="it"><head><meta charset="utf-8"><title>probe</title></head>
            <body style="background:#cc0000;color:#ffffff;font:bold 64px -apple-system,sans-serif;
                         display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
            <div style="text-align:center">
            <div style="font-size:80px">PROBE</div>
            <div style="font-size:36px">SCHEMA HANDLER OK</div>
            <div style="font-size:28px;margin-top:20px">nessun script, nessuna subrisorsa</div>
            </div>
            </body></html>
            """
            let probeData = Data(probe.utf8)
            let probeResponse = URLResponse(
                url: url,
                mimeType: "text/html",
                expectedContentLength: probeData.count,
                textEncodingName: "utf-8"
            )
            task.didReceive(probeResponse)
            task.didReceive(probeData)
            task.didFinish()
            NSLog("[BudgetApp] servita pagina di prova (senza script)")
            return
        }

        // `URLResponse` e non `HTTPURLResponse`: per uno schema non-HTTP
        // WebKit non gestisce bene le semantiche HTTP (la navigazione veniva
        // ricaricata senza mai eseguire il documento).
        //
        // L'URL della risposta DEVE essere quello della richiesta
        // (`budgetapp://localhost/...`): se si passa il percorso del file nel
        // bundle, WebKit scarta la navigazione e la WebView resta bianca.
        let response = URLResponse(
            url: task.request.url ?? url,
            mimeType: mimeType,
            expectedContentLength: data.count,
            textEncodingName: "utf-8"
        )

        task.didReceive(response)
        if task.request.httpMethod?.uppercased() != "HEAD" {
            task.didReceive(data)
        }
        task.didFinish()
        NSLog("[BudgetApp] servito: %@ (%@, %d byte)", url.path, mimeType, data.count)
    }

    /// Normalizza il percorso della URL evitando qualsiasi risalita fuori dal bundle.
    private static func pathComponents(for url: URL) -> [String] {
        var components: [String] = []
        for raw in url.path.split(separator: "/") {
            let piece = String(raw)
            if piece.isEmpty || piece == "." { continue }
            if piece == ".." {
                if !components.isEmpty { components.removeLast() }
                continue
            }
            components.append(piece)
        }
        return components.isEmpty ? ["index.html"] : components
    }

    /// MIME type pulito (senza charset: il charset va in `textEncodingName`).
    ///
    /// Passare a `URLResponse` un valore come "text/html; charset=utf-8" e'
    /// sbagliato: WebKit non lo riconosce come tipo MIME valido, non esegue
    /// il documento e ritenta la navigazione (schermata bianca).
    private static func mimeType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "html", "htm":
            return "text/html"
        case "js", "mjs":
            return "text/javascript"
        case "css":
            return "text/css"
        case "json", "webmanifest":
            return "application/json"
        case "svg":
            return "image/svg+xml"
        case "png":
            return "image/png"
        case "jpg", "jpeg":
            return "image/jpeg"
        case "gif":
            return "image/gif"
        case "webp":
            return "image/webp"
        case "ico":
            return "image/x-icon"
        case "woff":
            return "font/woff"
        case "woff2":
            return "font/woff2"
        case "ttf":
            return "font/ttf"
        case "otf":
            return "font/otf"
        case "wasm":
            return "application/wasm"
        case "txt":
            return "text/plain"
        case "map":
            return "application/json"
        default:
            return "application/octet-stream"
        }
    }

    private static func makeError(_ message: String) -> NSError {
        NSError(
            domain: "BudgetApp.SchemeHandler",
            code: 404,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }

    /// Pagina mostrata quando il bundle web non e' stato copiato nel progetto
    /// (tipico: si ha aperto Xcode senza eseguire `npm run ios:sync`).
    private static let missingBundlePage = Data("""
    <!doctype html>
    <html lang="it">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Budget App — bundle mancante</title>
        <style>
          body { margin: 0; min-height: 100vh; display: flex; align-items: center;
                 justify-content: center; background: #08111f; color: #e2e8f0;
                 font-family: -apple-system, system-ui, sans-serif; padding: 24px; }
          .card { max-width: 460px; background: #0f172a; border: 1px solid #1e293b;
                  border-radius: 20px; padding: 28px; }
          h1 { font-size: 1.15rem; margin: 0 0 12px; }
          p { line-height: 1.55; color: #94a3b8; font-size: 0.92rem; }
          code { background: #08111f; border: 1px solid #1e293b; border-radius: 6px;
                 padding: 2px 6px; color: #2dd4bf; font-size: 0.85rem; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Bundle web non trovato</h1>
          <p>Il contenuto dell'app non e' stato copiato dentro il progetto Xcode.</p>
          <p>Esegui <code>npm run ios:sync</code> nella cartella del progetto e poi ricompila l'app.</p>
        </div>
      </body>
    </html>
    """.utf8)
}
