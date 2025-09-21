import argparse, os, time
from intelhex import IntelHex
from remote_serial_sync import RemoteSerialSync
from pymcuprog.serialupdi.link import UpdiDatalink
from pymcuprog.serialupdi.readwrite import UpdiReadWrite
from pymcuprog.serialupdi.nvmp0 import NvmUpdiP0
from pymcuprog.serialupdi.nvmp2 import NvmUpdiP2
from pymcuprog.serialupdi.nvmp3 import NvmUpdiP3
from pymcuprog.deviceinfo import deviceinfo

NVM_BY_FAMILY = {"P:0": NvmUpdiP0, "P:2": NvmUpdiP2, "P:3": NvmUpdiP3}

class UpdiPhysicalBridge:
    """Физический слой для UpdiDatalink поверх нашего удалённого Serial."""
    def __init__(self, ser: RemoteSerialSync):
        self.ser = ser

    # Управляющие линии
    def set_break(self, level: bool):
        self.ser.set_break(bool(level))

    def set_dtr(self, level: bool):
        self.ser.set_dtr(bool(level))

    def set_rts(self, level: bool):
        self.ser.set_rts(bool(level))

    # BREAK последовательности
    def send_break(self, duration_s: float = 0.003):
        self.set_break(True);  time.sleep(duration_s)
        self.set_break(False); time.sleep(duration_s)

    def send_double_break(self, duration_s: float = 0.003):
        self.send_break(duration_s); self.send_break(duration_s)

    # Обмен байтами
    def send(self, data):
        if isinstance(data, list):
            data = bytes(data)
        elif isinstance(data, bytearray):
            data = bytes(data)
        elif not isinstance(data, (bytes, bytearray)):
            data = bytes([int(data) & 0xFF])
        self.ser.write(data)

    def receive(self, n: int):
        return list(self.ser.read(int(n)))

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--session', required=True)
    p.add_argument('--device',  required=True)  # напр. attiny1624
    p.add_argument('--hex',     required=True)
    p.add_argument('--baud',    type=int, default=230400)
    p.add_argument('--erase',   action='store_true')
    p.add_argument('--verify',  action='store_true')
    p.add_argument('--ws',      default=os.environ.get('WS_BASE', 'ws://127.0.0.1:8080'))
    args = p.parse_args()

    ws_url = f"{args.ws.rstrip('/')}/ws/flash/{args.session}?role=python"
    # Увеличим таймаут до 1.5 c — UPDI на веб-мосте может отвечать не мгновенно
    serial = RemoteSerialSync(ws_url, baudrate=args.baud, timeout=1.5)

    def log_line(text: str):
        try:
            serial.ws.send('{"cmd":"log","args":{"text":' + __import__('json').dumps(text) + '}}')
        except:
            pass

    log_line(f"pymcuprog driver starting for {args.device} @ {args.baud}")
    serial.open()

    # Небольшой «ритуал входа» в режим программирования
    phys = UpdiPhysicalBridge(serial)
    try:
        phys.set_dtr(False); phys.set_rts(False)
        time.sleep(0.002)
        phys.send_double_break(0.004)   # двойной BREAK
        time.sleep(0.006)               # короткая пауза
    except Exception as e:
        log_line(f"Warn: pre-init sequence failed: {e}")

    link = UpdiDatalink()
    link.set_physical(phys)
    link.init_datalink()                # здесь должна успешно пройти инициализация

    rw = UpdiReadWrite(link)

    info = deviceinfo.getdevice(args.device)
    pver = info.get("NVMCTRL_P") or (
        "P:0" if ("tiny" in args.device or "mega0" in args.device) else
        "P:2" if any(k in args.device for k in ("da","db","dd")) else
        "P:3"
    )
    nvm_cls = NVM_BY_FAMILY.get(pver, NvmUpdiP0)
    log_line(f"Device info resolved: {args.device} uses {pver}")
    nvm = nvm_cls(rw, info)

    ihx = IntelHex(args.hex)
    segments = ihx.segments()
    page = info.get("FLASH_PAGE_SIZE", 64)

    if args.erase:
        log_line("Chip erase…")
        nvm.chip_erase()

    for start, end in segments:
        data = ihx.tobinarray(start=start, end=end-1)
        log_line(f"Write [0x{start:06X}..0x{end-1:06X}] ({len(data)} bytes)…")
        off = 0
        while off < len(data):
            chunk = data[off:off+page]
            nvm.write_flash(start + off, list(chunk))
            off += len(chunk)

    if args.verify:
        log_line("Verify…")
        ok = True
        for start, end in segments:
            want = bytes(ihx.tobinarray(start=start, end=end-1))
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