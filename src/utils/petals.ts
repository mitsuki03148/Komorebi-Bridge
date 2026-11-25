/**
 * A few small petals drifting up from a pressed button.
 * Both are quiet by design and switch themselves off for people who ask their device for less motion.
 */

export interface PetalVector { dx: number; dy: number; rotate: number; size: number; delay: number; duration: number }

/** Where each petal goes: fanned upwards, a little different each time. `random` is injectable so it can be tested. */
export function petalVectors(count: number, random: () => number = Math.random): PetalVector[] {
  return Array.from({ length: count }, (_, index) => {
    const spread = count === 1 ? 0 : index / (count - 1) - 0.5;
    const angle = (-90 + spread * 110 + (random() - 0.5) * 18) * Math.PI / 180;
    const distance = 16 + random() * 14;
    return {
      dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance - 4,
      rotate: (random() - 0.5) * 140, size: 5 + random() * 3, delay: random() * 50, duration: 520 + random() * 180,
    };
  });
}

const calm = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const isDarkTheme = () => typeof document !== 'undefined' && Boolean(document.documentElement?.classList?.contains('dark'));

const STAR_COLORS = ['#F7E3A3', '#E8ECFF', '#F5D0DC'];
const STAR_CLIP = 'polygon(50% 0%,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0% 50%,38% 38%)';

/** Petals (day) or stars (night) rise from the middle of `host`; they live on the page itself so no parent can clip them. */
export function burstPetals(host: Element, { count = 4, colors }: { count?: number; colors?: string[] } = {}) {
  if (typeof document === 'undefined' || calm()) return;
  try {
    const night = isDarkTheme();
    const palette = colors ?? (night ? STAR_COLORS : ['#F2B8C2', '#F7D2D8', '#E9A3B0']);
    const rect = host.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    petalVectors(count).forEach((petal, index) => {
      const element = document.createElement('span');
      element.setAttribute('aria-hidden', 'true');
      const color = palette[index % palette.length];
      const shape = night
        ? `width:${petal.size * 1.45}px;height:${petal.size * 1.45}px;clip-path:${STAR_CLIP};box-shadow:0 0 6px ${color}`
        : `width:${petal.size}px;height:${petal.size * 1.35}px;border-radius:60% 0 60% 0`;
      element.style.cssText = `position:fixed;left:${x}px;top:${y}px;${shape};` +
        `background:${color};pointer-events:none;z-index:90;opacity:0;will-change:transform,opacity`;
      document.body.appendChild(element);
      const motion = element.animate?.([
        { transform: 'translate(-50%,-50%) scale(.4) rotate(0deg)', opacity: 0 },
        { transform: `translate(calc(-50% + ${petal.dx * 0.5}px),calc(-50% + ${petal.dy * 0.5}px)) scale(1) rotate(${petal.rotate * 0.5}deg)`, opacity: 0.8, offset: 0.3 },
        { transform: `translate(calc(-50% + ${petal.dx}px),calc(-50% + ${petal.dy}px)) scale(.9) rotate(${petal.rotate}deg)`, opacity: 0 },
      ], { duration: petal.duration, delay: petal.delay, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
      if (motion) motion.onfinish = () => element.remove(); else element.remove();
    });
  } catch { /* A missing animation never gets in the way of the press. */ }
}

/** The send button's press: a small spring on the arrow and a few petals. */
export function sendFeedback(button: HTMLElement) {
  burstPetals(button, { count: 5 });
  if (calm()) return;
  try {
    button.querySelector('.guild-action__icon')?.animate?.(
      [{ transform: 'scale(1)' }, { transform: 'scale(.86)', offset: 0.3 }, { transform: 'scale(1.08)', offset: 0.65 }, { transform: 'scale(1)' }],
      { duration: 280, easing: 'cubic-bezier(.3,.9,.4,1)' });
  } catch { /* Cosmetic only. */ }
}
