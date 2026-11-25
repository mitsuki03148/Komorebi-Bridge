import { roleAccent } from '../utils/roleAccent';

/**
 * Three small flowers in a row, the same flower as the one that shows while a CLI works, in the three characters' colours
 * (瞳 rose, 光 sage, 響 lavender), one each. It stands in for a "more" icon on the button for new rooms and group chats.
 */
const flowers = [
  { cx: 5, color: roleAccent.AGY.name },
  { cx: 12, color: roleAccent.CODEX.name },
  { cx: 19, color: roleAccent.CLAUDE.name },
];

const handPetals: readonly [number, number, number, number, number][] = [
  [0, 10, 5.1, 3.25, 4.7],
  [71, 10.1, 5.3, 2.95, 4.45],
  [145, 9.9, 5.15, 3.15, 4.65],
  [215, 10, 5.35, 3.0, 4.5],
  [289, 10.1, 5.2, 3.2, 4.6],
];

export function PetalMenuIcon({ className = 'h-3.5 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 5 24 14" aria-hidden="true" className={className} data-icon="flowers">
      {flowers.map(({ cx, color }) => (
        <g key={cx} transform={`translate(${cx} 12) scale(.37) translate(-10 -10)`} data-flower={color}>
          {handPetals.map(([angle, x, y, rx, ry]) => <ellipse key={angle} cx={x} cy={y} rx={rx} ry={ry} fill={color} transform={`rotate(${angle} 10 10)`} />)}
          <circle cx="10" cy="10" r="2.3" fill="#FBF3E4" />
        </g>
      ))}
    </svg>
  );
}
