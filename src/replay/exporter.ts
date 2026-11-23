// Exportación de video: graba el canvas del juego con MediaRecorder (WebM) y, si se puede, el audio del motor.

import type { AudioEngine } from '../audio/audio.ts';

export function canExportVideo() {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
}

function pickMime(withAudio: boolean) {
  const opts = withAudio
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return opts.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
}

export class WebmRecorder {
  private rec: MediaRecorder;
  private chunks: Blob[] = [];
  private tap: { from: AudioNode; to: MediaStreamAudioDestinationNode } | null = null;
  readonly hasAudio: boolean;
  readonly mime: string;

  constructor(canvas: HTMLCanvasElement, audio: AudioEngine | null, fps = 60) {
    const stream = canvas.captureStream(fps);
    // Audio: duplicamos la salida general del motor de sonido hacia un destino de MediaStream
    const ctx = (audio?.ctx ?? null) as AudioContext | null;
    // El motor de audio expone la salida general en core.master (antes en master)
    const eng = audio as unknown as { master?: AudioNode; core?: { master?: AudioNode } } | null;
    const master = eng?.core?.master ?? eng?.master;
    if (ctx && master && typeof ctx.createMediaStreamDestination === 'function') {
      try {
        const dest = ctx.createMediaStreamDestination();
        master.connect(dest);
        const track = dest.stream.getAudioTracks()[0];
        if (track) stream.addTrack(track);
        this.tap = { from: master, to: dest };
      } catch { this.tap = null; }
    }
    this.hasAudio = !!this.tap;
    this.mime = pickMime(this.hasAudio);
    this.rec = new MediaRecorder(stream, { ...(this.mime ? { mimeType: this.mime } : {}), videoBitsPerSecond: 8_000_000 });
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
  }

  start() { this.rec.start(250); }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      this.rec.onstop = () => {
        if (this.tap) { try { this.tap.from.disconnect(this.tap.to); } catch { /* ya desconectado */ } }
        resolve(new Blob(this.chunks, { type: this.mime || 'video/webm' }));
      };
      if (this.rec.state === 'inactive') this.rec.onstop(new Event('stop'));
      else this.rec.stop();
    });
  }
}
