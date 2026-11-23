// Chat rápido: teclas 1–4 (o D-pad) abren un grupo de 4 frases; una segunda pulsación envía la frase.
// Los bots responden de vez en cuando y comentan jugadas.

export const CHAT_GROUPS: { name: string; phrases: string[]; replies: string[] }[] = [
  { name: 'Juego', phrases: ['¡La tengo!', '¡Pasala!', 'Defendé el arco', '¡Vamos al ataque!'], replies: ['¡Dale!', 'Entendido', '¡Te cubro!', 'Va'] },
  { name: 'Reacciones', phrases: ['¡Qué golazo!', '¡Uy, por poco!', '¡Increíble!', '¡Qué atajada!'], replies: ['¡Gracias!', 'Casi...', '¡Jaja!', '¡Fue suerte!'] },
  { name: 'Cortesía', phrases: ['Gracias', 'Buen pase', 'Bien jugado', 'Perdón'], replies: ['De nada', 'No hay problema', '¡Igualmente!', 'Todo bien'] },
  { name: 'Partido', phrases: ['¡Vamos!', 'Una más', 'Buena partida', '¿Revancha?'], replies: ['¡Vamos!', '¡A por ellos!', 'Buena partida', '¡Dale, otra!'] },
];

const REACT = {
  goalMine: ['¡Qué golazo!', '¡Vamos!', '¡Increíble!'],
  goalOpp: ['Uy...', '¡Buen gol!', 'Qué pena'],
  demoBy: ['¡Jaja!', '¡Cuidado!'],
  save: ['¡Qué atajada!', '¡Bien ahí!'],
};

interface ChatCar { id: number; team: number; name: string; isBot: boolean }

export class QuickChat {
  private el: HTMLDivElement;
  private menu: HTMLDivElement;
  private group = -1;
  private menuTimer = 0;
  private stamps: number[] = [];
  private timers = new Set<number>();

  constructor(parent: HTMLElement, private cars: () => ChatCar[], private myId = 0) {
    this.el = document.createElement('div');
    this.el.className = 'qchat';
    this.menu = document.createElement('div');
    this.menu.className = 'qchat-menu hidden';
    parent.append(this.el, this.menu);
  }

  reset() {
    this.close();
    this.el.innerHTML = '';
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    this.stamps = [];
  }

  get open() { return this.group >= 0; }

  private close() { this.group = -1; this.menu.classList.add('hidden'); }

  /** Pulsación 0..3 (teclas 1–4 / D-pad). */
  press(i: number) {
    if (this.group < 0) {
      this.group = i;
      const g = CHAT_GROUPS[i];
      this.menu.innerHTML = `<h4>${g.name}</h4>` + g.phrases.map((p, k) => `<div><kbd>${k + 1}</kbd> ${p}</div>`).join('');
      this.menu.classList.remove('hidden');
      this.menuTimer = performance.now() + 3200;
      return;
    }
    const g = this.group;
    this.close();
    const now = performance.now();
    this.stamps = this.stamps.filter((t) => now - t < 6000);
    if (this.stamps.length >= 4) { this.line(null, '', 'Esperá un momento antes de volver a hablar.', 2); return; }
    this.stamps.push(now);
    const me = this.cars().find((c) => c.id === this.myId);
    if (!me) return;
    this.line(me, me.name, CHAT_GROUPS[g].phrases[i]);
    this.botReply(g, me);
  }

  tick() { if (this.group >= 0 && performance.now() > this.menuTimer) this.close(); }

  private line(car: ChatCar | null, name: string, text: string, sys = 0) {
    const d = document.createElement('div');
    d.className = 'qline' + (sys ? ' sys' : car ? ' t' + car.team : '');
    d.innerHTML = sys ? text : `<b>${name}</b>: ${text}`;
    this.el.append(d);
    while (this.el.children.length > 5) this.el.firstChild?.remove();
    setTimeout(() => d.classList.add('out'), 5200);
    setTimeout(() => d.remove(), 5800);
  }

  private later(ms: number, fn: () => void) {
    const t = window.setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
  }

  private botReply(group: number, me: ChatCar) {
    const cars = this.cars();
    const mates = cars.filter((c) => c.isBot && c.team === me.team);
    const opps = cars.filter((c) => c.isBot && c.team !== me.team);
    const g = CHAT_GROUPS[group];
    if (mates.length && Math.random() < 0.55) {
      const b = mates[Math.floor(Math.random() * mates.length)];
      this.later(900 + Math.random() * 1200, () => this.line(b, b.name, g.replies[Math.floor(Math.random() * g.replies.length)]));
    } else if (opps.length && group >= 2 && Math.random() < 0.3) {
      const b = opps[Math.floor(Math.random() * opps.length)];
      this.later(1200 + Math.random() * 1500, () => this.line(b, b.name, g.replies[Math.floor(Math.random() * g.replies.length)]));
    }
  }

  /** Reacciones espontáneas de los bots a jugadas del partido. */
  react(kind: 'goal' | 'demo' | 'save', team: number) {
    if (Math.random() > 0.35) return;
    const bots = this.cars().filter((c) => c.isBot);
    if (!bots.length) return;
    const pool = kind === 'goal'
      ? bots.filter((b) => b.team === team).map((b) => [b, REACT.goalMine] as const).concat(bots.filter((b) => b.team !== team).map((b) => [b, REACT.goalOpp] as const))
      : bots.filter((b) => b.team === team).map((b) => [b, kind === 'demo' ? REACT.demoBy : REACT.save] as const);
    if (!pool.length) return;
    const [b, phrases] = pool[Math.floor(Math.random() * pool.length)];
    this.later(700 + Math.random() * 1500, () => this.line(b, b.name, phrases[Math.floor(Math.random() * phrases.length)]));
  }
}
