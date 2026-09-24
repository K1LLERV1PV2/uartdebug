#!/usr/bin/env python3
"""Reproduce the selected ATtiny162x DFP facts from the pinned local archive.

python scripts/avr-knowledge/snapshot.py --pack /path/Microchip.ATtiny_DFP.3.4.278.atpack
python scripts/avr-knowledge/snapshot.py --download --verify
Only --download uses the network. --verify never changes tracked snapshots.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "backend/ai/knowledge/attiny162x/1.3.0"
PACK_URL = "https://packs.download.microchip.com/Microchip.ATtiny_DFP.3.4.278.atpack"
PACK_SHA256 = "41f09d5825abaa764c9000f4488f8ba3fab152afe6229b359de4a5efe9a21eda"
PACKAGES = {
    "ATtiny1624": {"DIP14": ["SOIC-14", "TSSOP-14"]},
    "ATtiny1626": {"DIP20": ["SOIC-20", "SSOP-20"], "QFP20": ["VQFN-20"]},
    "ATtiny1627": {"QFP24": ["VQFN-24"]},
}
# Semantic symbols used by the deliberately limited recipes. Keep enum dependencies
# as well: newer DFPs express _gc in terms of _gv and _gp.
SYMBOL = re.compile(r"^(?:PIN[0-7]_bm|CLKCTRL_(?:CLKSEL_OSC20M|PDIV_\w+|PEN|CLKOUT)_(?:gc|gv|gm|gp|bm)|PORT_(?:PULLUPEN|INVEN|ISC_\w+)_(?:gc|gv|gm|gp|bm)|PORTMUX_USART[01]_(?:DEFAULT|ALT1|NONE|g[mvp])(?:_g[cv])?|RTC_(?:CLKSEL_INT32K|PERIOD_CYC\d+|PITEN|PI|CTRLBUSY)_(?:gc|gv|gm|gp|bm)|TCA_SINGLE_(?:CLKSEL_\w+|WGMODE_NORMAL|ENABLE|OVF)_(?:gc|gv|gm|gp|bm)|USART_(?:CMODE_ASYNCHRONOUS|PMODE_DISABLED|CHSIZE_8BIT|SBMODE_1BIT|RXMODE_NORMAL|RXMODE_CLK2X|RXEN|TXEN|DREIE|DREIF|RXCIF|TXCIF|FERR|PERR|BUFOVF)_(?:gc|gv|gm|gp|bm)|(?:USART[01]_(?:DRE|RXC|TXC)|TCA0_OVF|RTC_PIT|PORT[ABC]_PORT)_vect(?:_num)?)$")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def dumps(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def extract(pack):
    data = Path(pack).read_bytes()
    if digest(data) != PACK_SHA256:
        raise ValueError("Pack digest differs from the reviewed 3.4.278 release; review before repinning")
    result = {"schemaVersion": 1, "sourceId": "microchip-attiny-dfp-3.4.278", "packSha256": digest(data), "devices": []}
    with zipfile.ZipFile(pack) as z:
        for name, aliases in PACKAGES.items():
            atdf_path = f"atdf/{name}.atdf"
            header_path = f"xc8/avr/include/avr/iotn{name[6:]}.h"
            atdf, header = z.read(atdf_path), z.read(header_path)
            root = ET.fromstring(atdf)
            dev = root.find("./devices/device")
            pins = {p.get("name"): {x.get("pad"): int(x.get("position")) for x in p.findall("pin")} for p in root.findall("./pinouts/pinout")}
            memory = {m.get("name"): {"bytes": int(m.get("size"), 0), "start": int(m.get("start"), 0)} for m in dev.findall("./address-spaces/address-space/memory-segment") if m.get("name") in ("PROGMEM", "INTERNAL_SRAM", "EEPROM")}
            symbols = {}
            for line in header.decode().splitlines():
                match = re.match(r"\s*#define\s+(\w+)\s+(.+?)(?:\s*/\*|$)", line) or re.match(r"\s*(\w+)\s*=\s*(.+?)(?:,?\s*/\*|$)", line)
                if match and SYMBOL.match(match[1]):
                    symbols[match[1]] = match[2].strip().rstrip(",")
            routes = {}
            for inst in dev.findall('./peripherals/module[@name="USART"]/instance'):
                instance = inst.get("name")
                field = root.find(f'./modules/module[@name="PORTMUX"]/register-group/register[@name="USARTROUTEA"]/bitfield[@name="{instance}"]')
                group = root.find(f'./modules/module[@name="PORTMUX"]/value-group[@name="PORTMUX_{instance}"]')
                route_entries = {}
                for value in group.findall("value"):
                    route = value.get("name")
                    if route == "NONE":
                        continue
                    function = instance if route == "DEFAULT" else instance + "_ALT"
                    signals = {s.get("group").lower(): s.get("pad") for s in inst.findall("./signals/signal") if s.get("function") == function}
                    assert signals.get("txd") and signals.get("rxd"), (name, instance, route)
                    mask = int(field.get("mask"), 0)
                    shift = (mask & -mask).bit_length() - 1
                    symbol = f"PORTMUX_{instance}_{route}_gc"
                    assert symbol in symbols, symbol
                    route_entries[route] = {"pins": signals, "symbol": symbol, "value": int(value.get("value"), 0) << shift}
                routes[instance] = {"register": "PORTMUX.USARTROUTEA", "maskSymbol": f"PORTMUX_{instance}_gm", "mask": int(field.get("mask"), 0), "routes": route_entries}
            registers = {}
            selected = {"CLKCTRL": {"MCLKCTRLA", "MCLKCTRLB"}, "PORT": {"DIR", "DIRSET", "DIRCLR", "OUT", "OUTSET", "OUTCLR", "OUTTGL", "IN", "INTFLAGS", "PIN0CTRL"}, "USART": {"RXDATAL", "RXDATAH", "TXDATAL", "STATUS", "CTRLA", "CTRLB", "CTRLC", "BAUD"}, "PORTMUX": {"USARTROUTEA"}}
            selected["RTC"] = {"CLKSEL", "PITCTRLA", "PITSTATUS", "PITINTCTRL", "PITINTFLAGS"}
            for module, register_names in selected.items():
                for reg in root.findall(f'./modules/module[@name="{module}"]/register-group/register'):
                    if reg.get("name") in register_names:
                        registers[f"{module}.{reg.get('name')}"] = {"offset": int(reg.get("offset"), 0), "bytes": int(reg.get("size"), 0), "access": reg.get("rw"), "reset": reg.get("initval"), "fields": {b.get("name"): b.get("mask") for b in reg.findall("bitfield")}}
            result["devices"].append({
                "mcu": name, "architecture": dev.get("architecture"), "family": dev.get("family"),
                "packages": [a for v in aliases.values() for a in v],
                "pinouts": {alias: {"dfpPinoutId": raw, "pins": pins[raw]} for raw, values in aliases.items() for alias in values},
                "memory": memory, "maxClockHz": 20000000,
                "uart": routes, "cSymbols": dict(sorted(symbols.items())), "registers": registers,
                "provenance": {"sourceId": result["sourceId"], "atdf": {"member": atdf_path, "sha256": digest(atdf)}, "header": {"member": header_path, "sha256": digest(header)}, "packageNormalization": "DFP pinout ids DIP14/DIP20/QFP20/QFP24 are internal labels; marketed packages are normalized using the official datasheet pinout table."},
            })
        return result, z.read("LICENSE.txt")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack", type=Path)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    pack = args.pack or (Path(tempfile.gettempdir()) / "Microchip.ATtiny_DFP.3.4.278.atpack" if args.download else OUT / "reference/raw/Microchip.ATtiny_DFP.3.4.278.atpack")
    if args.download:
        request = urllib.request.Request(PACK_URL, headers={"User-Agent": "UartDebug knowledge snapshot/1.0"})
        with urllib.request.urlopen(request, timeout=30) as response:
            pack.write_bytes(response.read())
    data, license_text = extract(pack)
    outputs = {"devices.json": dumps(data), "MICROCHIP-LICENSE.txt": license_text}
    for name, contents in outputs.items():
        dest = OUT / name
        if args.verify:
            if dest.read_bytes() != contents:
                raise SystemExit(f"Snapshot differs: {dest}; review upstream changes before replacing the pinned bundle")
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(contents)
    print(f"{'Verified' if args.verify else 'Extracted'} 3 devices; pack SHA256 {data['packSha256']}")


if __name__ == "__main__":
    main()
