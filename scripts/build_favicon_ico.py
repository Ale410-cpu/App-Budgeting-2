#!/usr/bin/env python3
"""
Builds `public/favicon.ico` from the PNG sources rendered by
`scripts/generate-icons.swift`.

The ICO container is written with PNG-compressed entries (supported by every
modern browser). Icons are embedded at 16, 32, 48 and 64 px.

Usage:  python3 scripts/build_favicon_ico.py
"""
from __future__ import annotations

import struct
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "build" / "icon.png"
TARGET = ROOT / "public" / "favicon.ico"
SIZES = (16, 32, 48, 64)


def render(size: int) -> bytes:
    """Renders the source icon at `size` px and returns the PNG bytes."""
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        out = Path(tmp.name)
    try:
        subprocess.run(
            ["sips", "-z", str(size), str(size), str(SOURCE), "--out", str(out)],
            check=True,
            capture_output=True,
        )
        return out.read_bytes()
    finally:
        out.unlink(missing_ok=True)


def main() -> int:
    if not SOURCE.exists():
        print(f"❌ Missing {SOURCE}. Run: swift scripts/generate-icons.swift")
        return 1

    images = [(size, render(size)) for size in SIZES]

    # ICONDIR
    header = struct.pack("<HHH", 0, 1, len(images))
    # ICONDIRENTRY (16 bytes each)
    entries = b""
    offset = 6 + 16 * len(images)
    for size, data in images:
        entries += struct.pack(
            "<BBBBHHII",
            size if size < 256 else 0,  # width  (0 = 256)
            size if size < 256 else 0,  # height (0 = 256)
            0,                           # palette colours
            0,                           # reserved
            1,                           # colour planes
            32,                          # bits per pixel
            len(data),                   # image size
            offset,                      # image offset
        )
        offset += len(data)

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_bytes(header + entries + b"".join(data for _, data in images))
    print(f"✓ {TARGET} ({TARGET.stat().st_size} bytes, sizes: {', '.join(str(s) for s in SIZES)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
