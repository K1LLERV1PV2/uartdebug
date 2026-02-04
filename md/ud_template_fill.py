#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UartDebug: template -> C-file filler

Reads:
  1) Process template file (directives starting with $)
  2) Project file (window-project text)
  3) C source/skeleton with markup blocks like:
        //`V+ ... 
        //`V-
        //`H+ ...
        //`H-
        //`C+ ...
        //`C-
        //`I+ ...
        //`I-

Generates code from template (with placeholder substitution) and inserts it
between the markup markers.

Template directives (based on шаблоны.md):
  $V <ver> <name>               - template header (metadata)
  $N A|B|C                      - aliases (process names)
  $D <device>                   - MCU/device name (metadata)
  $S @VAR V1|V2|V3 [def] ["lbl"] - enum parameter definition
  $S+ @BLOCK ... $S- @BLOCK     - conditional/multi-line snippet, lines can start with ?COND
  $P <text>                     - lines for P section (user choices/conditions)
  $H <text>                     - include section line
  $I <text>                     - init-calls section line (inside main)
  $C+ ... $C-                   - functions/code block (outside main)

Placeholders:
  Any token like @NAME inside $C+, $H, $D, $I sections will be replaced:
    @USART -> USART1
  Snippet placeholders (defined by $S+ ... $S-) can be used as a whole line:
    @TXD_LOCATION
  Conditional snippet line syntax inside $S+ blocks:
    ?USART0 PORTB.DIRSET |= PIN2_bm;

Project file parameters (based on шаблоны.md):
  <InstanceName> <ProcessType>
      AnyKey - VALUE // comment
      AnyKey2 - VALUE2
  "Hello World!" -> InstanceName   (work-part start, ignored here)

Mapping strategy for project params:
  - Prefer matching VALUE to allowed enum values from $S lines.
  - If project key contains @VAR, use it directly.
  - Defaults from template are applied when a value is missing.

Usage:
  python ud_template_fill.py --template usart.tpl --project project.ud --c-in main.c --c-out main_gen.c
  python ud_template_fill.py --template usart.tpl --project project.ud --c-in main.c --c-out main_gen.c --instance MyPORT

