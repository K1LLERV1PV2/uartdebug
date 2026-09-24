#!/usr/bin/env python3
"""Read-only semantic check of selected device-header constants against a pack.

python scripts/avr-knowledge/compare-installed.py --headers /copied/installed/headers --pack /path/3.4.278.atpack
Does not compile or modify the installed pack. Expressions use a limited AST evaluator.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[2]
FACTS = ROOT / "backend/ai/knowledge/attiny162x/1.1.0/devices.json"


def definitions(text):
    result = {}
    for line in text.splitlines():
        match = re.match(r"\s*#define\s+(\w+)\s+(.+?)(?:\s*/\*|$)", line) or re.match(r"\s*(\w+)\s*=\s*(.+?)(?:,?\s*/\*|$)", line)
        if match:
            result[match[1]] = match[2].strip().rstrip(",")
    return result


def value(expression, symbols, seen=frozenset()):
    expression = re.sub(r"\b(0x[0-9a-fA-F]+|[0-9]+)[uUlL]+\b", r"\1", expression)
    def visit(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, int):
            return node.value
        if isinstance(node, ast.Name) and node.id not in seen:
            return value(symbols[node.id], symbols, seen | {node.id})
        if isinstance(node, ast.BinOp):
            left, right = visit(node.left), visit(node.right)
            if isinstance(node.op, ast.LShift): return left << right
            if isinstance(node.op, ast.RShift): return left >> right
            if isinstance(node.op, ast.BitOr): return left | right
            if isinstance(node.op, ast.BitAnd): return left & right
            if isinstance(node.op, ast.Add): return left + right
            if isinstance(node.op, ast.Sub): return left - right
        raise ValueError(f"Expression outside comparison scope: {expression}")
    return visit(ast.parse(expression, mode="eval").body)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--headers", required=True, type=Path)
    parser.add_argument("--pack", required=True, type=Path)
    args = parser.parse_args()
    facts = json.loads(FACTS.read_text())
    if hashlib.sha256(args.pack.read_bytes()).hexdigest() != facts["packSha256"]:
        raise ValueError("Source pack does not match the pinned facts")
    report = {"scope": "Selected symbols only; exact expressions or evaluated integer constant values. Not a full header/ABI comparison or hardware check.", "devices": []}
    with zipfile.ZipFile(args.pack) as source:
        for device in facts["devices"]:
            member = device["provenance"]["header"]["member"]
            original = args.headers / Path(member).name
            old = definitions(original.read_text())
            new = definitions(source.read(member).decode())
            selected = device["cSymbols"]
            shared = sorted(set(selected) & set(old))
            exact, equivalent, different = [], [], []
            for name in shared:
                if old[name] == new[name]: exact.append(name)
                elif value(old[name], old) == value(new[name], new): equivalent.append(name)
                else: different.append(name)
            report["devices"].append({"mcu": device["mcu"],
                "installedHeaderSha256": hashlib.sha256(original.read_bytes()).hexdigest(),
                "selectedCount": len(selected), "sharedCount": len(shared),
                "identicalExpressionCount": len(exact), "equivalentValueCount": len(equivalent),
                "differentValues": different, "missingFromInstalled": sorted(set(selected) - set(old))})
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
