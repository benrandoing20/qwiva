"""
Corpus manifest — read/write the JSON registry of all ingested documents.

The manifest is the single source of truth for what should be in the index.
Run the pipeline with --manifest corpus-manifest.json to sync to that spec.
"""

from __future__ import annotations

import json
from pathlib import Path

_MANIFEST_TEMPLATE = {
    "guidelines": [],
    "drugs": [],
}


def load_manifest(path: str) -> dict:
    """Load and return the manifest JSON. Creates an empty one if missing."""
    p = Path(path)
    if not p.exists():
        save_manifest(_MANIFEST_TEMPLATE, path)
        return dict(_MANIFEST_TEMPLATE)
    with p.open() as f:
        return json.load(f)


def save_manifest(manifest: dict, path: str) -> None:
    """Write the manifest back to disk (pretty-printed)."""
    with open(path, "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")


def add_guideline(manifest: dict, entry: dict) -> dict:
    """Add or update a guideline entry keyed by guideline_id."""
    guidelines = manifest.setdefault("guidelines", [])
    idx = next((i for i, g in enumerate(guidelines) if g.get("guideline_id") == entry["guideline_id"]), None)
    if idx is not None:
        guidelines[idx] = entry
    else:
        guidelines.append(entry)
    return manifest


def add_drug(manifest: dict, entry: dict) -> dict:
    """Add or update a drug entry keyed by inn."""
    drugs = manifest.setdefault("drugs", [])
    idx = next((i for i, d in enumerate(drugs) if d.get("inn") == entry["inn"]), None)
    if idx is not None:
        drugs[idx] = entry
    else:
        drugs.append(entry)
    return manifest
