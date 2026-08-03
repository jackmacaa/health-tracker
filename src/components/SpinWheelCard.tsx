import type { ReactNode } from "react";

interface WheelSector {
  startDeg: number;
  endDeg: number;
  win: boolean;
}

type WheelColorMode = "binary" | "alternating" | "uniform";

interface WheelColors {
  win?: [string, string];
  lose?: [string, string];
  palette?: [string, string] | [string, string, string] | [string, string, string, string];
}

interface SpinWheelCardProps {
  title: ReactNode;
  description?: ReactNode;
  segments: WheelSector[];
  colorMode: WheelColorMode;
  colors: WheelColors;
  wheelRotation: number;
  wheelSpinning: boolean;
  winBurstActive?: boolean;
  pointerClassName?: string;
  wheelClassName?: string;
  wrapClassName?: string;
  centerClassName?: string;
  buttonLabel: string;
  buttonBusyLabel?: string;
  buttonTitle?: string;
  disabled: boolean;
  onClick: () => void;
  legend?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

function buildWheelGradient(
  segments: WheelSector[],
  colorMode: WheelColorMode,
  colors: WheelColors,
) {
  return `conic-gradient(${segments
    .map((sector, index) => {
      let color = "#ef4444";
      if (colorMode === "binary") {
        const palette = sector.win ? colors.win : colors.lose;
        color = palette ? palette[index % palette.length] : color;
      } else if (colorMode === "alternating") {
        const palette = colors.palette ?? ["#2563eb", "#0f766e"];
        color = palette[index % palette.length];
      } else {
        const palette = colors.palette ?? ["#2563eb", "#0f766e"];
        color = palette[index % palette.length];
      }
      return `${color} ${sector.startDeg}deg ${sector.endDeg}deg`;
    })
    .join(", ")})`;
}

export default function SpinWheelCard({
  title,
  description,
  segments,
  colorMode,
  colors,
  wheelRotation,
  wheelSpinning,
  winBurstActive = false,
  pointerClassName = "",
  wheelClassName = "",
  wrapClassName = "",
  centerClassName = "",
  buttonLabel,
  buttonBusyLabel = "...",
  buttonTitle,
  disabled,
  onClick,
  legend,
  footer,
  children,
}: SpinWheelCardProps) {
  const wheelGradient = buildWheelGradient(segments, colorMode, colors);

  return (
    <div className="card stack">
      <div style={{ fontWeight: 700 }}>{title}</div>
      {description && <div className="item-sub">{description}</div>}
      <div
        className={`goal-wheel-wrap ${wrapClassName} ${winBurstActive ? "is-win-burst" : ""}`.trim()}
      >
        <div
          className={`goal-wheel-pointer ${pointerClassName} ${wheelSpinning ? "is-ticking" : ""}`.trim()}
        />
        <div
          className={`goal-wheel ${wheelClassName} ${wheelSpinning ? "is-spinning" : ""}`.trim()}
          style={{
            transform: `rotate(${wheelRotation}deg)`,
            background: wheelGradient,
          }}
        >
          <button
            className={`goal-wheel-center ${centerClassName}`.trim()}
            type="button"
            disabled={disabled}
            title={buttonTitle}
            onClick={onClick}
          >
            {wheelSpinning ? buttonBusyLabel : buttonLabel}
          </button>
        </div>
        {winBurstActive && (
          <>
            <span className="goal-confetti goal-confetti-1" />
            <span className="goal-confetti goal-confetti-2" />
            <span className="goal-confetti goal-confetti-3" />
            <span className="goal-confetti goal-confetti-4" />
            <span className="goal-confetti goal-confetti-5" />
            <span className="goal-confetti goal-confetti-6" />
          </>
        )}
      </div>
      {legend && <div className="goal-wheel-legend">{legend}</div>}
      {footer && <div className="goal-attempt-box">{footer}</div>}
      {children}
    </div>
  );
}
