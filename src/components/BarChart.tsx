interface Point {
  label: string;
  value: number;
}

interface Props {
  data: Point[];
  height?: number;
  color?: string;
}

export default function BarChart({ data, height = 80, color = "#3b82f6" }: Props) {
  if (!data || data.length === 0) return <div className="empty">No data</div>;

  const width = Math.max(140, data.length * 40);
  const values = data.map((d) => d.value);
  const max = Math.max(...values);
  const barWidth = data.length > 1 ? (width / data.length) * 0.7 : 30;
  const barSpacing = data.length > 1 ? width / data.length : width;

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Bar chart"
      >
        {data.map((d, i) => {
          const x = i * barSpacing + (barSpacing - barWidth) / 2;
          const barHeight = max > 0 ? (d.value / max) * (height - 20) : 0;
          const y = height - barHeight - 5;

          return (
            <g key={`${d.label}-${i}`}>
              <rect x={x} y={y} width={barWidth} height={barHeight} fill={color} rx={2} />
              {d.value > 0 && (
                <text
                  x={x + barWidth / 2}
                  y={y - 5}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="600"
                  fill="#333"
                  pointerEvents="none"
                >
                  {d.value >= 1000 ? `${(d.value / 1000).toFixed(1)}k` : d.value}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
