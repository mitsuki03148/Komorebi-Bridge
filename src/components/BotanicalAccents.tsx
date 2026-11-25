import type { CLIModelId } from '../types/guild';

/**
 * Restrained Cath Kidston–inspired hand-drawn wildflower motifs:
 * unlined rounded five-petal blossoms, warm cream centers, and soft sage leaves.
 */
const roleFloralPalette: Record<CLIModelId, {
  petal: string;
  petalDark: string;
  inner: string;
  center: string;
  leaf: string;
}> = {
  AGY: {
    petal: '#E3A0AC',
    petalDark: '#D67C8E',
    inner: '#F6CED6',
    center: '#FBF3E4',
    leaf: '#98B89E',
  },
  CODEX: {
    petal: '#FAF2E1',
    petalDark: '#DFD8C4',
    inner: '#FFFDF8',
    center: '#E6BD74',
    leaf: '#8CB094',
  },
  CLAUDE: {
    petal: '#AEB6E2',
    petalDark: '#8F9ED8',
    inner: '#D4DAF3',
    center: '#FBF3E4',
    leaf: '#95B7A0',
  },
};

const fivePetals: readonly [number, number, number, number, number][] = [
  [0, 10, 5.2, 3.3, 4.7],
  [72, 10.2, 5.4, 3.0, 4.5],
  [144, 9.8, 5.2, 3.2, 4.65],
  [216, 10, 5.4, 3.05, 4.55],
  [288, 10.1, 5.25, 3.2, 4.6],
];

/**
 * Miniature wild-rose & sage sprig tucked into stationery corners (Guild Hall nameplate & bookmark card).
 */
export function CornerFloralSprig({
  modelId = 'AGY',
  size = 18,
  className = '',
}: {
  modelId?: CLIModelId;
  size?: number;
  className?: string;
}) {
  const palette = roleFloralPalette[modelId];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      data-floral-sprig={modelId}
      className={`pointer-events-none select-none ${className}`}
    >
      {/* Two asymmetrical sage leaves */}
      <ellipse cx="6.8" cy="14.6" rx="4.4" ry="2.2" transform="rotate(-32 6.8 14.6)" fill={palette.leaf} opacity="0.88" />
      <ellipse cx="16.4" cy="16.8" rx="4.1" ry="2.0" transform="rotate(24 16.4 16.8)" fill={palette.leaf} opacity="0.84" />
      {/* Tiny trailing dot bud */}
      <circle cx="5.2" cy="8.4" r="1.55" fill={palette.petal} opacity="0.78" />
      <circle cx="18.8" cy="11.2" r="1.25" fill={palette.inner} opacity="0.86" />
      {/* Hand-drawn 5-petal wildflower */}
      <g transform="translate(12 11.4) scale(0.56) translate(-10 -10)">
        {fivePetals.map(([angle, x, y, rx, ry]) => (
          <ellipse key={angle} cx={x} cy={y} rx={rx} ry={ry} fill={palette.petal} transform={`rotate(${angle} 10 10)`} />
        ))}
        <circle cx="10" cy="10" r="3.1" fill={palette.inner} opacity="0.5" />
        <circle cx="10" cy="10" r="2.25" fill={palette.center} />
      </g>
    </svg>
  );
}

/**
 * Tiny symmetrical leaf-and-petal bud flanking DaySeparator labels.
 */
export function SeparatorFloralBud({
  flip = false,
  className = '',
}: {
  flip?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 12"
      width="13"
      height="10"
      aria-hidden="true"
      data-separator-bud
      className={`shrink-0 ${flip ? '-scale-x-100' : ''} ${className}`}
    >
      <ellipse cx="4.8" cy="6.4" rx="3.4" ry="1.6" transform="rotate(-14 4.8 6.4)" fill="#9BBBA2" opacity="0.78" />
      <ellipse cx="10.4" cy="4.4" rx="2.3" ry="1.8" transform="rotate(-18 10.4 4.4)" fill="#E3A0AC" opacity="0.86" />
      <ellipse cx="10.7" cy="7.5" rx="2.3" ry="1.7" transform="rotate(18 10.7 7.5)" fill="#EAB2BC" opacity="0.86" />
      <circle cx="12.2" cy="5.9" r="1.4" fill="#FBF3E4" opacity="0.95" />
    </svg>
  );
}

/**
 * Delicate moving blossom / closed bud perched on the tip of the HP (rose) or MP (blue) ribbon.
 */
export function RibbonTipBloom({
  kind,
  pct,
  subtle = false,
}: {
  kind: 'hp' | 'mp';
  pct: number;
  /** Sidebar bars use a flatter, quieter micro-bud so adjacent quota rows stay airy. */
  subtle?: boolean;
}) {
  const low = pct <= 20;
  const clamped = Math.min(100, Math.max(0, pct));
  const petal = kind === 'hp' ? '#E28796' : '#6E99C0';
  const softPetal = kind === 'hp' ? '#F5CAD2' : '#B7D0E8';
  const leaf = kind === 'hp' ? '#96B89D' : '#8DB5A2';
  const size = subtle ? (low ? 7 : 8) : (low ? 8 : 10);

  return (
    <span
      aria-hidden="true"
      data-ribbon-bloom={`${kind}-${low ? 'bud' : 'open'}`}
      style={{ left: `${clamped}%` }}
      className={`pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-[left,transform,opacity] duration-300 motion-reduce:transition-none ${subtle ? 'opacity-85' : ''}`}
    >
      <svg viewBox="0 0 18 18" width={size} height={size} className="overflow-visible drop-shadow-[0_1px_1px_rgba(80,55,45,0.16)]">
        {!subtle && (
          <>
            <ellipse cx="4.5" cy="11.2" rx="3.1" ry="1.4" transform="rotate(-24 4.5 11.2)" fill={leaf} opacity="0.92" />
            <ellipse cx="13.5" cy="11.2" rx="3.1" ry="1.4" transform="rotate(24 13.5 11.2)" fill={leaf} opacity="0.88" />
          </>
        )}
        {low ? (
          <g>
            {subtle && <ellipse cx="6.2" cy="10.4" rx="2.5" ry="1.2" transform="rotate(-22 6.2 10.4)" fill={leaf} opacity="0.88" />}
            <ellipse cx="9" cy="8.2" rx="3.3" ry="4.4" fill={petal} />
            <ellipse cx="9.6" cy="7.6" rx="1.6" ry="2.4" fill={softPetal} opacity="0.65" />
          </g>
        ) : (
          <g transform="translate(9 9) scale(0.55) translate(-10 -10)">
            {fivePetals.map(([angle, x, y, rx, ry]) => (
              <ellipse key={angle} cx={x} cy={y} rx={rx} ry={ry} fill={petal} transform={`rotate(${angle} 10 10)`} />
            ))}
            <circle cx="10" cy="10" r="2.6" fill="#FBF3E4" />
          </g>
        )}
      </svg>
    </span>
  );
}
