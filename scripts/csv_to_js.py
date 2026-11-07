#!/usr/bin/env python3
"""Rebuild data/clients.js (the built-in copy used when index.html is opened by double-click)
from data/clients.csv. Run after editing the CSV:   python3 scripts/csv_to_js.py
"""
import json
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
csv_text = (root / "data" / "clients.csv").read_text(encoding="utf-8-sig")
(root / "data" / "clients.js").write_text(
    "// Generated from data/clients.csv by scripts/csv_to_js.py. Do not edit by hand.\n"
    f"window.KYC_SAMPLE_CSV = {json.dumps(csv_text)};\n",
    encoding="utf-8",
)
print(f"Wrote data/clients.js ({len(csv_text.splitlines()) - 1} clients)")
