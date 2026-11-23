// Servidor online de TURBOGOL.
// - WebSocket en /ws (salas, partidos autoritativos a 120 Hz).
// - Si existe dist/ (npm run build), también sirve el juego en el mismo puerto: un solo proceso para desplegar.
//
// Uso:  npm run server          (puerto 8787; variable PORT para cambiarlo)
// Variables: PORT, SNAPSHOT_HZ=60|30 (snapshots por segundo; con 30 se manda la mitad, también comprimidos).

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { DEFAULT_PORT } from '../src/net/protocol.ts';
import { serverOptions } from './match.ts';
import { Lobby } from './rooms.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.hdr': 'application/octet-stream', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
};

export interface ServerHandle {
  port: number;
  lobby: Lobby;
  close(): Promise<void>;
}

export function startServer(opts: { port?: number; staticDir?: string | null; log?: boolean } = {}): Promise<ServerHandle> {
  const log = opts.log ?? true;
  const lobby = new Lobby();
  const staticDir = opts.staticDir === undefined
    ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
    : opts.staticDir;
  const hasStatic = !!staticDir && fs.existsSync(path.join(staticDir, 'index.html'));

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: lobby.rooms.size, players: lobby.players.size }));
      return;
    }
    if (!hasStatic) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Servidor online de TURBOGOL funcionando. Conectate por WebSocket en /ws.');
      return;
    }
    let file = path.normalize(path.join(staticDir!, decodeURIComponent(url.pathname)));
    if (!file.startsWith(path.normalize(staticDir!))) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) file = path.join(staticDir!, 'index.html');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
    fs.createReadStream(file).pipe(res);
  });

  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://x');
    if (url.pathname !== '/ws' && url.pathname !== '/') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const sock = {
      send: (d: string | ArrayBuffer) => ws.send(d),
      close: (code?: number, reason?: string) => ws.close(code, reason),
      get bufferedAmount() { return ws.bufferedAmount; },
    };
    const onMessage = lobby.onOpen(sock);
    if (log) console.log(`[online] conexión desde ${req.socket.remoteAddress}`);
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const b = data as Buffer;
        onMessage(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
      } else onMessage(data.toString());
    });
    ws.on('close', () => lobby.onClose(sock));
    ws.on('error', () => { /* el cierre se maneja en close */ });
  });

  // Bucle de simulación: paso fijo de 120 Hz con acumulador (las salas avanzan según el tiempo real)
  let last = process.hrtime.bigint();
  const loop = setInterval(() => {
    const t = process.hrtime.bigint();
    const dt = Math.min(0.25, Number(t - last) / 1e9);
    last = t;
    lobby.update(dt);
  }, 2);
  const house = setInterval(() => lobby.housekeeping(), 5000);

  return new Promise((resolve) => {
    server.listen(opts.port ?? DEFAULT_PORT, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? DEFAULT_PORT);
      if (log) {
        console.log(`[online] TURBOGOL escuchando en el puerto ${port} (WebSocket: /ws)${hasStatic ? ' · sirviendo dist/' : ''}`);
        console.log(`[online] snapshots a ${120 / serverOptions.snapshotEvery} Hz`);
        for (const ip of lanAddresses()) {
          console.log(`[online] en la red local: ${hasStatic ? `http://${ip}:${port}  (juego + servidor)` : `ws://${ip}:${port}`}`);
        }
      }
      resolve({
        port,
        lobby,
        close: () => new Promise<void>((res) => {
          clearInterval(loop);
          clearInterval(house);
          for (const c of wss.clients) c.terminate();
          wss.close();
          server.close(() => res());
        }),
      });
    });
  });
}

/** IPv4 de la máquina en la red local (para jugar en LAN). */
function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

// Ejecutado directamente: arrancar con la configuración del entorno
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (Number(process.env.SNAPSHOT_HZ) === 30) serverOptions.snapshotEvery = 4;
  void startServer({ port: Number(process.env.PORT) || DEFAULT_PORT });
}
