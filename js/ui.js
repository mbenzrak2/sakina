// Sakina — shared UI helpers. No framework: small DOM builder + a few components.

/* ───────────── DOM builder ───────────── */

/**
 * h('div', { class:'card', onclick: fn }, 'text', childNode, [more, nodes])
 * Strings become text nodes (safe for user content). Falsy children are skipped.
 */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'textContent') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export function clear(el) { el.replaceChildren(); return el; }

/* ───────────── icons (inline SVG, 24×24, stroke) ───────────── */

const P = {
  home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
  beads: '<circle cx="12" cy="4.5" r="2"/><circle cx="18.5" cy="8.5" r="2"/><circle cx="18.5" cy="15.5" r="2"/><circle cx="12" cy="19.5" r="2"/><circle cx="5.5" cy="15.5" r="2"/><circle cx="5.5" cy="8.5" r="2"/>',
  quran: '<path d="M12 6.5C10 5 7.5 4.5 4 4.5v13c3.5 0 6 .5 8 2 2-1.500 4.500-2 8-2v-13c-3.500 0-6 .5-8 2z"/><path d="M12 6.500v13"/>',
  checklist: '<path d="m4 6.500 1.500 1.500L8 5.500"/><path d="m4 12.500 1.500 1.500L8 11.500"/><path d="m4 18.500 1.500 1.500L8 17.500"/><path d="M11.500 7H20M11.500 13H20M11.500 19H20"/>',
  history: '<rect x="3.500" y="5" width="17" height="15.500" rx="2.500"/><path d="M3.500 10h17M8 3v4M16 3v4"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17.500h.01M12 17.500h.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.400 13.500a7.600 7.600 0 0 0 0-3l2-1.500-2-3.400-2.300 1a7.600 7.600 0 0 0-2.600-1.500L14 2.500h-4l-.5 2.600A7.600 7.600 0 0 0 6.900 6.600l-2.300-1-2 3.400 2 1.500a7.600 7.600 0 0 0 0 3l-2 1.500 2 3.400 2.300-1a7.600 7.600 0 0 0 2.600 1.500l.5 2.600h4l.5-2.600a7.600 7.600 0 0 0 2.600-1.500l2.300 1 2-3.400z"/>',
  back: '<path d="m9 5 7 7-7 7"/>',
  chevron: '<path d="m15 5-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.500"/><path d="m20 20-4.200-4.200"/>',
  heart: '<path d="M12 20s-7.500-4.600-7.500-10.200A4.300 4.300 0 0 1 12 7.200a4.300 4.300 0 0 1 7.500 2.600C19.500 15.400 12 20 12 20z"/>',
  trash: '<path d="M4.500 7h15M9.500 7V4.500h5V7M6.500 7l.8 12.500h9.400L17.500 7M10 11v5M14 11v5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.500 6.500l4 4"/>',
  more: '<circle cx="12" cy="5" r="1.200"/><circle cx="12" cy="12" r="1.200"/><circle cx="12" cy="19" r="1.200"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.500 4.500 4.500L19 7.500"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.500v2.500M12 19v2.500M2.500 12H5M19 12h2.500M5.300 5.300 7 7M17 17l1.700 1.700M18.700 5.300 17 7M7 17l-1.700 1.700"/>',
  moon: '<path d="M20 14.500A8.500 8.500 0 0 1 9.500 4a8.500 8.500 0 1 0 10.500 10.500z"/>',
  bed: '<path d="M3 18v-12M3 14h18v4M21 14v-2.500a3 3 0 0 0-3-3h-7V14"/><circle cx="7" cy="10.500" r="1.800"/>',
  sparkle: '<path d="M12 3.500 13.800 10l6.700 2-6.700 2L12 20.500 10.200 14l-6.700-2 6.700-2z"/>',
  bookmark: '<path d="M6.500 4h11v16.500L12 16.500l-5.500 4z"/>',
  download: '<path d="M12 4v11M7.500 11 12 15.500 16.500 11M5 19.500h14"/>',
  upload: '<path d="M12 15.500V4.500M7.500 9 12 4.500 16.500 9M5 19.500h14"/>',
  refresh: '<path d="M19.500 12a7.500 7.500 0 1 1-2.300-5.400M19.500 4.500v4h-4"/>',
  flame: '<path d="M12 21c-3.600 0-6.500-2.600-6.500-6.300 0-2.500 1.500-4.300 2.800-5.700.4 1.200 1 2 2 2.500C10 8 11 5 13.500 3c.2 3 2 4.300 3.300 6.200 1 1.400 1.700 3 1.700 5 0 3.900-2.900 6.800-6.500 6.800z"/>',
  target: '<circle cx="12" cy="12" r="8.500"/><circle cx="12" cy="12" r="4.500"/><circle cx="12" cy="12" r=".8"/>',
  star: '<path d="m12 3.500 2.600 5.400 5.900.8-4.300 4.100 1 5.900L12 16.900l-5.200 2.800 1-5.900L3.500 9.700l5.900-.8z"/>',
  minus: '<path d="M5 12h14"/>',
  list: '<path d="M8.500 6.500H20M8.500 12H20M8.500 17.500H20M4.500 6.500h.01M4.500 12h.01M4.500 17.500h.01"/>',
  info: '<circle cx="12" cy="12" r="8.500"/><path d="M12 11v5.500M12 7.800h.01"/>',
  drag: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>',
};

