import { memo } from 'react';

function hSeg(x1: number, x2: number, y: number): string {
  return `${x1},${y} ${x1 + 4},${y - 4} ${x2 - 4},${y - 4} ${x2},${y} ${x2 - 4},${y + 4} ${x1 + 4},${y + 4}`;
}
function vSeg(x: number, y1: number, y2: number): string {
  return `${x},${y1} ${x + 4},${y1 + 4} ${x + 4},${y2 - 4} ${x},${y2} ${x - 4},${y2 - 4} ${x - 4},${y1 + 4}`;
}

/** a..g 的多边形（下标与段号一致） */
const SEGMENTS = [
  hSeg(9, 41, 6), // a
  vSeg(43, 8, 44), // b
  vSeg(43, 48, 84), // c
  hSeg(9, 41, 86), // d
  vSeg(7, 48, 84), // e
  vSeg(7, 8, 44), // f
  hSeg(9, 41, 46), // g
];
const SEG_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

export interface SevenSegDigitProps {
  /** 8 个段（a..g, dp）的亮度 0..1 */
  levels: ArrayLike<number>;
  /** 是否接有小数点 */
  hasDp: boolean;
  label?: string;
}

/** 一位七段数码管（SVG）。亮度直接映射到填充不透明度，扫描显示的数码管因此稳定可见。 */
export const SevenSegDigit = memo(function SevenSegDigit({ levels, hasDp, label }: SevenSegDigitProps) {
  const lit: string[] = [];
  for (let s = 0; s < 8; s++) if (levels[s] > 0.02) lit.push(s === 7 ? 'dp' : SEG_NAMES[s]);
  return (
    <div className="vb-digit" title={label}>
      <svg viewBox="-3 -2 60 96" role="img" aria-label={`${label ?? '数码管'}：${lit.length ? lit.join(' ') : '熄灭'}`}>
        <g transform="skewX(-6) translate(8 0)">
          {SEGMENTS.map((pts, s) => (
            <polygon key={s} points={pts} className="vb-seg-off" />
          ))}
          {SEGMENTS.map((pts, s) =>
            levels[s] > 0.004 ? <polygon key={`on${s}`} points={pts} className="vb-seg-on" style={{ opacity: Math.min(1, levels[s]) }} /> : null,
          )}
          {hasDp && (
            <>
              <circle cx={54} cy={86} r={4} className="vb-seg-off" />
              {levels[7] > 0.004 && <circle cx={54} cy={86} r={4} className="vb-seg-on" style={{ opacity: Math.min(1, levels[7]) }} />}
            </>
          )}
        </g>
      </svg>
      {label && <span className="vb-digit-label">{label}</span>}
    </div>
  );
});
