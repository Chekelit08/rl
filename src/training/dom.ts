// Ayudas mínimas para construir interfaz sin frameworks.

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function button(label: string, cls = 'btn', onClick?: (e: MouseEvent) => void): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
  return b;
}

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function fmtTime(s: number) {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function fmtDate(ms: number) {
  try {
    return new Date(ms).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** Descarga un Blob con el nombre dado. */
export function download(blob: Blob, name: string) {
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Overlay a pantalla completa (reusa los estilos .overlay/.panel del juego). */
export function overlay(id: string, extraCls = ''): { root: HTMLDivElement; panel: HTMLDivElement } {
  let root = document.getElementById(id) as HTMLDivElement | null;
  if (root) root.remove();
  root = el('div', `overlay tg-overlay ${extraCls}`);
  root.id = id;
  const panel = el('div', 'panel wide tg-panel');
  root.appendChild(panel);
  document.body.appendChild(root);
  return { root, panel };
}

/** Pide un texto en un diálogo propio (sin prompt nativo). */
export function askText(title: string, initial = '', placeholder = '', multiline = false): Promise<string | null> {
  return new Promise((resolve) => {
    const { root, panel } = overlay('tg-ask');
    root.style.zIndex = '40';
    panel.classList.remove('wide');
    panel.classList.add('narrow');
    panel.appendChild(el('h2', '', esc(title)));
    const input = multiline ? el('textarea', 'tg-input tg-textarea') : el('input', 'tg-input');
    (input as HTMLInputElement).value = initial;
    (input as HTMLInputElement).placeholder = placeholder;
    panel.appendChild(input);
    const actions = el('div', 'actions');
    const done = (v: string | null) => { root.remove(); resolve(v); };
    actions.append(button('Cancelar', 'btn', () => done(null)), button('Aceptar', 'btn primary', () => done((input as HTMLInputElement).value)));
    panel.appendChild(actions);
    input.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      ke.stopPropagation();
      if (ke.key === 'Enter' && !multiline) done((input as HTMLInputElement).value);
      if (ke.key === 'Escape') done(null);
    });
    setTimeout(() => (input as HTMLInputElement).focus(), 30);
  });
}

export function confirmBox(title: string, text: string, ok = 'Aceptar'): Promise<boolean> {
  return new Promise((resolve) => {
    const { root, panel } = overlay('tg-confirm');
    root.style.zIndex = '40';
    panel.classList.remove('wide');
    panel.classList.add('narrow');
    panel.append(el('h2', '', esc(title)), el('p', 'tip', esc(text)));
    const actions = el('div', 'actions');
    const done = (v: boolean) => { root.remove(); resolve(v); };
    actions.append(button('Cancelar', 'btn', () => done(false)), button(ok, 'btn primary', () => done(true)));
    panel.appendChild(actions);
  });
}
