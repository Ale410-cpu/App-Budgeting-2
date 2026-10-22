#!/usr/bin/env python3
"""
Token audit — verifies that the UI layer follows the Budget Ledger design system.

Checks
  1. Every `var(--token)` reference in the renderer resolves to a defined token.
  2. No raw colour literals (hex / rgb / rgba) leak into component code.
  3. The dark and light themes expose the same semantic token names.

Usage:  python3 scripts/audit_tokens.py
Exit code 0 = clean, 1 = violations found.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RENDERER = ROOT / "src" / "renderer"

CSS_FILES = [RENDERER / "styles.css", RENDERER / "fonts.css"]
TSX_FILES = sorted(RENDERER.glob("*.tsx")) + sorted((RENDERER / "components").glob("*.tsx"))

# Colour inputs and accent presets legitimately hold raw hex (HTML colour pickers
# and the user's stored accent preference). They are data, not style.
ALLOWED_RAW = {
    "App.tsx",  # accent presets + <input type="color"> defaults
}

TOKEN_DEF = re.compile(r"(--[a-zA-Z0-9-]+)\s*:")
TOKEN_REF = re.compile(r"var\(\s*(--[a-zA-Z0-9-]+)")
RAW_COLOR = re.compile(r"(#[0-9a-fA-F]{3,8}\b|rgba?\()")


def defined_tokens() -> set[str]:
    tokens: set[str] = set()
    for css in CSS_FILES:
        tokens |= set(TOKEN_DEF.findall(css.read_text(encoding="utf-8")))
    return tokens


def _blocks(css: str) -> list[tuple[str, str]]:
    """Return (selector, body) for every top-level block in the stylesheet."""
    out: list[tuple[str, str]] = []
    for match in re.finditer(r"([^{}]+)\{", css):
        selector = match.group(1).strip().splitlines()[-1].strip()
        depth, i = 1, match.end()
        while i < len(css) and depth:
            if css[i] == "{":
                depth += 1
            elif css[i] == "}":
                depth -= 1
            i += 1
        out.append((selector, css[match.end() : i - 1]))
    return out


def theme_tokens() -> tuple[set[str], set[str]]:
    """Semantic token names declared in the dark :root and in :root.light-theme."""
    css = (RENDERER / "styles.css").read_text(encoding="utf-8")
    dark: set[str] = set()
    light: set[str] = set()
    for selector, body in _blocks(css):
        names = set(TOKEN_DEF.findall(body))
        if selector == ":root.light-theme":
            light |= names
        elif selector == ":root" and "color-scheme: dark" in body:
            dark |= names
    return dark, light


def main() -> int:
    violations = 0
    tokens = defined_tokens()

    # 1. unresolved references
    unresolved: dict[str, set[str]] = {}
    for path in CSS_FILES + TSX_FILES:
        text = path.read_text(encoding="utf-8")
        for ref in TOKEN_REF.findall(text):
            if ref not in tokens:
                unresolved.setdefault(ref, set()).add(path.name)

    if unresolved:
        violations += 1
        print("[FAIL] Undefined token references:")
        for name, files in sorted(unresolved.items()):
            print(f"  {name} <- {', '.join(sorted(files))}")
    else:
        print(f"[ OK ] {len(tokens)} tokens defined, all var() references resolve")

    # 2. raw colour literals in component code
    leaks: dict[str, list[int]] = {}
    for path in TSX_FILES:
        if path.name in ALLOWED_RAW:
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if RAW_COLOR.search(line) and "var(--" not in line:
                leaks.setdefault(path.name, []).append(lineno)

    if leaks:
        violations += 1
        print("[FAIL] Raw colour literals in component code:")
        for name, lines in sorted(leaks.items()):
            print(f"  {name}: lines {', '.join(map(str, lines[:12]))}")
    else:
        print("[ OK ] No raw colour literals in component code")

    # 3. theme parity — the light theme may only override existing semantic names
    dark, light = theme_tokens()
    light_only = sorted(light - dark)
    if light_only:
        violations += 1
        print("[FAIL] Light theme declares tokens that the dark theme does not:")
        print(f"  {', '.join(light_only)}")
    else:
        print(
            f"[ OK ] Light theme overrides {len(light)} of {len(dark)} semantic tokens, no unknown names"
        )

    print("\nResult:", "FAIL" if violations else "PASS")
    return 1 if violations else 0


if __name__ == "__main__":
    sys.exit(main())
