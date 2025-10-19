/* updi.js — Web Serial UPDI (глобальная версия без ES-модулей)
   Экспортирует в window: window.WebSerialUPDI и window.IntelHex
*/

(function (global) {
  class IntelHex {
    static parse(hexText) {
      const lines = hexText.trim().split(/\r?\n/);
      let upper = 0,
        segs = [];
      for (const line of lines) {
        if (!line.startsWith(":")) continue;
        const bytes = Uint8Array.from(
          line
            .slice(1)
            .match(/.{2}/g)
            .map((h) => parseInt(h, 16))
        );
        const len = bytes[0],
          off = (bytes[1] << 8) | bytes[2],
          type = bytes[3];
        const data = bytes.slice(4, 4 + len);
        if (type === 0x00) {
          const addr = (upper << 16) | off;
          segs.push({ addr, data });
        } else if (type === 0x04) {
          upper = (data[0] << 8) | data[1];
        } else if (type === 0x01) {
          break;
        }
      }
      segs.sort((a, b) => a.addr - b.addr);
      const out = [];
      for (const s of segs) {
        if (out.length && out.at(-1).addr + out.at(-1).data.length === s.addr) {
          const prev = out.at(-1);
          const merged = new Uint8Array(prev.data.length + s.data.length);
          merged.set(prev.data, 0);
          merged.set(s.data, prev.data.length);
          prev.data = merged;
        } else {
          out.push({ addr: s.addr, data: new Uint8Array(s.data) });
        }
      }
      return out;
    }
  }

  class UpdiError extends Error {}

  class WebSerialUPDI {
    constructor(port, opts = {}) {
      this.port = port;
      this.baud = opts.baud ?? 230400;
      this.pageSize = opts.pageSize ?? 64;
      this.rowSize = opts.rowSize ?? 256;
      this.echo = true;
      this.reader = null;
      this.writer = null;
    }
    async open() {
      await this.port.open({
        baudRate: this.baud,
        dataBits: 8,
        parity: "even",
        stopBits: 2,
        bufferSize: 4096,
      });
      this.reader = this.port.readable.getReader();
      this.writer = this.port.writable.getWriter();
    }
    async close() {
      try {
        this.reader?.releaseLock();
      } catch {}
      try {
        this.writer?.releaseLock();
      } catch {}
      try {
        await this.port.close();
      } catch {}
    }
    async write(bytes) {
      if (!(bytes instanceof Uint8Array)) bytes = Uint8Array.from(bytes);
      await this.writer.write(bytes);
    }
    async readExact(n, timeoutMs = 100) {
      const chunks = [];
      let got = 0;
      const deadline = performance.now() + timeoutMs;
      while (got < n) {
        const { value, done } = await Promise.race([
          this.reader.read(),
          new Promise((r) =>
            setTimeout(
              () => r({ value: null, done: false, timeout: true }),
              Math.max(1, deadline - performance.now())
            )
          ),
        ]);
        if (value?.length) {
          chunks.push(value);
          got += value.length;
        }
        if (done) break;
        if (performance.now() > deadline) break;
      }
      const all = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
      let off = 0;
      for (const c of chunks) {
        all.set(c, off);
        off += c.length;
      }
      if (all.length < n)
        throw new UpdiError(`timeout waiting ${n} bytes, got ${all.length}`);
      return all.slice(0, n);
    }
    async drainEcho(expectedLen, timeoutMs = 50) {
      if (!this.echo) return;
      try {
        await this.readExact(expectedLen, timeoutMs);
      } catch {}
    }
    async doubleBreak() {
      await this.writer.releaseLock();
      await this.reader.releaseLock();
      await this.port.close();
      await this.port.open({
        baudRate: 300,
        dataBits: 8,
        parity: "even",
        stopBits: 2,
      });
      this.reader = this.port.readable.getReader();
      this.writer = this.port.writable.getWriter();
      await this.write(new Uint8Array([0, 0, 0, 0, 0, 0]));
      await new Promise((r) => setTimeout(r, 50));
      await this.writer.releaseLock();
      await this.reader.releaseLock();
      await this.port.close();
      await this.port.open({
        baudRate: this.baud,
        dataBits: 8,
        parity: "even",
        stopBits: 2,
      });
      this.reader = this.port.readable.getReader();
      this.writer = this.port.writable.getWriter();
    }

    static SYNCH = 0x55;
    static OPC = {
      LDCS: 0x80,
      STCS: 0xc0,
      REPEAT: 0xa0,
      KEY: 0xe0,
      LD: 0x00,
      ST: 0x40,
    };
    static CS = {
      ASI_KEY_STATUS: 0x07,
      ASI_RESET_REQ: 0x08,
      ASI_CTRL: 0x09,
      ASI_STATUS: 0x0a,
      ASI_CRC_STATUS: 0x0b,
    };
    static NVM = {
      BASE: 0x1000,
      CTRLA: 0x1000,
      CTRLB: 0x1001,
      STATUS: 0x1002,
      ADDR: 0x1004,
      DATA: 0x1006,
    };
    static NVM_CMD = {
      NOOP: 0x00,
      FL_ERASE_ROW: 0x12,
      FL_WRITE: 0x1d,
      FL_ERASE_CHIP: 0x10,
    };
    static KEY = {
      NVMPROG: Uint8Array.from([
        0x4e, 0x56, 0x4d, 0x50, 0x72, 0x6f, 0x67, 0x20,
      ]),
      NVMERASE: Uint8Array.from([
        0x4e, 0x56, 0x4d, 0x45, 0x72, 0x61, 0x73, 0x65,
      ]),
      CHIPERASE: Uint8Array.from([
        0x43, 0x68, 0x69, 0x70, 0x45, 0x72, 0x61, 0x73,
      ]),
    };

    make(a) {
      return a instanceof Uint8Array ? a : Uint8Array.from(a);
    }
    async instr_sync(op, payload = []) {
      // Оставляем для совместимости (без ожидания ответа)
      const frame = [WebSerialUPDI.SYNCH, op, ...payload];
      await this.xfer(frame, 0);
    }

    async ldcs(csAddr) {
      const resp = await this.xfer(
        [WebSerialUPDI.SYNCH, WebSerialUPDI.OPC.LDCS | (csAddr & 0x0f)],
        1,
        200
      );
      return resp[0];
    }
    async stcs(csAddr, value) {
      await this.xfer(
        [
          WebSerialUPDI.SYNCH,
          WebSerialUPDI.OPC.STCS | (csAddr & 0x0f),
          value & 0xff,
        ],
        0
      );
    }

    async repeat(countMinus1) {
      await this.xfer(
        [
          WebSerialUPDI.SYNCH,
          WebSerialUPDI.OPC.REPEAT | 0x00,
          countMinus1 & 0xff,
        ],
        0
      );
    }
    async ld8_addr16(addr) {
      const resp = await this.xfer(
        [
          WebSerialUPDI.SYNCH,
          WebSerialUPDI.OPC.LD | 0x04,
          addr & 0xff,
          (addr >> 8) & 0xff,
        ],
        1,
        300
      );
      return resp[0];
    }

    async st8_addr16(addr, value) {
      await this.xfer(
        [
          WebSerialUPDI.SYNCH,
          WebSerialUPDI.OPC.ST | 0x04,
          addr & 0xff,
          (addr >> 8) & 0xff,
          value & 0xff,
        ],
        0
      );
    }
    async st16_addr16(addr, value16) {
      await this.xfer(
        [
          WebSerialUPDI.SYNCH,
          WebSerialUPDI.OPC.ST | 0x05,
          addr & 0xff,
          (addr >> 8) & 0xff,
          value16 & 0xff,
          (value16 >> 8) & 0xff,
        ],
        0
      );
    }

    async key_send(keyBytes) {
      // KEY-пролог + 8 байт ключа одной транзакцией
      const pre = [WebSerialUPDI.SYNCH, WebSerialUPDI.OPC.KEY | 0x00, 0x00];
      const frame = new Uint8Array(pre.length + keyBytes.length);
      frame.set(pre, 0);
      frame.set(keyBytes, pre.length);
      await this.xfer(frame, 0, 100);
    }

    async initSession({ progress } = {}) {
      progress?.("UPDI: double-break…");
      await this.doubleBreak();

      progress?.("UPDI: sync…");
      await this.sendSync();

      const stat = await this.ldcs(WebSerialUPDI.CS.ASI_STATUS);
      return stat;
    }
    async enterNvmProg({ progress } = {}) {
      progress?.("UPDI: send NVMProg key…");
      await this.key_send(WebSerialUPDI.KEY.NVMPROG);
      await this.ldcs(WebSerialUPDI.CS.ASI_KEY_STATUS);
    }
    async nvm_wait_ready(timeoutMs = 1000) {
      const t0 = performance.now();
      while (true) {
        const s = await this.st8_read(WebSerialUPDI.NVM.STATUS);
        if ((s & 0x03) === 0) return;
        if (performance.now() - t0 > timeoutMs)
          throw new UpdiError("NVM timeout");
        await new Promise((r) => setTimeout(r, 5));
      }
    }
    async nvm_cmd(cmd) {
      await this.st8_addr16(WebSerialUPDI.NVM.CTRLA, cmd & 0xff);
    }
    async st8_read(addr) {
      return await this.ld8_addr16(addr);
    }
    async st8_write(addr, v) {
      await this.st8_addr16(addr, v);
    }
    async chipErase({ progress } = {}) {
      progress?.("UPDI: chip erase…");
      await this.key_send(WebSerialUPDI.KEY.NVMERASE);
      await this.nvm_cmd(WebSerialUPDI.NVM_CMD.FL_ERASE_CHIP);
      await this.nvm_wait_ready(5000);
    }
    async programFlashBlock(startAddr, data, { progress } = {}) {
      await this.st16_addr16(WebSerialUPDI.NVM.ADDR, startAddr & 0xffff);
      for (let i = 0; i < data.length; i++)
        await this.st8_addr16(WebSerialUPDI.NVM.DATA, data[i]);
      await this.nvm_cmd(WebSerialUPDI.NVM_CMD.FL_WRITE);
      await this.nvm_wait_ready(2000);
    }
    async verifyFlash(startAddr, data) {
      for (let i = 0; i < data.length; i++) {
        const b = await this.ld8_addr16(startAddr + i);
        if (b !== data[i]) return false;
      }
      return true;
    }
    async flashIntelHex(hexText, { erase = true, progress } = {}) {
      const chunks = IntelHex.parse(hexText);
      progress?.(`HEX: ${chunks.length} сегм. …`);
      await this.initSession({ progress });
      await this.enterNvmProg({ progress });
      if (erase) await this.chipErase({ progress });
      for (const seg of chunks) {
        let ptr = seg.addr;
        let left = seg.data;
        while (left.length) {
          const pageBase = Math.floor(ptr / this.pageSize) * this.pageSize;
          const pageOff = ptr - pageBase;
          const space = this.pageSize - pageOff;
          const take = left.slice(0, space);
          const buf = new Uint8Array(pageOff + take.length);
          buf.set(take, pageOff);
          progress?.(
            `FLASH 0x${pageBase.toString(16)} (+${pageOff}) len=${take.length}`
          );
          await this.programFlashBlock(pageBase, buf, { progress });
          ptr += take.length;
          left = left.slice(take.length);
        }
      }
      progress?.("Готово");
    }

    async xfer(frameBytes, respLen = 0, timeoutMs = 200) {
      // frameBytes: Uint8Array | number[]
      const frame =
        frameBytes instanceof Uint8Array
          ? frameBytes
          : Uint8Array.from(frameBytes);

      // Пишем весь кадр
      await this.write(frame);

      // Сколько ждать байт на вход: echo (если включен) + ожидаемый ответ
      const need = (this.echo ? frame.length : 0) + respLen;
      if (need === 0) return new Uint8Array(0);
      const buf = await this.readExact(need, timeoutMs);

      // Отбрасываем эхо, возвращаем только ответ
      return this.echo ? buf.slice(frame.length) : buf;
    }

    async sendSync() {
      await this.xfer([WebSerialUPDI.SYNCH], 0, 50);
    }
  }

  // Экспорт в глобальный объект
  global.WebSerialUPDI = WebSerialUPDI;
  global.IntelHex = IntelHex;
  global.UpdiError = UpdiError;
})(window);
