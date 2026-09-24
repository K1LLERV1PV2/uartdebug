#!/usr/bin/env python3
"""Rebuild the offline reference corpus from hash-locked original documents.

No network access. Requires requirements.txt in this directory. PDF text/table
extraction is reference data, not reviewed programming advice. Only the separate
reviewed-facts.json can promote a fact after source/layout review.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

import pdfplumber
import pypdf
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
BUNDLE = ROOT / "backend/ai/knowledge/attiny162x/1.1.0"
REFERENCE = BUNDLE / "reference"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalize(text):
    return re.sub(r"[^\S\n]+", " ", text.replace("\u00ad", "")).strip()


def checked_source(source):
    target = (BUNDLE / source["file"]).resolve()
    if not target.is_relative_to(REFERENCE / "raw"):
        raise ValueError("Source path escapes raw archive")
    data = target.read_bytes()
    if len(data) != source["bytes"] or digest(data) != source["sha256"]:
        raise ValueError(f"Source integrity mismatch: {target.name}")
    return target


def sections_from_outline(reader, document_id):
    sections = []

    def walk(items, level=1):
        for item in items:
            if isinstance(item, list):
                walk(item, level + 1)
            else:
                page = reader.get_destination_page_number(item)
                if page is not None:
                    sections.append({
                        "id": f"{document_id}-s{len(sections) + 1:04}",
                        "title": normalize(item.title), "level": level,
                        "startPage": page + 1,
                    })

    walk(reader.outline)
    for index, section in enumerate(sections):
        # Shared boundary pages intentionally belong to both sections. A PDF
        # page can contain the end of one section and the next heading.
        section["endPage"] = next((other["startPage"] for other in sections[index + 1:]
                                   if other["level"] <= section["level"]), len(reader.pages))
    return sections


def features(page, text):
    lines = text.splitlines()
    tables = []
    for table in page.find_tables():
        rows = table.extract()
        if len(rows) < 2 or max((len(row) for row in rows), default=0) < 2:
            continue
        tables.append({
            "bbox": [round(float(n), 2) for n in table.bbox],
            "cells": [[normalize(cell or "") for cell in row] for row in rows],
            "verification": "unreviewed-layout",
        })
    captions = lambda kind: [line for line in lines if re.match(rf"^{kind}\s+\d+[.-]\d+", line, re.I)]
    # Candidates deliberately retain source text, rather than interpreting an
    # extracted fraction or bit diagram as an executable formula.
    formulas = [line for line in lines if re.search(r"\b(?:Equation|formula)\b|[A-Za-z0-9)]\s*=\s*[^=]", line)]
    constraints = [line for line in lines if re.search(r"\b(?:must|shall|must not|not supported|only when)\b", line, re.I)]
    return {
        "tables": tables, "tableCaptions": captions("Table"),
        "figures": [{"caption": caption, "verification": "requires-visual-review"} for caption in captions("Figure")],
        "formulas": [{"text": line, "verification": "candidate-not-validated"} for line in formulas],
        "constraints": [{"text": line, "verification": "candidate-read-surrounding-context"} for line in constraints],
    }


def extract_pdf(source):
    target = checked_source(source)
    reader = PdfReader(target)
    if len(reader.pages) != source["pageCount"]:
        raise ValueError("Unexpected PDF page count")
    sections = sections_from_outline(reader, source["documentId"])
    pages = []
    with pdfplumber.open(target) as pdf:
        for number, page in enumerate(pdf.pages, 1):
            text = normalize(page.extract_text(x_tolerance=2, y_tolerance=3) or "")
            pages.append({
                "page": number, "text": text,
                "sectionIds": [s["id"] for s in sections if s["startPage"] <= number <= s["endPage"]],
                "features": features(page, text),
            })
            page.close()
            if number % 50 == 0:
                print(f"{source['documentId']}: {number}/{len(reader.pages)} pages", flush=True)
    return {
        "id": source["documentId"], "sourceId": source["id"], "title": source["title"],
        "revision": source["revision"], "sourceFile": source["file"], "sourceUrl": source["url"],
        "sha256": source["sha256"], "pageCount": len(pages),
        "verification": "machine-extracted-reference", "sections": sections, "pages": pages,
    }


def extract_dfp(source):
    devices = []
    with zipfile.ZipFile(checked_source(source)) as archive:
        for mcu in ["ATtiny1624", "ATtiny1626", "ATtiny1627"]:
            atdf_member = f"atdf/{mcu}.atdf"
            header_member = f"xc8/avr/include/avr/iotn{mcu[6:]}.h"
            atdf = archive.read(atdf_member)
            root = ET.fromstring(atdf)
            instances = [{**instance.attrib, "module": module.get("name"),
                          "registerGroups": [group.attrib for group in instance.findall("register-group")]}
                         for module in root.findall("./devices/device/peripherals/module")
                         for instance in module.findall("instance")]
            modules = []
            for module in root.findall("./modules/module"):
                groups = []
                for group in module.findall("register-group"):
                    registers = []
                    for reg in group.findall("register"):
                        registers.append({**reg.attrib, "bitfields": [field.attrib for field in reg.findall("bitfield")]})
                    groups.append({**group.attrib, "registers": registers,
                                   "modes": [mode.attrib for mode in group.findall("mode")],
                                   "subgroups": [sub.attrib for sub in group.findall("register-group")]})
                modules.append({**module.attrib, "registerGroups": groups,
                                "valueGroups": [{**group.attrib, "values": [value.attrib for value in group.findall("value")]}
                                                for group in module.findall("value-group")]})
            devices.append({
                "mcu": mcu, "atdfMember": atdf_member, "atdfSha256": digest(atdf),
                "headerMember": header_member, "headerSha256": digest(archive.read(header_member)),
                "instances": instances, "modules": modules,
            })
    return {"schemaVersion": 1, "sourceId": source["id"], "sourceUrl": source["url"], "packSha256": source["sha256"],
            "verification": "extracted-atdf-attributes-not-silicon-behavior", "devices": devices}


def save(name, value, verify):
    data = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    target = REFERENCE / name
    if verify:
        if target.read_bytes() != data:
            raise ValueError(f"Generated reference drift: {name}")
    else:
        target.write_bytes(data)
    print(f"{'Verified' if verify else 'Wrote'} {name}: {len(data)} bytes", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--dfp-only", action="store_true", help="Rebuild/check only the DFP register extraction")
    args = parser.parse_args()
    if (pypdf.__version__, pdfplumber.__version__) != ("6.10.0", "0.11.9"):
        raise ValueError("Install the pinned requirements.txt versions before reproducing this corpus")
    sources = json.loads((REFERENCE / "sources.json").read_text(encoding="utf-8"))["sources"]
    if args.dfp_only:
        save("dfp-registers.json", extract_dfp(next(source for source in sources if source["kind"] == "dfp")), args.verify)
        return
    corpus = {"schemaVersion": 1, "extraction": {
        "method": "PDF bookmarks and per-page pdfplumber text/grid extraction",
        "pypdf": "6.10.0", "pdfplumber": "0.11.9", "pageNumbering": "one-based physical PDF page",
        "notice": "Complete page coverage is not complete semantic verification. Tables, formulas and figures need source/layout review. Reviewed facts are stored separately.",
    }, "documents": [extract_pdf(source) for source in sources if source["kind"] == "pdf"]}
    save("corpus.json", corpus, args.verify)
    save("dfp-registers.json", extract_dfp(next(source for source in sources if source["kind"] == "dfp")), args.verify)


if __name__ == "__main__":
    main()
