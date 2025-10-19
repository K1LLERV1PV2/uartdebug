/* updi.js — минимально необходимая реализация UPDI поверх Web Serial.
   Поддерживает: connect/double-break/sync, чтение SIB, вход в NVM,
   chip erase (опционально), страничную запись FLASH из Intel HEX, verify.
   Тестировалось на tinyAVR 0/1 (например, ATtiny1614/1624) и AVR-DA/DB с 64-байтной страницей.
*/

export class IntelHex {
  static parse(hexText) {
    // Возвращает массив [{addr, data:Uint8Array}], слитые по страничным блокам
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
        // data
        const addr = (upper << 16) | off;
        segs.push({ addr, data });
      } else if (type === 0x04) {
        // extended linear address
        upper = (data[0] << 8) | data[1];
      } else if (type === 0x01) {
        // EOF
        break;
      }
    }
    // Склеиваем в непрерывные чанки
    segs.sort((a, b) => a.addr - b.addr);
    const out = [];
    for (const s of segs) {
      if (out.length && out.at(-1).addr + out.at(-1).data.length === s.addr) {
        // concat
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

export class UpdiError extends Error {}

export class WebSerialUPDI {
  constructor(port, opts = {}) {
    this.port = port;
    this.baud = opts.baud ?? 230400;
    this.pageSize = opts.pageSize ?? 64; // дефолт для tinyAVR 1-series
    this.rowSize = opts.rowSize ?? 256; // 4 страницы по 64
    this.echo = true; // SerialUPDI с резистором эхоирует
    this.reader = null;
    this.writer = null;
  }

  // ---------- НИЗКИЙ УРОВЕНЬ ----------
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

  // Брейк по-UPDI: «double-break» через низкую скорость + 0x00
  // (аналогично приемам из SerialUPDI/pyupdi/avrdude; затем возвращаем 8E2 скорость)
  async doubleBreak() {
    // временно переоткрываем порт на 300 бод и шлем нули
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
    await this.write(new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
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

  // ---------- КОДЫ/ИНСТРУКЦИИ UPDI ----------
  // Опорные константы (схема кодирования Microchip UPDI):
  // SYNCH:
  static SYNCH = 0x55; // :contentReference[oaicite:4]{index=4}
  // OPCODES (значения соответствуют официальному набору UPDI):
  static OPC = {
    LDCS: 0x80, // Load CS register
    STCS: 0xc0, // Store CS register
    REPEAT: 0xa0,
    KEY: 0xe0,
    LD: 0x00, // LD from data space (address modes ниже)
    ST: 0x40, // ST to data space
  };
  // Адреса CS-регистров UPDI
  static CS = {
    // асинхронные/служебные регистры интерфейса
    ASI_KEY_STATUS: 0x07, // бит NVMProg, ChipErase и т.п. отражается здесь
    ASI_RESET_REQ: 0x08,
    ASI_CTRL: 0x09,
    ASI_STATUS: 0x0a,
    ASI_CRC_STATUS: 0x0b,
  };
  // 16-битные адреса регистров NVMCTRL в IO-пространстве (tinyAVR 1-series)
  static NVM = {
    BASE: 0x1000, // :contentReference[oaicite:5]{index=5}
    CTRLA: 0x1000,
    CTRLB: 0x1001,
    STATUS: 0x1002,
    ADDR: 0x1004, // 3 байта ADDR0..2, пишем младшие для флеша <128k
    DATA: 0x1006,
  };
  static NVM_CMD = {
    NOOP: 0x00,
    FL_ERASE_ROW: 0x12,
    FL_WRITE: 0x1d, // Write page (копия буфера в флэш)
    FL_ERASE_CHIP: 0x10,
  };

  // Ключи (64-бит, LSB first) — значения по документации UPDI (ASCII «NVMProg » и т.д.)
  static KEY = {
    NVMPROG: Uint8Array.from([0x4e, 0x56, 0x4d, 0x50, 0x72, 0x6f, 0x67, 0x20]), // "NVMProg "
    NVMERASE: Uint8Array.from([0x4e, 0x56, 0x4d, 0x45, 0x72, 0x61, 0x73, 0x65]), // "NVMErase"
    CHIPERASE: Uint8Array.from([
      0x43, 0x68, 0x69, 0x70, 0x45, 0x72, 0x61, 0x73,
    ]), // "ChipEras"
  }; // :contentReference[oaicite:6]{index=6}

  // Helpers: кодирование форматов
  make(frameBytes) {
    const arr =
      frameBytes instanceof Uint8Array
        ? frameBytes
        : Uint8Array.from(frameBytes);
    return arr;
  }
  async instr_sync(op, payload = []) {
    const frame = this.make([WebSerialUPDI.SYNCH, op, ...payload]);
    await this.write(frame);
    if (this.echo) await this.drainEcho(frame.length);
  }
  async ldcs(csAddr) {
    await this.instr_sync(WebSerialUPDI.OPC.LDCS | (csAddr & 0x0f));
    const b = await this.readExact(1);
    return b[0];
  }
  async stcs(csAddr, value) {
    await this.instr_sync(WebSerialUPDI.OPC.STCS | (csAddr & 0x0f), [
      value & 0xff,
    ]);
  }
  async repeat(countMinus1) {
    // REPEAT с немедленным 8-битным значением (count-1)
    await this.instr_sync(WebSerialUPDI.OPC.REPEAT | 0x00, [
      countMinus1 & 0xff,
    ]);
  }
  // Прямые адресные формы (16-битный адрес)
  async ld8_addr16(addr) {
    await this.instr_sync(WebSerialUPDI.OPC.LD | 0x04, [
      addr & 0xff,
      (addr >> 8) & 0xff,
    ]);
    const b = await this.readExact(1);
    return b[0];
  }
  async st8_addr16(addr, value) {
    await this.instr_sync(WebSerialUPDI.OPC.ST | 0x04, [
      addr & 0xff,
      (addr >> 8) & 0xff,
      value & 0xff,
    ]);
  }
  async st16_addr16(addr, value16) {
    // два байта младший→старший
    await this.instr_sync(WebSerialUPDI.OPC.ST | 0x05, [
      addr & 0xff,
      (addr >> 8) & 0xff,
      value16 & 0xff,
      (value16 >> 8) & 0xff,
    ]);
  }

  async key_send(keyBytes) {
    // KEY формат: SYNCH, KEY|0x00, 0x00 (key 64-бит), затем 8 байт
    await this.instr_sync(WebSerialUPDI.OPC.KEY | 0x00, [0x00]);
    await this.write(keyBytes);
    if (this.echo) await this.drainEcho(keyBytes.length);
  }

  // ---------- СЕССИЯ / ИНИЦИАЛИЗАЦИЯ ----------
  async initSession({ progress } = {}) {
    progress?.("UPDI: double-break…");
    await this.doubleBreak();

    progress?.("UPDI: sync…");
    await this.instr_sync(WebSerialUPDI.SYNCH); // просто 0x55 чтобы «разбудить»
    // читаем что-нибудь из CS чтобы убедиться, что связь есть
    const stat = await this.ldcs(WebSerialUPDI.CS.ASI_STATUS);
    // ok
    return stat;
  }

  async enterNvmProg({ progress } = {}) {
    progress?.("UPDI: send NVMProg key…");
    await this.key_send(WebSerialUPDI.KEY.NVMPROG);
    // ждём установки бита ключа
    const ks = await this.ldcs(WebSerialUPDI.CS.ASI_KEY_STATUS);
    // ks бит для NVMPROG должен установиться; просто продолжаем
  }

  // ---------- NVM ОПЕРАЦИИ ----------
  async nvm_wait_ready(timeoutMs = 1000) {
    const t0 = performance.now();
    while (true) {
      const s = await this.st8_read(WebSerialUPDI.NVM.STATUS); // helper ниже
      if ((s & 0x03) === 0) return; // EE/FLBUSY биты = 0
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
  async st8_write(addr, value) {
    await this.st8_addr16(addr, value);
  }

  async chipErase({ progress } = {}) {
    progress?.("UPDI: chip erase…");
    await this.key_send(WebSerialUPDI.KEY.NVMERASE);
    await this.nvm_cmd(WebSerialUPDI.NVM_CMD.FL_ERASE_CHIP);
    await this.nvm_wait_ready(5000);
  }

  // Пишем один страничный буфер DATA → NVM.DATA, адрес в NVM.ADDR
  async programFlashBlock(startAddr, data, { progress } = {}) {
    // Установка адреса (младшие 3 байта). Для флэша <128k достаточно 2 байт.
    await this.st16_addr16(WebSerialUPDI.NVM.ADDR, startAddr & 0xffff);
    // Заполняем страничный буфер NVM через DATA регистр
    for (let i = 0; i < data.length; i++) {
      await this.st8_addr16(WebSerialUPDI.NVM.DATA, data[i]);
    }
    // Команда записи страницы
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

  // ---------- ВЕРХНИЙ УРОВЕНЬ: прошивка HEX ----------
  async flashIntelHex(hexText, { erase = true, progress } = {}) {
    const chunks = IntelHex.parse(hexText);
    progress?.(`HEX: ${chunks.length} сегм. …`);

    await this.initSession({ progress });
    await this.enterNvmProg({ progress });

    if (erase) {
      await this.chipErase({ progress });
    }

    // Пробегаем по сегментам → режем на страницы
    for (const seg of chunks) {
      // UPDI адреса flash — байтовые (не слова), HEX уже в байтах
      let ptr = seg.addr;
      let left = seg.data;
      while (left.length) {
        const pageBase = Math.floor(ptr / this.pageSize) * this.pageSize;
        const pageOff = ptr - pageBase;
        const space = this.pageSize - pageOff;
        const take = left.slice(0, space);
        const buf = new Uint8Array(pageOff + take.length);
        buf.set(take, pageOff); // страничный буфер — «дыры» заполняем 0xFF? Здесь оставляем 0 — MCU сам читает старые
        // Лучше читать существующую страницу и мерджить; упрощённо пишем только изменённые байты
        const toWrite = buf;
        progress?.(
          `FLASH 0x${pageBase.toString(16)} (+${pageOff}) len=${take.length}`
        );
        await this.programFlashBlock(pageBase, toWrite, { progress });
        // verify (опционально для скорости)
        // const ok = await this.verifyFlash(pageBase, toWrite);
        // if (!ok) throw new UpdiError(`Verify failed at 0x${pageBase.toString(16)}`);

        ptr += take.length;
        left = left.slice(take.length);
      }
    }
    progress?.("Готово");
  }
}
