import type { Doc } from "@/convex/_generated/dataModel";

type Shape = Doc<"diningTables">["shape"];

export function TableShape({ shape, seats, className }: { shape: Shape; seats: number; className?: string }) {
  const n = Math.min(Math.max(seats, 1), 12);
  const chair = (x: number, y: number, w: number, h: number, transform?: string) => (
    <rect className="floor-chair" x={x} y={y} width={w} height={h} rx="4" transform={transform} />
  );
  if (shape === "round" || shape === "oval") {
    const chairs = Array.from({ length: n }, (_, i) =>
      <g key={i}>{chair(42, 3, 16, 11, `rotate(${(360 / n) * i} 50 50)`)}</g>);
    return (
      <svg className={className} viewBox="0 0 100 100" aria-hidden="true">
        {chairs}
        {shape === "oval"
          ? <ellipse className="floor-surface" cx="50" cy="50" rx="41" ry="29" />
          : <circle className="floor-surface" cx="50" cy="50" r="33" />}
      </svg>
    );
  }
  const width = shape === "rectangle" ? 150 : 100;
  const length = width - 34;
  let top: number, bottom: number, left: number, right: number;
  if (shape === "rectangle") {
    const ends = n > 6 ? 2 : n % 2;
    left = ends >= 1 ? 1 : 0;
    right = ends > 1 ? 1 : 0;
    top = Math.ceil((n - ends) / 2);
    bottom = Math.floor((n - ends) / 2);
  } else {
    const base = Math.floor(n / 4);
    const remainder = n % 4;
    top = base + (remainder > 0 ? 1 : 0);
    bottom = base + (remainder > 1 ? 1 : 0);
    left = base + (remainder > 2 ? 1 : 0);
    right = base;
  }
  const chairs = [
    ...Array.from({ length: top }, (_, i) => <g key={`t${i}`}>{chair(17 + (length * (i + 1)) / (top + 1) - 8, 3, 16, 11)}</g>),
    ...Array.from({ length: bottom }, (_, i) => <g key={`b${i}`}>{chair(17 + (length * (i + 1)) / (bottom + 1) - 8, 86, 16, 11)}</g>),
    ...Array.from({ length: left }, (_, i) => <g key={`l${i}`}>{chair(3, 17 + (66 * (i + 1)) / (left + 1) - 8, 11, 16)}</g>),
    ...Array.from({ length: right }, (_, i) => <g key={`r${i}`}>{chair(width - 14, 17 + (66 * (i + 1)) / (right + 1) - 8, 11, 16)}</g>),
  ];
  return (
    <svg className={className} viewBox={`0 0 ${width} 100`} aria-hidden="true">
      {chairs}<rect className="floor-surface" x="17" y="17" width={length} height="66" rx="12" />
    </svg>
  );
}
