#!/usr/bin/env swift
//
//  receipt-ocr.swift
//  Riconoscimento del testo di uno scontrino (Apple Vision, on-device).
//
//  Uso:  swift scripts/receipt-ocr.swift <percorso-immagine>
//  Output (JSON su stdout):  { "lines": [...], "text": "..." }
//
//  Non richiede rete e non usa dati esterni: il testo resta sul dispositivo.
//  Viene invocato dal processo Electron (electron/main.cjs) quando l'utente
//  sceglie la foto di uno scontrino.
//

import Foundation
import Vision
import AppKit

func fail(_ message: String, code: Int32) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(code)
}

let arguments = CommandLine.arguments
guard arguments.count > 1 else {
    fail("Uso: receipt-ocr.swift <percorso-immagine>", code: 2)
}

let imagePath = arguments[1]
guard FileManager.default.fileExists(atPath: imagePath) else {
    fail("Immagine non trovata: \(imagePath)", code: 3)
}

guard let image = NSImage(contentsOfFile: imagePath),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fail("Impossibile leggere l'immagine: \(imagePath)", code: 4)
}

// Motore condiviso con la versione iOS (ReceiptOCR.swift): pre-elabora
// l'immagine e ricostruisce le righe usando le bounding box.
let lines = ReceiptOCR.recognize(image: cgImage)

let payload: [String: Any] = [
    "lines": lines,
    "text": lines.joined(separator: "\n"),
]

guard let data = try? JSONSerialization.data(withJSONObject: payload),
      let json = String(data: data, encoding: .utf8) else {
    fail("Impossibile serializzare il risultato", code: 6)
}

print(json)
