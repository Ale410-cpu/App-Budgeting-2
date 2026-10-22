import UIKit
import WebKit

/// Entry point dell'app iOS.
///
/// L'app nativa e' un contenitore sottile: tutta la logica di business resta
/// nel renderer React (build Vite) servito dalla WebView attraverso uno schema
/// URL custom (`budgetapp://app.local`).
///
/// Perche' uno schema custom e non `file://`:
/// - `file://` non ha un'origine utilizzabile: i moduli ES e i web worker
///   (pdf.js) vengono bloccati e `localStorage` / `IndexedDB` non hanno
///   un'origine persistente tra un avvio e l'altro;
/// - `budgetapp://app.local` e' un origine reale e stabile, quindi moduli ES,
///   worker, `localStorage` e `IndexedDB` si comportano come sul web.
///
/// Il bridge nativo (`BudgetBridge`) espone `window.budgetApp` con la stessa
/// interfaccia del preload di Electron: il renderer non deve sapere se sta
/// girando su macOS o su iOS.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    private var webView: WKWebView?
    private var schemeHandler: AppSchemeHandler?
    private var bridge: BudgetBridge?

    /// Il bundle web e' stato gia' caricato: evita un doppio `load()`,
    /// che annullerebbe la prima navigazione (schermata bianca).
    private var hasLoadedWebContent = false

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        buildInterface()
        return true
    }

    /// L'app va in background: allinea subito il file su iCloud Drive, cosi'
    /// l'altra piattaforma vede subito i dati.
    func applicationDidEnterBackground(_ application: UIApplication) {
        bridge?.flushPrimaryFile()
    }

    /// Se il sistema ha terminato il processo WebView (memoria insufficiente)
    /// la app si riapre su una pagina bianca: in quel caso si ricarica.
    func applicationDidBecomeActive(_ application: UIApplication) {
        // I timer sono sospesi in background: al rientro in primo piano
        // controlliamo se il file su iCloud Drive e' cambiato.
        bridge?.checkPrimaryFileNow()

        guard let webView, !hasLoadedWebContent else { return }
        hasLoadedWebContent = true
        webView.load(URLRequest(url: AppSchemeHandler.startURL))
    }

    /// Inoltra la console JavaScript al log nativo: su iOS la console del
    /// WebView non e' visibile altrimenti (utile per diagnosticare CSP, CORS
    /// o errori di caricamento degli asset).
    static let consoleForwarderJS = #"""
    (function () {
      function send(level, args) {
        try {
          var parts = [];
          for (var i = 0; i < args.length; i++) {
            var value = args[i];
            if (value instanceof Error) value = value.message;
            else if (typeof value === 'object') {
              try { value = JSON.stringify(value); } catch (e) { value = String(value); }
            }
            parts.push(String(value));
          }
          window.webkit.messageHandlers.budgetApp.postMessage({
            id: 'console-' + Date.now() + '-' + Math.random().toString(16).slice(2),
            method: 'console',
            args: { level: level, text: parts.join(' ') }
          });
        } catch (e) {}
      }
      ['log', 'warn', 'error', 'info'].forEach(function (level) {
        var original = console[level];
        console[level] = function () {
          send(level, arguments);
          if (original) original.apply(console, arguments);
        };
      });
      window.addEventListener('error', function (event) {
        send('error', ['window.onerror: ' + event.message + ' @ ' + (event.filename || '?') + ':' + (event.lineno || 0)]);
      });
      window.addEventListener('unhandledrejection', function (event) {
        send('error', ['promise rejection: ' + (event.reason && event.reason.message ? event.reason.message : event.reason)]);
      });
    })();
    """#

    // MARK: - Setup

    private func buildInterface() {
        let schemeHandler = AppSchemeHandler()
        let bridge = BudgetBridge()

        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: AppSchemeHandler.scheme)
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let userContentController = WKUserContentController()
        userContentController.addUserScript(
            WKUserScript(
                source: BudgetBridge.bootstrapJS,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        userContentController.addUserScript(
            WKUserScript(
                source: AppDelegate.consoleForwarderJS,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        userContentController.add(bridge, name: "budgetApp")
        configuration.userContentController = userContentController

        let webView = WKWebView(frame: UIScreen.main.bounds, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.contentInsetAdjustmentBehavior = .always
        if #available(iOS 16.4, *) {
            // Utile per il debug da Safari su iPhone (Web Inspector).
            webView.isInspectable = true
        }

        bridge.webView = webView
        bridge.activate()

        let controller = UIViewController()
        controller.view.backgroundColor = UIColor(red: 0.031, green: 0.067, blue: 0.122, alpha: 1)
        controller.view.addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: controller.view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: controller.view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: controller.view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: controller.view.trailingAnchor),
        ])

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        self.window = window

        self.webView = webView
        self.schemeHandler = schemeHandler
        self.bridge = bridge

        webView.load(URLRequest(url: AppSchemeHandler.startURL))
        hasLoadedWebContent = true
        NSLog("[BudgetApp] avvio: caricamento %@ (root: %@)", AppSchemeHandler.startURL.absoluteString, schemeHandler.rootPath)

        // Diagnostica di avvio: riporta nel log cosa ha effettivamente
        // renderizzato la WebView.
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
            bridge.debugEval(
                "JSON.stringify({ root: (document.getElementById('root')||{}).childElementCount || -1,"
                + " text: (document.body.innerText||'').slice(0,260),"
                + " scripts: document.scripts.length,"
                + " style: document.styleSheets.length })"
            )
        }
    }
}

// MARK: - WKNavigationDelegate

extension AppDelegate: WKNavigationDelegate {

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        NSLog("[BudgetApp] navigazione: %@", url.absoluteString)

        // Il bundle web e le URL interne girano dentro la WebView.
        if url.scheme == AppSchemeHandler.scheme || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" {
            decisionHandler(.allow)
            return
        }

        // I link esterni (GitHub, documentazione...) si aprono nel browser.
        if navigationAction.navigationType == .linkActivated {
            UIApplication.shared.open(url, options: [:])
            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        NSLog("[BudgetApp] navigazione completata")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSLog("[BudgetApp] navigazione FALLITA: %@", error.localizedDescription)
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        NSLog("[BudgetApp] navigazione PROVVISORIA FALLITA: %@", error.localizedDescription)
    }
}

// MARK: - WKUIDelegate

extension AppDelegate: WKUIDelegate {

    /// Le finestre aperte con `target="_blank"` si aprono nel browser di sistema.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url, navigationAction.targetFrame == nil {
            UIApplication.shared.open(url, options: [:])
        }
        return nil
    }

    /// `alert()` non viene mostrato dal WebKit se non si implementa questo
    /// delegate: senza questo blocco l'app si bloccherebbe su ogni alert.
    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        presentAlert(title: nil, message: message, confirmTitle: "OK") { _ in
            completionHandler()
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        presentAlert(title: nil, message: message, confirmTitle: "Annulla", cancelTitle: "Continua") { confirmed in
            completionHandler(confirmed)
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { field in
            field.text = defaultText
        }
        alert.addAction(UIAlertAction(title: "Annulla", style: .cancel) { _ in
            completionHandler(nil)
        })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
            completionHandler(alert.textFields?.first?.text)
        })
        topViewController()?.present(alert, animated: true)
    }

    // MARK: Helpers

    private func presentAlert(
        title: String?,
        message: String,
        confirmTitle: String,
        cancelTitle: String? = nil,
        completion: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        if let cancelTitle {
            alert.addAction(UIAlertAction(title: cancelTitle, style: .cancel) { _ in
                completion(false)
            })
            alert.addAction(UIAlertAction(title: confirmTitle, style: .default) { _ in
                completion(true)
            })
        } else {
            alert.addAction(UIAlertAction(title: confirmTitle, style: .default) { _ in
                completion(true)
            })
        }
        topViewController()?.present(alert, animated: true)
    }

    private func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap { $0.windows }.first(where: { $0.isKeyWindow })
            ?? scenes.flatMap { $0.windows }.first
        guard var top = window?.rootViewController else { return nil }
        while let presented = top.presentedViewController {
            top = presented
        }
        return top
    }
}
