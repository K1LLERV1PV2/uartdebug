# python/remote_serial_sync.py
import json, time, websocket

class RemoteSerialSync:
    def __init__(self, url, baudrate=230400, timeout=1.0):
        self.url = url
        self.ws = websocket.create_connection(url, timeout=timeout+5)
        self.timeout = timeout
        self.baudrate = baudrate

    def _rpc(self, cmd, **args):
        rid = str(time.time_ns())
        self.ws.send(json.dumps({"id": rid, "cmd": cmd, "args": args}))
        self.ws.settimeout(self.timeout + 5)
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == rid:
                if not msg.get("ok", False):
                    raise IOError(msg.get("error", "remote error"))
                return msg

    # --- pyserial-like API used by UpdiPhysical ---
    def open(self):
        self._rpc("open", baud=int(self.baudrate))

    def close(self):
        try: self._rpc("close")
        except: pass
        try: self.ws.close()
        except: pass

    def set_break(self, level: bool):
        self._rpc("setSignals", **{"break": bool(level)})

    def set_dtr(self, level: bool):
        self._rpc("setSignals", dataTerminalReady=bool(level))

    def set_rts(self, level: bool):
        self._rpc("setSignals", requestToSend=bool(level))

    def write(self, b: bytes):
        self._rpc("write", bytes=list(b))

    def read(self, n: int) -> bytes:
        msg = self._rpc("read", n=int(n), timeout_ms=int(self.timeout * 1000))
        return bytes(msg.get("bytes", []))