// Packs oficiales de entrenamiento. El jugador ataca el arco rojo (+Y) y defiende el azul (−Y).
// Los tiros de arquero se calculan apuntando a un punto del arco (siempre van al arco si nadie los toca);
// tests/training.test.ts lo verifica con la física real.

import type { Pack, Shot, V3t } from './types.ts';

const G = 650;

/** Velocidad para que la pelota vaya de `from` a `to` con rapidez horizontal `hs` (compensa gravedad y arrastre). */
export function aimAt(from: V3t, to: V3t, hs: number): V3t {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const dist = Math.hypot(dx, dy);
  const T = dist / hs;
  const drag = 1 + 0.015 * T; // arrastre del 3 %/s: compensación media
  const vx = (dx / T) * drag, vy = (dy / T) * drag;
  const vz = (dz + 0.5 * G * T * T) / T;
  return [Math.round(vx), Math.round(vy), Math.round(vz)];
}

const s = (bp: V3t, bv: V3t, cp: [number, number], yaw: number, note: string, extra: Partial<Shot['car']> & { time?: number } = {}): Shot => {
  const { time, ...car } = extra;
  return { ball: { p: bp, v: bv }, car: { p: [cp[0], cp[1], 17], yaw, boost: 100, ...car }, note, ...(time ? { time } : {}) };
};

const GOAL_IN = -5300; // detrás de la línea del arco azul

const goalie = (from: V3t, target: [number, number], hs: number, car: [number, number], yaw: number, note: string, time?: number): Shot =>
  s(from, aimAt(from, [target[0], GOAL_IN, target[1]], hs), car, yaw, note, time ? { time } : {});

