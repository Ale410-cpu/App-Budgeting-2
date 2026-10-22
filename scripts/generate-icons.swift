#!/usr/bin/env swift
//
//  generate-icons.swift
//  Budget Ledger — app icon generator
//
//  Draws the app icon with CoreGraphics and writes every size the project
//  needs (macOS .icns, Electron builder source, favicons, PWA icons).
//
//  Design
//  ------
//  macOS "squircle" silhouette (superellipse, n = 5) in a deep navy gradient
//  with a teal glow, matching the app's design-system tokens
//  (--bg #08111f / --slate-800 #1e293b / --teal-400 #2dd4bf).
//  The mark is three ascending rounded bars — "budget, progress, growth" —
//  legible down to 16 px.
//
//  Usage:  swift scripts/generate-icons.swift
//  Requires: Xcode Command Line Tools. The generated assets are committed,
//           so building the app never needs Swift.
//

import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import AppKit

// MARK: - Configuration

let projectRoot = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let canvasSize: CGFloat = 1024

// macOS icon grid: the shape is inset so the optical size matches every other
// app in the Dock (this is what keeps the Dock tile the same size as others).
let inset: CGFloat = 100
let shapeRect = CGRect(x: inset, y: inset, width: canvasSize - inset * 2, height: canvasSize - inset * 2)

// MARK: - Helpers

func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha)
}

/// Continuous-corner (superellipse) path — the modern macOS icon silhouette.
func superellipse(in rect: CGRect, exponent n: CGFloat = 5, steps: Int = 1440) -> CGPath {
    let path = CGMutablePath()
    let a = rect.width / 2
    let b = rect.height / 2
    let power = 2 / n
    for i in 0...steps {
        let t = CGFloat(i) / CGFloat(steps) * 2 * .pi
        let ct = cos(t)
        let st = sin(t)
        let x = rect.midX + a * copysign(pow(abs(ct), power), ct)
        let y = rect.midY + b * copysign(pow(abs(st), power), st)
        if i == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
    }
    path.closeSubpath()
    return path
}

func makeContext(size: CGFloat) -> CGContext {
    CGContext(data: nil,
              width: Int(size), height: Int(size),
              bitsPerComponent: 8, bytesPerRow: 0,
              space: CGColorSpace(name: CGColorSpace.sRGB)!,
              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
}

/// Contesto senza canale alfa: iOS rifiuta le icone che hanno alpha,
/// anche se il canale e' completamente opaco.
func makeOpaqueContext(size: CGFloat) -> CGContext {
    CGContext(data: nil,
              width: Int(size), height: Int(size),
              bitsPerComponent: 8, bytesPerRow: 0,
              space: CGColorSpace(name: CGColorSpace.sRGB)!,
              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
}

/// Renders the icon at an arbitrary size so small sizes stay crisp.
func renderIcon(size: CGFloat) -> CGImage? {
    let ctx = makeContext(size: size)
    let scale = size / canvasSize
    ctx.scaleBy(x: scale, y: scale)
    ctx.setAllowsAntialiasing(true)
    ctx.interpolationQuality = .high

    let shape = superellipse(in: shapeRect)

    // 1. Base gradient (deep navy -> slate)
    ctx.saveGState()
    ctx.addPath(shape)
    ctx.clip()
    let base = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                          colors: [rgb(0x1B2A44), rgb(0x0A1120)] as CFArray,
                          locations: [0, 1])!
    ctx.drawLinearGradient(base,
                           start: CGPoint(x: shapeRect.minX, y: shapeRect.maxY),
                           end: CGPoint(x: shapeRect.maxX, y: shapeRect.minY),
                           options: [])

    // 2. Teal glow, upper-left
    let glow = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                          colors: [rgb(0x2DD4BF, 0.38), rgb(0x2DD4BF, 0)] as CFArray,
                          locations: [0, 1])!
    ctx.drawRadialGradient(glow,
                           startCenter: CGPoint(x: shapeRect.midX - 40, y: shapeRect.midY + 150),
                           startRadius: 0,
                           endCenter: CGPoint(x: shapeRect.midX - 40, y: shapeRect.midY + 150),
                           endRadius: 560,
                           options: [])
    ctx.restoreGState()

    // 3. Light reflection along the top edge (glass effect)
    ctx.saveGState()
    ctx.addPath(shape)
    ctx.clip()
    let gloss = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                           colors: [rgb(0xFFFFFF, 0.22), rgb(0xFFFFFF, 0)] as CFArray,
                           locations: [0, 1])!
    ctx.drawLinearGradient(gloss,
                           start: CGPoint(x: shapeRect.midX, y: shapeRect.maxY),
                           end: CGPoint(x: shapeRect.midX, y: shapeRect.midY + 120),
                           options: [])
    ctx.restoreGState()

    // 4. Hairline border so the tile reads crisply on light and dark docks
    ctx.saveGState()
    ctx.addPath(shape)
    ctx.setStrokeColor(rgb(0xFFFFFF, 0.14))
    ctx.setLineWidth(3)
    ctx.strokePath()
    ctx.restoreGState()

    // 5. Mark: three ascending rounded bars
    let barWidth: CGFloat = 120
    let gap: CGFloat = 40
    let baseline: CGFloat = 240
    let heights: [CGFloat] = [240, 390, 520]
    let gradients: [(UInt32, UInt32)] = [
        (0x2DD4BF, 0x0D9488),
        (0x5EEAD4, 0x14B8A6),
        (0x99F6E4, 0x2DD4BF)
    ]
    let totalWidth = barWidth * 3 + gap * 2
    var x = shapeRect.midX - totalWidth / 2

    for (index, height) in heights.enumerated() {
        let rect = CGRect(x: x, y: baseline, width: barWidth, height: height)
        let path = CGPath(roundedRect: rect, cornerWidth: barWidth / 2, cornerHeight: barWidth / 2, transform: nil)
        ctx.saveGState()
        ctx.addPath(path)
        ctx.clip()
        let (top, bottom) = gradients[index]
        let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  colors: [rgb(top), rgb(bottom)] as CFArray,
                                  locations: [0, 1])!
        ctx.drawLinearGradient(gradient,
                               start: CGPoint(x: rect.midX, y: rect.maxY),
                               end: CGPoint(x: rect.midX, y: rect.minY),
                               options: [])
        ctx.restoreGState()
        x += barWidth + gap
    }

    return ctx.makeImage()
}