/** icon('heart') → <span class="icon"> ; icon('heart', { fill:true, size:20 }) */
export function icon(name, opts = {}) {
  const size = opts.size || 22;
  const span = document.createElement('span');
  span.className = 'icon' + (opts.class ? ' ' + opts.class : '');
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML =
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${opts.fill ? 'currentColor' : 'none'}" ` +
    `stroke="currentColor" stroke-width="${opts.stroke || 1.6}" stroke-linecap="round" stroke-linejoin="round">${P[name] || P.star}</svg>`;
  return span;
}
export const ICON_NAMES = Object.keys(P);

/* ───────────── navigation ───────────── */

export function navigate(path, { replace = false } = {}) {
  const url = '#' + path;
  if (replace) location.replace(url); else location.hash = path;
}
export function goBack(fallback = '/') {
  if (history.length > 1 && document.referrer !== undefined && window.__sakinaDepth > 0) history.back();
  else navigate(fallback, { replace: true });
}

/* ───────────── page header ───────────── */

/**
 * pageHeader({ title, subtitle, back: '/adhkar' | true | false, actions: [Node] })
 * `back` gives the fallback route when there is no in-app history.
 */
export function pageHeader({ title, subtitle, back = false, actions = [] }) {
  return h('header', { class: 'page-header' },
    back && h('button', {
      class: 'icon-btn', 'aria-label': 'رجوع',
      onclick: () => goBack(typeof back === 'string' ? back : '/'),
    }, icon('back')),
    h('div', { class: 'ph-text' },
      h('h1', { class: 'ph-title' }, title),
      subtitle && h('p', { class: 'ph-sub' }, subtitle),
    ),
    h('div', { class: 'ph-actions' }, actions),
  );
}

/** iconButton('heart', 'المفضلة', onClick, { fill, active }) */
export function iconButton(name, label, onclick, opts = {}) {
  return h('button', { class: 'icon-btn' + (opts.active ? ' active' : ''), 'aria-label': label, title: label, onclick },
    icon(name, opts));
}

/* ───────────── toast ───────────── */

let toastTimer = null;
export function toast(message, { icon: ic = null, duration = 2400 } = {}) {
  let host = document.getElementById('toast');
  if (!host) {
    host = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  clear(host).append(...(ic ? [icon(ic, { size: 18 })] : []), h('span', null, message));
  host.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => host.classList.remove('show'), duration);
}

/* ───────────── bottom sheet / dialogs ───────────── */

/**
 * openSheet({ title, body: Node | [Node], footer: Node | [Node], onClose }) → { close(), el }
 * A modal bottom sheet (centered dialog on wide screens). Closes on backdrop click / Esc.
 */
