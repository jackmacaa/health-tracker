interface Point {
  label: string;
  value: number;
}

interface Props {
  data: Point[];
  height?: number;
  color?: string;
}

export default function Sparkline({
  data,
  height = 80,
  color = "#16a34a",
}: Props) {
  if (!data || data.length === 0) return <div className="empty">No data</div>;
  const width = Math.max(140, data.length * 40);
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const gainColor = "#ef4444"; // red for gains

  const points = data.map((d, i) => {
    const x = i * step;
    const y = height - ((d.value - min) / range) * (height - 16) - 8;
    return { x, y, label: d.label, value: d.value };
  });

  const segments = points.map((p, i) => {
    if (i === 0) return null;
    const prev = points[i - 1];
    const isGain = p.value > prev.value;
    return {
      from: prev,
      to: p,
      color: isGain ? gainColor : color,
      isGain,
    };
  });

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Weight trend"
      >
        {segments.map((seg, i) => {
          if (!seg) return null;
          return (
            <line
              key={`segment-${i}`}
              x1={seg.from.x}
              y1={seg.from.y}
              x2={seg.to.x}
              y2={seg.to.y}
              stroke={seg.color}
              strokeWidth={3}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
        {points.map((p, i) => {
          const isGain = i > 0 && points[i].value > points[i - 1].value;
          const pointColor = i === 0 ? color : isGain ? gainColor : color;
          return (
            <g key={`${p.label}-${p.x}`}>
              <circle cx={p.x} cy={p.y} r={4} fill={pointColor} />
              <text
                x={p.x}
                y={p.y - 12}
                textAnchor="middle"
                fontSize="12"
                fontWeight="600"
                fill="#333"
                pointerEvents="none"
              >
                {p.value.toFixed(1)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
