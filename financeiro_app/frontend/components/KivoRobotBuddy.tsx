export type BuddyPose = "docked" | "idle" | "peek" | "thinking";

type KivoRobotBuddyProps = {
  pose: BuddyPose;
  className?: string;
};

/** Robô corpo inteiro — mascote do assistente no dashboard. */
export function KivoRobotBuddy({ pose, className = "" }: KivoRobotBuddyProps) {
  const pupilL = pose === "peek" ? 19.5 : pose === "docked" ? 20.2 : 20.5;
  const pupilR = pose === "peek" ? 33.5 : pose === "docked" ? 34.2 : 34.5;
  const eyeCy = pose === "thinking" ? 21.8 : pose === "docked" ? 23.2 : 22.5;
  const pupilCy = pose === "docked" ? eyeCy - 1.1 : eyeCy - 0.3;

  return (
    <svg
      viewBox="0 0 56 80"
      className={`kivo-buddy kivo-buddy--${pose} ${className}`.trim()}
      aria-hidden="true"
    >
      <line x1="28" y1="4" x2="28" y2="11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="28" cy="2.8" r="2" fill="currentColor" />

      <rect
        x="14"
        y="12"
        width="28"
        height="22"
        rx="7"
        fill="rgba(0, 0, 0, 0.25)"
        stroke="currentColor"
        strokeWidth="1.5"
      />

      <g className="kivo-buddy-eyes">
        <circle cx="21" cy={eyeCy} r="3.2" fill="currentColor" />
        <circle cx="35" cy={eyeCy} r="3.2" fill="currentColor" />
        <circle className="kivo-buddy-pupil kivo-buddy-pupil--l" cx={pupilL} cy={pupilCy} r="1.2" fill="#0a0a0a" />
        <circle className="kivo-buddy-pupil kivo-buddy-pupil--r" cx={pupilR} cy={pupilCy} r="1.2" fill="#0a0a0a" />
      </g>

      {pose === "thinking" ? (
        <path
          className="kivo-buddy-mouth"
          d="M24 30 h8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      ) : (
        <path
          className="kivo-buddy-mouth"
          d="M22 29.5 Q28 32.5 34 29.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      )}

      <rect x="18" y="36" width="20" height="16" rx="5" fill="currentColor" opacity="0.32" />
      <rect x="16" y="36" width="24" height="16" rx="5" fill="none" stroke="currentColor" strokeWidth="1.3" />

      <g className="kivo-buddy-arms">
        <rect className="kivo-buddy-arm kivo-buddy-arm--l" x="8" y="38" width="7" height="14" rx="3.5" fill="currentColor" opacity="0.85" />
        <rect className="kivo-buddy-arm kivo-buddy-arm--r" x="41" y="38" width="7" height="14" rx="3.5" fill="currentColor" opacity="0.85" />
      </g>

      <g className="kivo-buddy-legs">
        <rect className="kivo-buddy-leg kivo-buddy-leg--l" x="19" y="52" width="8" height="16" rx="4" fill="currentColor" />
        <rect className="kivo-buddy-leg kivo-buddy-leg--r" x="29" y="52" width="8" height="16" rx="4" fill="currentColor" />
      </g>

      <ellipse className="kivo-buddy-shadow" cx="28" cy="76" rx="14" ry="2.5" fill="currentColor" opacity="0.15" />
    </svg>
  );
}