export function openSheet({ title, body, footer, onClose } = {}) {
  let closed = false;
  const prevFocus = document.activeElement;
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' },
    h('div', { class: 'sheet-grip' }),
    title && h('div', { class: 'sheet-head' },
      h('h2', { class: 'sheet-title' }, title),
      h('button', { class: 'icon-btn', 'aria-label': 'إغلاق', onclick: () => close() }, icon('close')),
    ),
    h('div', { class: 'sheet-body' }, body),
    footer && h('div', { class: 'sheet-foot' }, footer),
  );
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, panel);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close(result) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.classList.remove('open');
    setTimeout(() => backdrop.remove(), 220);
    if (prevFocus && prevFocus.focus) prevFocus.focus();
    if (onClose) onClose(result);
  }
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  requestAnimationFrame(() => {
    backdrop.classList.add('open');
    const first = panel.querySelector('input, textarea, select');
    if (first) first.focus();
  });
  return { close, el: panel };
}

/** confirmSheet({ title, message, confirmLabel, danger }) → Promise<boolean> */
export function confirmSheet({ title = 'تأكيد', message, confirmLabel = 'تأكيد', cancelLabel = 'إلغاء', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const sheet = openSheet({
      title,
      body: h('p', { class: 'sheet-msg' }, message),
      footer: [
        h('button', { class: 'btn btn-ghost', onclick: () => sheet.close() }, cancelLabel),
        h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onclick: () => { answer = true; sheet.close(); } }, confirmLabel),
      ],
      onClose: () => resolve(answer),
    });
  });
}

/** field('العنوان', inputNode, 'hint') → labelled form field */
export function field(label, control, hint) {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    hint && h('span', { class: 'field-hint' }, hint),
  );
}

/* ───────────── progress ring ───────────── */

/** ring(0.6, { size:120, stroke:8, label:'3/5', sub:'اليوم' }) */
export function ring(ratio, { size = 120, stroke = 8, label = '', sub = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, ratio || 0));
  const el = h('div', { class: 'ring' + (clamped >= 1 ? ' complete' : ''), style: { width: size + 'px', height: size + 'px' } });
  el.innerHTML =
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<defs><linearGradient id="ringGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--gold-2)"/><stop offset="1" stop-color="var(--gold)"/></linearGradient></defs>` +
    `<circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>` +
    `<circle class="ring-bar" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="url(#ringGold)" stroke-width="${stroke}" ` +
    `stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - clamped)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
  el.append(h('div', { class: 'ring-center' },
    h('div', { class: 'ring-label' }, label),
    sub && h('div', { class: 'ring-sub' }, sub),
  ));
  return el;
}

/* ───────────── text / dates ───────────── */

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
/** 123 → "١٢٣" (used for ayah markers). The UI itself uses Western digits. */
export function toArabicDigits(n) { return String(n).replace(/\d/g, (d) => AR_DIGITS[d]); }

const fmtLong = new Intl.DateTimeFormat('ar-MA-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = new Intl.DateTimeFormat('ar-MA-u-nu-latn', { day: 'numeric', month: 'long' });
const fmtMonth = new Intl.DateTimeFormat('ar-MA-u-nu-latn', { month: 'long', year: 'numeric' });
let fmtHijri = null;
try { fmtHijri = new Intl.DateTimeFormat('ar-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { /* unsupported */ }

export const formatDate = (d) => fmtLong.format(d);
export const formatDayMonth = (d) => fmtShort.format(d);
export const formatMonth = (d) => fmtMonth.format(d);
export const formatHijri = (d) => (fmtHijri ? fmtHijri.format(d) : '');

/** Arabic plural helper for days: 1 → "يوم واحد", 2 → "يومان", 3-10 → "N أيام", else "N يومًا" */
export function daysLabel(n) {
  if (n === 0) return '0 يوم';
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومان';
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يومًا`;
}

export function haptic(ms = 12) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* ignore */ }
}

/** Debounce helper for search inputs. */
export function debounce(fn, ms = 160) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Download a text file (backup export). */
export function downloadText(filename, text, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