export const OFFICIAL_PACKS: Pack[] = [
  {
    id: 'of-primeros-remates', name: 'Primeros remates', category: 'delantero', difficulty: 'novato', author: 'TURBOGOL', official: true, created: 0,
    description: 'Pelotas por el piso para afinar el remate: de frente, cruzadas, que vienen y que se van.',
    shots: [
      s([0, 2600, 93], [0, 0, 0], [0, 900], 90, 'Remate de frente'),
      s([-900, 2400, 93], [0, 350, 0], [-900, 700], 90, 'La pelota se aleja: alcanzala'),
      s([-2200, 3300, 93], [950, 0, 0], [0, 1500], 90, 'Centro rasante'),
      s([700, 4000, 93], [0, -800, 0], [700, 1700], 90, 'Pelota que viene de frente'),
      s([1700, 3500, 93], [0, 0, 0], [800, 1700], 63, 'Tiro cruzado'),
      s([0, 3100, 350], [0, 0, 0], [0, 1300], 90, 'Pelota picando'),
      s([-3000, 4000, 200], [1300, -250, 450], [-500, 2100], 90, 'Centro desde la esquina'),
      s([0, 3500, 93], [0, 0, 0], [1000, 2900], 180, 'Girá y rematá'),
      s([2600, 2500, 93], [-950, 450, 0], [0, 1100], 90, 'Pase desde la derecha'),
      s([0, 700, 93], [0, 0, 0], [0, -1000], 90, 'Remate de larga distancia', { time: 9 }),
    ],
  },
  {
    id: 'of-rebotes-voleas', name: 'Rebotes y voleas', category: 'delantero', difficulty: 'intermedio', author: 'TURBOGOL', official: true, created: 0,
    description: 'Pelotas que pican, centros desde la pared y voleas: leé el rebote y llegá justo.',
    shots: [
      s([0, 3300, 650], [0, 0, 0], [0, 1500], 90, 'Volea: esperá el pique'),
      s([3600, 3000, 300], [-1500, 350, 550], [0, 1600], 90, 'Centro alto desde la pared'),
      s([0, 1300, 150], [0, 420, 950], [0, 300], 90, 'Globo por encima: perseguilo'),
      s([-1500, 2200, 400], [850, 650, 350], [-1900, 700], 75, 'Pique cruzado'),
      s([-3900, 3600, 600], [1700, 100, 300], [-200, 2400], 90, 'Centro bombeado'),
      s([0, 4300, 93], [0, -1500, 900], [0, 1600], 90, 'Rebote del arco: de primera'),
      s([1200, 2400, 900], [-200, 400, -200], [1600, 900], 100, 'Pelota cayendo cruzada'),
      s([-800, 3700, 200], [0, 0, 1200], [-800, 1700], 90, 'Pelota que sube: saltá justo'),
      s([2900, 4700, 300], [-1200, -500, 700], [300, 2700], 90, 'Centro atrás desde el fondo'),
      s([-600, 2400, 93], [-150, 700, 0], [0, 300], 95, 'Alcanzala antes de que se vaya'),
    ],
  },
  {
    id: 'of-definicion-pro', name: 'Definición fina', category: 'delantero', difficulty: 'pro', author: 'TURBOGOL', official: true, created: 0,
    description: 'Ángulos cerrados, centros rápidos y pelotas al segundo palo. Precisión y potencia.',
    shots: [
      s([3300, 4300, 93], [-200, 200, 0], [2600, 2800], 70, 'Ángulo cerrado'),
      s([-3600, 4500, 400], [2300, -200, 400], [0, 2600], 90, 'Centro rápido al primer palo'),
      s([0, 2500, 93], [1100, 1900, 300], [0, 600], 90, 'Pelota escapando a toda velocidad'),
      s([2000, 1500, 500], [-900, 1100, 700], [2400, 0], 95, 'Aéreo bajo cruzado'),
      s([0, 4600, 600], [0, -900, 300], [-1500, 3000], 45, 'Pelota en el área chica'),
      s([-3900, 2000, 900], [700, 900, -100], [-2000, 1000], 80, 'Bajada desde la pared'),
      s([1000, 3000, 93], [0, 0, 0], [-1000, 2600], 0, 'Rematá en movimiento lateral'),
      s([0, 1000, 1300], [500, 400, 200], [0, -500], 90, 'Pelota alta a media cancha', { time: 9 }),
      s([3000, 3900, 200], [-2000, 300, 600], [-700, 2700], 60, 'Centro pasado: segundo palo'),
      s([-500, 4900, 93], [600, 0, 700], [-1800, 3600], 30, 'Pelota en la línea'),
    ],
  },
  {
    id: 'of-tres-palos', name: 'Bajo los tres palos', category: 'arquero', difficulty: 'intermedio', author: 'TURBOGOL', official: true, created: 0,
    description: 'Tiros al arco desde distintos ángulos y alturas. Todos van adentro si no los atajás.',
    shots: [
      goalie([0, -1500, 93], [-300, 200], 1900, [0, -5050], 90, 'Tiro al medio'),
      goalie([-1200, -1800, 93], [650, 120], 2100, [0, -5050], 90, 'Rasante al segundo palo'),
      goalie([1500, -2000, 200], [-600, 500], 2200, [0, -5050], 90, 'Alto al ángulo'),
      goalie([0, -900, 93], [0, 430], 1500, [0, -5050], 90, 'Vaselina'),
      goalie([-2800, -3000, 93], [500, 300], 2000, [0, -5050], 90, 'Desde el costado'),
      goalie([2500, -1200, 600], [-450, 150], 2300, [0, -5050], 90, 'Volea cruzada'),
      goalie([0, -2500, 93], [700, 110], 2600, [-400, -5050], 90, 'Tiro fuerte al palo'),
      goalie([2600, -3800, 300], [-200, 250], 1500, [0, -5050], 20, 'Centro peligroso'),
      goalie([-700, -3300, 93], [100, 93], 1100, [1500, -4300], 200, 'Pelota lenta: volvé a tiempo', 7),
      goalie([0, -400, 1000], [0, 300], 1800, [0, -4800], 90, 'Bombazo desde arriba'),
    ],
  },
  {
    id: 'of-arquero-novato', name: 'Primeras atajadas', category: 'arquero', difficulty: 'novato', author: 'TURBOGOL', official: true, created: 0,
    description: 'Tiros lentos y bajos para aprender a ubicarte y despejar.',
    shots: [
      goalie([0, -2000, 93], [0, 100], 1300, [0, -5050], 90, 'Rodando al medio'),
      goalie([-1000, -2200, 93], [-400, 100], 1300, [0, -5050], 90, 'Al palo izquierdo'),
      goalie([1000, -2200, 93], [400, 100], 1300, [0, -5050], 90, 'Al palo derecho'),
      goalie([0, -2400, 300], [0, 250], 1400, [0, -5050], 90, 'A media altura'),
      goalie([-2200, -3200, 93], [300, 100], 1300, [0, -5050], 90, 'Cruzado desde la izquierda'),
      goalie([2200, -3200, 93], [-300, 100], 1300, [0, -5050], 90, 'Cruzado desde la derecha'),
      goalie([0, -1600, 93], [0, 350], 1200, [0, -5050], 90, 'Globito'),
      goalie([0, -2800, 93], [500, 100], 1500, [-300, -4900], 90, 'Movete al palo'),
      goalie([-1500, -2500, 200], [-500, 200], 1400, [0, -5050], 90, 'Pique al primer palo'),
      goalie([0, -3000, 93], [0, 100], 1700, [0, -4600], 90, 'Salí a cortar'),
    ],
  },
  {
    id: 'of-vuelo-alto', name: 'Vuelo alto', category: 'aereo', difficulty: 'pro', author: 'TURBOGOL', official: true, created: 0,
    description: 'Pelotas en el aire: saltá, turbo y apuntá con el control aéreo. Empezás con turbo lleno.',
    shots: [
      s([0, 2800, 400], [0, 0, 1050], [0, 700], 90, 'Primer aéreo'),
      s([-1200, 3200, 300], [200, 0, 1150], [-600, 900], 90, 'Aéreo cruzado'),
      s([0, 3600, 1200], [0, 0, 300], [0, 1200], 90, 'Pelota alta flotando'),
      s([2400, 3300, 500], [-700, 200, 1000], [300, 1200], 90, 'Centro aéreo desde la derecha'),
      s([0, 1800, 300], [0, 600, 1200], [0, 0], 90, 'Perseguí el globo por el aire'),
      s([-2600, 4300, 900], [900, -200, 500], [-600, 1800], 90, 'Aéreo al segundo palo'),
      s([0, 4200, 1500], [0, -300, 0], [0, 2000], 90, 'Pelota sobre el travesaño'),
      s([1500, 2600, 250], [-500, 250, 1350], [1800, 600], 100, 'Aéreo rápido'),
      s([0, 3000, 1700], [0, 200, -200], [0, 500], 90, 'Aéreo largo y alto'),
      s([-1800, 2400, 600], [600, 500, 1100], [-2400, 300], 70, 'Aéreo en diagonal'),
    ],
  },
];