"""

from __future__ import annotations

import argparse
import datetime as _dt
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


# =========================
# Template data structures
# =========================

@dataclass
class ParamDef:
    name: str
    values: List[str] = field(default_factory=list)
    default_index: Optional[int] = None
    label: Optional[str] = None


@dataclass
class Template:
    version: Optional[str] = None
    name: Optional[str] = None
    aliases: List[str] = field(default_factory=list)
    device: Optional[str] = None

    params: Dict[str, ParamDef] = field(default_factory=dict)
    blocks: Dict[str, List[str]] = field(default_factory=dict)  # '@TXD_LOCATION' -> raw lines inside $S+ ... $S-

    # output sections for insertion into C blocks
    sections: Dict[str, List[str]] = field(default_factory=lambda: {k: [] for k in ["P", "D", "H", "C", "I"]})


# =========================
# Parsing: template
# =========================

def parse_template(text: str) -> Template:
    t = Template()
    lines = text.splitlines()

    state: Optional[str] = None  # None | 'C' | 'S+'
    current_block: Optional[str] = None

    for raw in lines:
        line = raw.rstrip("\n")
        stripped = line.strip()

        if state == "C":
            if stripped.startswith("$C-"):
                state = None
                continue
            t.sections["C"].append(line)
            continue

        if state == "S+":
            if stripped.startswith("$S-"):
                state = None
                current_block = None
                continue
            assert current_block is not None
            t.blocks[current_block].append(line)
            continue

        if not stripped:
            continue

        # ---- directives
        if stripped.startswith("$V "):
            parts = stripped.split(maxsplit=2)
            if len(parts) >= 2:
                t.version = parts[1]
            if len(parts) >= 3:
                t.name = parts[2].strip()
            continue

        if stripped.startswith("$N "):
            aliases = stripped[3:].strip()
            t.aliases = [a.strip() for a in aliases.split("|") if a.strip()]
            continue

        if stripped.startswith("$D "):
            # device name (metadata); define lines can be put here too
            rest = stripped[3:].strip()
            if rest.startswith("#") or rest.startswith("//#") or "define" in rest:
                t.sections["D"].append(rest)
            else:
                t.device = rest
            continue

        if stripped.startswith("$S+"):
            m = re.match(r'^\$S\+\s+(@\w+)\s*$', stripped)
            if not m:
                raise ValueError(f"Bad $S+ line: {line}")
            current_block = m.group(1)
            t.blocks[current_block] = []
            state = "S+"
            continue

        if stripped.startswith("$S "):
            rest = stripped[3:].strip()
            m = re.match(r'^(@\w+)\s+([^\s"]+)(?:\s+(\d+))?(?:\s+"([^"]+)")?', rest)
            if not m:
                raise ValueError(f"Bad $S line: {line}")
            name, vals, default, label = m.group(1), m.group(2), m.group(3), m.group(4)
            pd = ParamDef(
                name=name,
                values=[v.strip() for v in vals.split("|") if v.strip()],
                default_index=int(default) if default else None,
                label=label,
            )
            t.params[name] = pd
            continue

        if stripped.startswith("$P "):
            t.sections["P"].append(line.split("$P", 1)[1].lstrip())
            continue

        if stripped.startswith("$H "):
            t.sections["H"].append(line.split("$H", 1)[1].lstrip())
            continue

        if stripped.startswith("$I "):
            t.sections["I"].append(line.split("$I", 1)[1].lstrip())
            continue

        if stripped.startswith("$C+"):
            # allow remainder after $C+ on the same line
            state = "C"
            rem = line.split("$C+", 1)[1]
            if rem.strip():
                t.sections["C"].append(rem.rstrip())
            continue

        # ---- fallback: any other text before $C+ goes into D section (defines/notes)
        t.sections["D"].append(line)

    return t


# =========================
# Parsing: project
# =========================

_INSTANCE_RE = re.compile(r'^\s*([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*$')
_PARAM_RE = re.compile(r'^\s*(.*?)\s*-\s*(.*?)\s*$')


def parse_project_params(
    project_text: str,
    template: Template,
    *,
    instance: Optional[str] = None,
) -> Dict[str, str]:
    """
    Extract params for one process instance that matches template aliases.
    Returns mapping like: {'@USART': 'USART1', '@USART_LOCATION': 'USART_LOCATION_DEFAULT'}
    """
    lines = project_text.splitlines()

    # Find candidate instances
    blocks: List[Tuple[str, str, int, int]] = []  # (inst, type, start_line, end_line_excl)
    i = 0
    while i < len(lines):
        raw = lines[i]
        s = raw.strip()
        if not s or s.startswith("//"):
            i += 1
            continue
        if "->" in s:
            break  # work-part starts

        m = _INSTANCE_RE.match(raw)
        if m:
            inst, ptype = m.group(1), m.group(2)
            start = i + 1
            j = start
            while j < len(lines):
                sj = lines[j].strip()
                if not sj or sj.startswith("//"):
                    j += 1
                    continue
                if "->" in sj:
                    break
                # next instance header?
                m2 = _INSTANCE_RE.match(lines[j])
                if m2:
                    break
                j += 1
            blocks.append((inst, ptype, start, j))
            i = j
        else:
            i += 1

    # choose block
    aliases = set(template.aliases) if template.aliases else set()
    chosen = None
    for inst, ptype, start, end in blocks:
        if instance and inst != instance:
            continue
        if aliases and ptype not in aliases:
            continue
        chosen = (inst, ptype, start, end)
        break

    if chosen is None:
        # fallback: first block if user forced instance
        if instance:
            for inst, ptype, start, end in blocks:
                if inst == instance:
                    chosen = (inst, ptype, start, end)
                    break
        if chosen is None:
            raise ValueError("Cannot find matching instance in project file (by template aliases / instance name).")

    inst, ptype, start, end = chosen

    # parse params
    selected: Dict[str, str] = {}
    for k in range(start, end):
        raw = lines[k]
        s = raw.strip()
        if not s or s.startswith("//"):
            continue
        # strip comment
        s = s.split("//", 1)[0].strip()
        if not s:
            continue
        pm = _PARAM_RE.match(s)
        if not pm:
            continue
        key_raw, value_raw = pm.group(1).strip(), pm.group(2).strip()
        if not value_raw:
            continue

        # 1) if key contains @VAR, use it directly
        m_var = re.search(r'(@\w+)', key_raw)
        if m_var and m_var.group(1) in template.params:
            selected[m_var.group(1)] = value_raw
            continue

        # 2) match by VALUE membership in enum lists
        candidates = [p.name for p in template.params.values() if value_raw in p.values]
        if len(candidates) == 1:
            selected[candidates[0]] = value_raw
            continue
        if len(candidates) > 1:
            # disambiguate by label or by key similarity
            key_norm = re.sub(r'\s+', ' ', key_raw).lower()
            best = None
            for cand in candidates:
                pd = template.params[cand]
                # match "@USART" with "USART" / "usart"
                if cand.lower().strip("@") in key_norm.replace(" ", ""):
                    best = cand
                    break
                if pd.label and pd.label.lower() in key_norm:
                    best = cand
                    break
            if best:
                selected[best] = value_raw
            continue

        # 3) otherwise ignore (unknown to this template)

    # apply defaults if missing
    for name, pd in template.params.items():
        if name in selected:
            continue
        if pd.default_index is not None and 0 <= pd.default_index < len(pd.values):
            selected[name] = pd.values[pd.default_index]
        elif pd.values:
            selected[name] = pd.values[0]

    return selected


# =========================
# Rendering / substitution
# =========================

_PLACEHOLDER_RE = re.compile(r'@([A-Z0-9_]+)')  # placeholders are assumed UPPERCASE/underscore


def _build_replacements(template: Template, selected: Dict[str, str]) -> Dict[str, str]:
    repl = dict(selected)

    selected_values = set(selected.values())

    # compute snippet blocks ($S+ ... $S-)
    for blk_name, raw_lines in template.blocks.items():
        out_lines: List[str] = []
        for l in raw_lines:
            m = re.match(r'^\s*\?(\S+)\s+(.*)$', l)
            if m:
                cond, code = m.group(1), m.group(2)
                if cond in selected_values:
                    out_lines.append(code)
            else:
                out_lines.append(l)
        repl[blk_name] = "\n".join(out_lines).rstrip()

    return repl


def _replace_placeholders_in_lines(lines: List[str], repl: Dict[str, str]) -> List[str]:
    multiline_keys = {k for k, v in repl.items() if "\n" in v}
    out: List[str] = []

    for line in lines:
        stripped = line.strip()

        # Whole-line snippet replacement: "@TXD_LOCATION"
        m_whole = re.fullmatch(r'@([A-Z0-9_]+)', stripped)
        if m_whole:
            key = "@" + m_whole.group(1)
            if key in repl and key in multiline_keys:
                indent = re.match(r'^(\s*)', line).group(1)
                for sl in repl[key].split("\n"):
                    sl2 = _PLACEHOLDER_RE.sub(lambda m: repl.get("@" + m.group(1), "@" + m.group(1)), sl)
                    out.append(indent + sl2.lstrip())
                continue

        # Inline replacement inside a line
        def sub_fn(m):
            key = "@" + m.group(1)
            return repl.get(key, "@" + m.group(1))

        out.append(_PLACEHOLDER_RE.sub(sub_fn, line))

    return out


def render_sections(template: Template, selected: Dict[str, str]) -> Dict[str, str]:
    repl = _build_replacements(template, selected)

    sections: Dict[str, str] = {}

    # V: auto header (inserted into //`V block)
    header_lines: List[str] = []
    if template.name:
        header_lines.append(f"// Template: {template.name}")
    if template.version:
        header_lines.append(f"// Template version: {template.version}")
    if template.device:
        header_lines.append(f"// Device: {template.device}")
    header_lines.append(f"// Generated: {_dt.datetime.now().isoformat(timespec='seconds')}")
    sections["V"] = "\n".join(header_lines).rstrip() + "\n"

    # P: keep template's param metadata, but update values in lines like "//$I @VAR VALUE"
    p_lines: List[str] = []
    for l in template.sections["P"]:
        m = re.search(r'(//\s*\$?I\s+)(@\w+)\s+(\S+)', l)
        if m:
            prefix, var, old = m.group(1), m.group(2), m.group(3)
            new_val = selected.get(var, old)
            l = l[: m.start()] + f"{prefix}{var} {new_val}" + l[m.end():]
        p_lines.append(l)

    p_lines.append("// --- Selected parameters ---")
    for k in sorted(selected.keys()):
        p_lines.append(f"// {k} = {selected[k]}")
    sections["P"] = "\n".join(p_lines).rstrip() + "\n"

    # D/H/C/I: apply placeholder substitution
    for sec in ["D", "H", "C", "I"]:
        lns = _replace_placeholders_in_lines(list(template.sections[sec]), repl)
        sections[sec] = "\n".join(lns).rstrip() + ("\n" if lns else "")

    return sections


# =========================
# C skeleton filling
# =========================

def _find_marker_pairs(c_lines: List[str], tag: str) -> List[Tuple[int, int]]:
    start_re = re.compile(rf'^\s*//`{re.escape(tag)}\+(?=\s|$)')
    end_re = re.compile(rf'^\s*//`{re.escape(tag)}-(?=\s|$)')

    starts = [i for i, l in enumerate(c_lines) if start_re.search(l)]
    ends = [i for i, l in enumerate(c_lines) if end_re.search(l)]

    pairs: List[Tuple[int, int]] = []
    for s in starts:
        e = next((j for j in ends if j > s), None)
        if e is not None:
            pairs.append((s, e))

    # remove overlaps
    uniq: List[Tuple[int, int]] = []
    last_end = -1
    for s, e in pairs:
        if s > last_end:
            uniq.append((s, e))
            last_end = e
    return uniq


def fill_c_skeleton(c_text: str, sections: Dict[str, str]) -> str:
    lines = c_text.splitlines(keepends=True)

    main_idx: Optional[int] = None
    for i, l in enumerate(lines):
        if re.search(r'\bint\s+main\s*\(', l):
            main_idx = i
            break

    out_lines = lines[:]

    # order matters a bit (but not critical)
    for tag in ["V", "P", "D", "H", "C", "I"]:
        content = sections.get(tag, "")
        pairs = _find_marker_pairs(out_lines, tag)
        if not pairs:
            continue

        # choose pair: for C we want the one before main() (because inside while() there may be another //`C+)
        if tag == "C" and main_idx is not None:
            before_main = [p for p in pairs if p[0] < main_idx]
            s, e = before_main[0] if before_main else pairs[0]
        else:
            s, e = pairs[0]

        if not content.strip():
            new_block: List[str] = []
        else:
            if tag == "I":
                # indent with the same leading whitespace as the marker line
                indent = re.match(r'^(\s*)', out_lines[s]).group(1)
                new_block = []
                for ln in content.rstrip("\n").split("\n"):
                    if ln.strip():
                        new_block.append(indent + ln.lstrip() + "\n")
                    else:
                        new_block.append("\n")
            else:
                new_block = [ln + "\n" for ln in content.rstrip("\n").split("\n")]

        out_lines = out_lines[: s + 1] + new_block + out_lines[e:]

    return "".join(out_lines)


# =========================
# CLI
# =========================

def _read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _write_text(path: str, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="UartDebug template -> C filler")
    ap.add_argument("--template", required=True, help="Path to process template file")
    ap.add_argument("--project", required=True, help="Path to project file (window-project text)")
    ap.add_argument("--c-in", required=True, help="Path to input C file with markup markers")
    ap.add_argument("--c-out", required=True, help="Path to output C file")
    ap.add_argument("--instance", default=None, help="Instance name (e.g., MyPORT). If omitted, first matching by aliases is used.")
    ap.add_argument("--dump", action="store_true", help="Print rendered sections to stdout (debug)")

    args = ap.parse_args(argv)

    tpl = parse_template(_read_text(args.template))
    sel = parse_project_params(_read_text(args.project), tpl, instance=args.instance)
    sec = render_sections(tpl, sel)

    if args.dump:
        for k in ["V", "P", "D", "H", "C", "I"]:
            print(f"\n===== {k} =====")
            print(sec.get(k, ""))

    out = fill_c_skeleton(_read_text(args.c_in), sec)
    _write_text(args.c_out, out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
