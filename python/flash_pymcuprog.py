# python/flash_pymcuprog.py
import argparse, os, time
from intelhex import IntelHex

from remote_serial_sync import RemoteSerialSync

# pymcuprog imports
from pymcuprog.serialupdi.link import UpdiDatalink
from pymcuprog.serialupdi.readwrite import UpdiReadWrite
from pymcuprog.serialupdi.nvmp0 import NvmUpdiP0  # tiny0/1/2, mega0 (ATtiny1624)
from pymcuprog.serialupdi.nvmp2 import NvmUpdiP2  # AVR DA/DB/DD
from pymcuprog.serialupdi.nvmp3 import NvmUpdiP3  # AVR EA
from pymcuprog.deviceinfo import deviceinfo

NVM_BY_FAMILY = {
    "P:0": NvmUpdiP0,
    "P:2": NvmUpdiP2,
    "P:3": NvmUpdiP3,
}

class UpdiPhysicalBridge:
    """
    Адаптер под ожидания UpdiDatalink:
    - send(list[int]|bytes)
    - receive(n) -> list[int]
    - set_break(bool), set_dtr(bool), set_rts(bool)
    - (опционально) send_break(), send_double_break()
    """
    def __init__(self, ser: RemoteSerialSync):
        self.ser = ser

    # ---- управление линиями
    def set_break(self, level: bool):
        self.ser.set_break(bool(level))

    def set_dtr(self, level: bool):
        self.ser.set_dtr(bool(level))

    def set_rts(self, level: bool):
        self.ser.set_rts(bool(level))

    # ---- UPDI иногда требует BREAK/DOUBLE BREAK для входа в режим программирования
    def send_break(self, duration_s: float = 0.003):
        self.set_break(True)
        time.sleep(duration_s)
        self.set_break(False)
        time.sleep(duration_s)

    def send_double_break(self, duration_s: float = 0.003):
        self.send_break(duration_s)
        self.send_break(duration_s)

    # ---- обмен данными
    def send(self, data):
        if isinstance(data, list):
            data = bytes(data)
        elif isinstance(data, bytearray):
            data = bytes(data)
        elif not isinstance(data, (bytes, bytearray)):
            data = bytes([int(data) & 0xFF])
        self.ser.write(data)

    def receive(self, n: int):
        b = self.ser.read(int(n))
        # Updi* ожидают список int'ов
        return list(b)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--session', required=True)
    parser.add_argument('--device', required=True)  # e.g. attiny1624
    parser.add_argument('--hex', required=True)
    parser.add_argument('--baud', type=int, default=230400)
    parser.add_argument('--erase', action='store_true')
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--ws', default=os.environ.get('WS_BASE', 'ws://127.0.0.1:8080'))
    args = parser.parse_args()

    # Connect to broker as role=python
    ws_url = f"{args.ws.rstrip('/')}/ws/flash/{args.session}?role=python"
    serial = RemoteSerialSync(ws_url, baudrate=args.baud, timeout=0.5)

    # Helper: send a log line to the browser (best-effort)
    def log_line(text: str):
        try:
            serial.ws.send('{"cmd":"log","args":{"text":' + __import__('json').dumps(text) + '}}')
        except:
            pass

    log_line(f"pymcuprog driver starting for {args.device} @ {args.baud}")

    # Open remote serial (в браузере порт уже выбран; тут будет только open())
    serial.open()

    # Build UPDI stack
    link = UpdiDatalink()
    phys = UpdiPhysicalBridge(serial)     # <-- наш физический слой
    link.set_physical(phys)
    link.init_datalink()

    rw = UpdiReadWrite(link)

    info = deviceinfo.getdevice(args.device)
    pver = info.get("NVMCTRL_P") or (
        "P:0" if ("tiny" in args.device or "mega0" in args.device) else
        "P:2" if any(k in args.device for k in ("da", "db", "dd")) else
        "P:3"
    )
    NvmCls = NVM_BY_FAMILY.get(pver, NvmUpdiP0)
    log_line(f"Device info resolved: {args.device} uses {pver}")

    nvm = NvmCls(rw, info)

    # Parse HEX → segments
    hexfile = IntelHex(args.hex)
    segments = hexfile.segments()
    page = info.get("FLASH_PAGE_SIZE", 64)

    # Erase
    if args.erase:
        log_line("Chip erase…")
        nvm.chip_erase()

    # Program segments
    for start, end in segments:
        addr = start
        data = hexfile.tobinarray(start=start, end=end-1)
        log_line(f"Write [0x{start:06X}..0x{end-1:06X}] ({len(data)} bytes)…")
        off = 0
        while off < len(data):
            chunk = data[off:off+page]
            nvm.write_flash(addr + off, list(chunk))
            off += len(chunk)

    if args.verify:
        log_line("Verify…")
        ok = True
        for start, end in segments:
            want = bytes(hexfile.tobinarray(start=start, end=end-1))
            got  = bytes(rw.read_data(start, len(want)))
            if got != want:
                ok = False
                log_line(f"Mismatch at 0x{start:06X}")
                break
        if not ok:
            serial.close()
            raise SystemExit(2)

    log_line("Done ✓")
    serial.close()

if __name__ == "__main__":
    main()
