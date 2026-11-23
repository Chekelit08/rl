// Conexión con el servidor online (WebSocket). Sin DOM: funciona en el navegador y en Node (pruebas).
// Maneja ping/RTT, reconexión automática con el mismo token y latencia simulada para pruebas.

import { type ClientMsg, PROTOCOL_VERSION, randomToken, type ServerMsg } from './protocol.ts';

export type NetStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface NetClientOptions {
  /** Latencia simulada (ms, por mensaje y por sentido). Mantiene el orden, como TCP. */
  simulatedLatency?: () => number;
  /** Fábrica del socket (por defecto, el WebSocket global). */
  socketFactory?: (url: string) => WebSocket;
}

export class NetClient {
  url = '';
  status: NetStatus = 'idle';
  id = '';
  token: string;
  name = 'Jugador';
  body = 0;
  /** RTT suavizado (ms) y su desvío. */
  rtt = 0;
  rttVar = 0;
  onMessage: (m: ServerMsg) => void = () => {};
  onBinary: (buf: ArrayBuffer) => void = () => {};
  onStatus: (s: NetStatus, detail?: string) => void = () => {};
  private ws: WebSocket | null = null;
  private opts: NetClientOptions;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private wantOpen = false;
  private retries = 0;
  private outQueueT = 0;
  private inQueueT = 0;
  private serverTickAtPong = 0;

  constructor(token?: string, opts: NetClientOptions = {}) {
    this.token = token || randomToken();
    this.opts = opts;
  }

  connect(url: string, name: string, body: number) {
    this.url = url;
    this.name = name;
    this.body = body;
    this.wantOpen = true;
    this.retries = 0;
    this.open();
  }

  private open() {
    this.setStatus(this.retries > 0 ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try {
      ws = this.opts.socketFactory ? this.opts.socketFactory(this.url) : new WebSocket(this.url);
    } catch (e) {
      this.setStatus('closed', `URL inválida: ${this.url}`);
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.rawSend(JSON.stringify({ t: 'hello', name: this.name, token: this.token, body: this.body, version: PROTOCOL_VERSION } satisfies ClientMsg));
      this.setStatus('open');
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ t: 'ping', c: now() }), 1000);
      this.send({ t: 'ping', c: now() });
    };
    ws.onmessage = (ev: MessageEvent) => this.deliverIn(ev.data);
    ws.onclose = () => {
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.wantOpen && this.retries < 8) {
        this.retries++;
        this.setStatus('reconnecting');
        setTimeout(() => { if (this.wantOpen) this.open(); }, Math.min(4000, 400 * this.retries));
      } else {
        this.setStatus('closed', 'Se perdió la conexión con el servidor');
      }
    };
    ws.onerror = () => { /* onclose se encarga */ };
  }

  private setStatus(s: NetStatus, detail?: string) {
    this.status = s;
    this.onStatus(s, detail);
  }

  /** Entrega en orden respetando la latencia simulada. */
  private deliverIn(data: unknown) {
    const lat = this.opts.simulatedLatency?.() ?? 0;
    const handle = () => {
      if (typeof data === 'string') {
        let m: ServerMsg;
        try { m = JSON.parse(data); } catch { return; }
        if (m.t === 'welcome') { this.id = m.id; this.token = m.token; }
        if (m.t === 'pong') {
          const sample = now() - m.c;
          if (this.rtt === 0) { this.rtt = sample; this.rttVar = sample / 2; }
          else {
            this.rttVar = this.rttVar * 0.8 + Math.abs(sample - this.rtt) * 0.2;
            this.rtt = this.rtt * 0.8 + sample * 0.2;
          }
          this.serverTickAtPong = m.s;
        }
        this.onMessage(m);
      } else if (data instanceof ArrayBuffer) {
        this.onBinary(data);
      } else if (ArrayBuffer.isView(data)) {
        const v = data as ArrayBufferView;
        this.onBinary(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer);
      }
    };
    if (lat <= 0) { handle(); return; }
    const t = Math.max(now() + lat, this.inQueueT);
    this.inQueueT = t;
    setTimeout(handle, t - now());
  }

  private rawSend(data: string | ArrayBuffer) {
    const lat = this.opts.simulatedLatency?.() ?? 0;
    const go = () => { if (this.ws && this.ws.readyState === 1) this.ws.send(data); };
    if (lat <= 0) { go(); return; }
    const t = Math.max(now() + lat, this.outQueueT);
    this.outQueueT = t;
    setTimeout(go, t - now());
  }

  send(m: ClientMsg) { this.rawSend(JSON.stringify(m)); }
  sendBinary(buf: ArrayBuffer) { this.rawSend(buf); }

  isOpen() { return this.status === 'open'; }

  close() {
    this.wantOpen = false;
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    try { this.ws?.close(); } catch { /* ignorar */ }
    this.ws = null;
    this.setStatus('closed');
  }
}

export function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
