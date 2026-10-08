// A small circular slider for an angle, driving a (hidden) <input type="range"> so the
// rest of the page keeps listening to that input. The knob sits where the angle points
// (0° = right, 90° = down, as on screen). Drag it around, or use the arrow keys.
export function dial(input, { step = 5 } = {}) {
  const el = document.createElement('div');
  el.className = 'dial';
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', input.getAttribute('aria-label') ?? input.id);
  el.setAttribute('aria-valuemin', input.min || '0');
  el.setAttribute('aria-valuemax', input.max || '360');
  el.innerHTML = '<span class="dial-knob"></span>';
  const knob = el.firstChild;

  const sync = () => {
    const v = Number(input.value);
    el.setAttribute('aria-valuenow', String(v));
    el.setAttribute('aria-valuetext', `${v}°`);
    el.toggleAttribute('aria-disabled', input.disabled);
    knob.style.setProperty('--a', `${v}deg`);
  };
  const set = (v) => {
    if (input.disabled) return;
    const snapped = ((Math.round(v / step) * step) % 360 + 360) % 360;
    if (String(snapped) === input.value) return;
    input.value = String(snapped);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    sync();
  };
  const fromPointer = (e) => {
    const r = el.getBoundingClientRect();
    set((Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI);
  };
  el.addEventListener('pointerdown', (e) => {
    if (input.disabled) return;
    el.setPointerCapture(e.pointerId);
    fromPointer(e);
  });
  el.addEventListener('pointermove', (e) => el.hasPointerCapture(e.pointerId) && fromPointer(e));
  el.addEventListener('keydown', (e) => {
    const d = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: 45, PageDown: -45 }[e.key];
    if (d == null) return;
    e.preventDefault();
    set(Number(input.value) + d);
  });
  // The input changes elsewhere too (presets, the code panel): follow it.
  input.addEventListener('input', sync);
  addEventListener('bouffont:settings', sync);
  input.after(el);
  input.hidden = true;
  sync();
  return { el, sync };
}
