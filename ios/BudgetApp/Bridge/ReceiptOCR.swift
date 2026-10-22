import CoreGraphics
import CoreImage
import Foundation
import Vision

/// Motore di riconoscimento testo per gli scontrini.
///
/// Due problemi tipici dell'OCR su scontrini e come vengono risolti:
///
/// 1. **Colonne**: l'OCR legge prima tutte le descrizioni e poi tutti i
///    prezzi (perche' la stampante termica stampa in colonne). Si usa quindi
///    la *bounding box* di ogni riconoscimento per **ricostruire le righe**
///    del documento: i blocchi che si sovrappongono in verticale formano una
///    riga, e vengono ordinati da sinistra a destra.
///
/// 2. **Foto poco contrastate**: si pre-elabora l'immagine (grayscale,
///    contrasto, nitidezza, ingrandimento) prima di passarla a Vision.
///
/// Il file usa solo CoreGraphics/CoreImage/Vision: funziona sia su iOS sia su
/// macOS (il comando `scripts/receipt-ocr.swift` lo compila insieme).
enum ReceiptOCR {

    // MARK: - Pre-elaborazione

    /// Pre-elabora l'immagine per migliorare la leggibilità del testo.
    ///
    /// - scala: gli scontrini fotografati hanno testo piccolo, Vision rende
    ///   molto meglio con caratteri più grandi;
    /// - grigi + contrasto: la carta termica è quasi bianca con grigi
    ///   tenui, l'equalizzazione porta il testo al nero;
    /// - nitidezza: le foto di uno scontrino sono quasi sempre sfocate.
    static func enhanced(_ image: CGImage) -> CGImage? {
        let context = CIContext(options: [.useSoftwareRenderer: false])

        let ciImage = CIImage(cgImage: image)

        // 1. Ingrandimento (se il testo è piccolo).
        var working = ciImage
        let width = ciImage.extent.width
        if width < 1400 {
            let scale = min(1400 / max(width, 1), 3.0)
            working = working.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        }

        // 2. Scala dei grigi + contrasto (equalizzazioneapprossimata).
        working = working.applyingFilter(
            "CIColorControls",
            parameters: [
                kCIInputSaturationKey: 0.0,
                kCIInputContrastKey: 1.45,
                kCIInputBrightnessKey: 0.04,
            ]
        )

        // 3. Curva di contrasto: scurisce i toni chiari (carta) e mantiene
        //    leggibili i toni scuri (inchiostro).
        working = working.applyingFilter(
            "CIToneCurve",
            parameters: [
                "inputPoint0": CIVector(x: 0.0, y: 0.0),
                "inputPoint1": CIVector(x: 0.35, y: 0.0),
                "inputPoint2": CIVector(x: 0.75, y: 1.0),
                "inputPoint3": CIVector(x: 1.0, y: 1.0),
            ]
        )

        // 4. Nitidezza.
        working = working.applyingFilter(
            "CISharpenLuminance",
            parameters: [kCIInputSharpnessKey: 0.7]
        )

        guard let output = context.createCGImage(working, from: working.extent) else {
            return image
        }
        return output
    }

    // MARK: - Riconoscimento

    /// Riconosce il testo di un'immagine e restituisce le righe del
    /// documento, con le colonne ricostruite.
    static func recognize(image: CGImage) -> [String] {
        let original = recognizeLines(in: image)
        let enhancedImage = enhanced(image)
        let enhanced = enhancedImage.flatMap { recognizeLines(in: $0) } ?? []

        return best(original: original, enhanced: enhanced)
    }

    /// Riconoscimento grezzo (righe come le vede Vision).
    private static func recognizeLines(in image: CGImage) -> [String] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["it-IT", "en-US"]
        // Aiuta con il testo piccolo degli scontrini termici.
        request.minimumTextHeight = 0.008

        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return []
        }

        let observations = request.results ?? []
        return reconstructRows(observations)
    }

    /// Ricostruisce le righe del documento usando le bounding box.
    ///
    /// I blocchi che si sovrappongono in verticale appartengono alla stessa
    /// riga: e' cosi' che "LATTE 1L" e "1,25" (colonne diverse) diventano
    /// "LATTE 1L  1,25".
    static func reconstructRows(_ observations: [VNRecognizedTextObservation]) -> [String] {
        struct Item {
            let text: String
            let box: CGRect
        }

        let items: [Item] = observations.compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            return Item(text: text, box: observation.boundingBox)
        }

        guard !items.isEmpty else { return [] }

        // Ordine di lettura: dall'alto in basso, da sinistra a destra.
        let sorted = items.sorted { left, right in
            if abs(left.box.maxY - right.box.maxY) > 0.006 {
                return left.box.maxY > right.box.maxY
            }
            return left.box.minX < right.box.minX
        }

        var rows: [[Item]] = []
        var current: [Item] = []
        var currentTop: CGFloat = 0
        var currentBottom: CGFloat = 0

        for item in sorted {
            let top = item.box.maxY
            let bottom = item.box.minY

            if current.isEmpty {
                current = [item]
                currentTop = top
                currentBottom = bottom
                continue
            }

            let overlap = min(currentTop, top) - max(currentBottom, bottom)
            let height = max(currentTop - currentBottom, 0.008)

            if overlap > height * 0.35 {
                current.append(item)
                currentTop = max(currentTop, top)
                currentBottom = min(currentBottom, bottom)
            } else {
                rows.append(current)
                current = [item]
                currentTop = top
                currentBottom = bottom
            }
        }
        if !current.isEmpty {
            rows.append(current)
        }

        return rows.map { row in
            row
                .sorted { $0.box.minX < $1.box.minX }
                .map { $0.text }
                .joined(separator: "  ")
        }
    }

    /// Sceglie il risultato migliore fra originale e versione preprocessata.
    ///
    /// Vince il risultato che riconosce un totale; se nessuno dei due lo
    /// trova, vince quello con piu' righe contenenti numeri.
    private static func best(original: [String], enhanced: [String]) -> [String] {
        if original.isEmpty { return enhanced }
        if enhanced.isEmpty { return original }

        let originalScore = score(original)
        let enhancedScore = score(enhanced)

        if originalScore.total && !enhancedScore.total { return original }
        if enhancedScore.total && !originalScore.total { return enhanced }
        return enhancedScore.numericLines > originalScore.numericLines ? enhanced : original
    }

    private struct Score {
        let total: Bool
        let numericLines: Int
    }

    private static func score(_ lines: [String]) -> Score {
        let totalKeywords = ["totale", "importa", "total", "da pagare", "tot"]
        let hasTotal = lines.contains { line in
            let normalized = line.lowercased()
            return totalKeywords.contains { normalized.contains($0) }
        }
        let numeric = lines.filter { line in
            line.range(of: "\\d", options: .regularExpression) != nil
        }.count
        return Score(total: hasTotal, numericLines: numeric)
    }
}