/// Draws the icon on an opaque background (for iOS / apple-touch-icon).
func renderOpaqueIcon(size: CGFloat) -> CGImage? {
    guard let image = renderIcon(size: size) else { return nil }
    let ctx = makeOpaqueContext(size: size)
    ctx.setFillColor(rgb(0x0A1120))
    ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
    return ctx.makeImage()
}

func writePNG(_ image: CGImage, to url: URL) {
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        print("⚠️  Could not create \(url.path)")
        return
    }
    CGImageDestinationAddImage(dest, image, nil)
    if CGImageDestinationFinalize(dest) {
        print("✓  \(url.path)")
    }
}

func fileSize(_ url: URL) -> Int {
    let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
    return (attributes?[.size] as? Int) ?? 0
}

// MARK: - Generate

print("▸ Rendering icon…")

// --- macOS iconset -> iconutil -> .icns ---
let iconset = projectRoot.appendingPathComponent("build/icon.iconset")
try? FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

let iconsetEntries: [(name: String, size: CGFloat, opaque: Bool)] = [
    ("icon_16x16.png", 16, false),
    ("icon_16x16@2x.png", 32, false),
    ("icon_32x32.png", 32, false),
    ("icon_32x32@2x.png", 64, false),
    ("icon_128x128.png", 128, false),
    ("icon_128x128@2x.png", 256, false),
    ("icon_256x256.png", 256, false),
    ("icon_256x256@2x.png", 512, false),
    ("icon_512x512.png", 512, false),
    ("icon_512x512@2x.png", 1024, false)
]

for entry in iconsetEntries {
    if let image = renderIcon(size: entry.size) {
        writePNG(image, to: iconset.appendingPathComponent(entry.name))
    }
}

// --- Build sources (electron-builder) ---
if let image = renderIcon(size: 1024) {
    writePNG(image, to: projectRoot.appendingPathComponent("build/icon.png"))
}
if let image = renderIcon(size: 512) {
    writePNG(image, to: projectRoot.appendingPathComponent("build/icon-512.png"))
}

// --- Public assets (web / PWA / favicons) ---
if let image = renderIcon(size: 512) {
    writePNG(image, to: projectRoot.appendingPathComponent("public/icon.png"))
}
if let image = renderIcon(size: 512) {
    writePNG(image, to: projectRoot.appendingPathComponent("public/icon-512.png"))
}
if let image = renderIcon(size: 192) {
    writePNG(image, to: projectRoot.appendingPathComponent("public/icon-192.png"))
}
if let image = renderIcon(size: 32) {
    writePNG(image, to: projectRoot.appendingPathComponent("public/favicon-32x32.png"))
}
if let image = renderIcon(size: 16) {
    writePNG(image, to: projectRoot.appendingPathComponent("public/favicon-16x16.png"))
}
if let image = renderOpaqueIcon(size: 180) {
    writePNG(image, to: projectRoot.appendingPathComponent("public/apple-touch-icon.png"))
}

// --- Electron runtime icon (dock + window) ---
if let image = renderIcon(size: 512) {
    writePNG(image, to: projectRoot.appendingPathComponent("electron/icon.png"))
}

// --- iOS app icon (opaque: iOS rifiuta le icone con canale alfa) ---
if let image = renderOpaqueIcon(size: 1024) {
    writePNG(image, to: projectRoot.appendingPathComponent("ios/BudgetApp/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"))
}

// --- Compile the .icns ---
let icnsURL = projectRoot.appendingPathComponent("build/icon.icns")
let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
process.arguments = ["-c", "icns", iconset.path, "-o", icnsURL.path]
try? process.run()
process.waitUntilExit()
if process.terminationStatus == 0 {
    print("✓  \(icnsURL.path) (\(fileSize(icnsURL)) bytes)")
} else {
    print("⚠️  iconutil failed (status \(process.terminationStatus))")
}

try? FileManager.default.removeItem(at: iconset)

print("✔ Icon assets generated.")
