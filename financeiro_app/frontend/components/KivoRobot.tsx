export type KivoRobotMood = "shy" | "peek" | "idle";

type KivoRobotProps = {
  mood: KivoRobotMood;
  className?: string;
  title?: string;
};

/** Mascote KIVO — tímido (mãos no rosto), espiando ou atento (idle). */
export function KivoRobot({ mood, className = "", title }: KivoRobotProps) {
  const pupilL = mood === "peek" ? 11.1 : 12;
  const pupilR = mood === "peek" ? 19.1 : 20;

  return (
    <svg
      viewBox="0 0 32 32"
      className={`kivo-robot kivo-robot--${mood} ${className}`.trim()}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      <line x1="16" y1="3" x2="16" y2="7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="16" cy="2.2" r="1.6" fill="currentColor" />
      <rect
        x="7"
        y="7.5"
        width="18"
        height="15"
        rx="5"
        fill="rgba(0, 0, 0, 0.2)"
        stroke="currentColor"
        strokeWidth="1.35"
      />
      <rect x="10" y="22" width="12" height="5" rx="2.5" fill="currentColor" opacity="0.35" />
      <g className="kivo-robot-eyes">
        <circle cx="12" cy="14.5" r="2.6" fill="currentColor" />
        <circle cx="20" cy="14.5" r="2.6" fill="currentColor" />
        <circle className="kivo-robot-pupil kivo-robot-pupil--l" cx={pupilL} cy="14.2" r="1" fill="#0a0a0a" />
        <circle className="kivo-robot-pupil kivo-robot-pupil--r" cx={pupilR} cy="14.2" r="1" fill="#0a0a0a" />
      </g>
      <path
        className="kivo-robot-smile"
        d="M12.5 18.2 Q16 20.2 19.5 18.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <g className="kivo-robot-hands">
        <rect x="8" y="11.5" width="7.5" height="5.5" rx="2.2" fill="currentColor" />
        <rect x="16.5" y="11.5" width="7.5" height="5.5" rx="2.2" fill="currentColor" />
      </g>
      <path
        className="kivo-robot-mouth-shy"
        d="M13.5 19.5 h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
