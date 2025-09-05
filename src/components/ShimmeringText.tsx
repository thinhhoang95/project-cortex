"use client";

interface ShimmeringTextProps {
  text: string;
  className?: string;
  disabled?: boolean;
  theme?: "dark" | "light";
}

export default function ShimmeringText({ text, className = "", disabled = false, theme = "dark" }: ShimmeringTextProps) {
  const isDark = theme === "dark";

  // For dark theme: white text with a darker moving band (shadow effect).
  // For light theme: keep existing lighter shine effect.
  const gradient = isDark
    ? `linear-gradient(90deg,
        rgba(255, 255, 255, 1) 30%,
        rgba(120, 120, 120, 0.5) 50%,
        rgba(255, 255, 255, 1) 70%)`
    : `linear-gradient(90deg,
        rgba(255, 255, 255, 0) 30%,
        rgba(255, 255, 255, 0.5) 50%,
        rgba(255, 255, 255, 0) 70%)`;

  const textColor = isDark ? "transparent" : "#b5b5b5a4";
  const webkitTextFillColor = isDark ? "transparent" : "initial";

  return (
    <div className={`relative inline-block font-bold ${className}`}>
      <span className={`shiny-text ${disabled ? 'disabled' : ''}`}>
        {text}
      </span>
      <style jsx>{`
        .shiny-text {
          color: ${textColor};
          -webkit-text-fill-color: ${webkitTextFillColor};
          background: ${gradient};
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          display: inline-block;
          animation: shine 1.8s linear infinite;
          
        }

        @keyframes shine {
          0%   { background-position: 100% 50%; }
          100% { background-position: -100% 50%; }
        }

        .shiny-text.disabled {
          animation: none;
        }
      `}</style>
    </div>
  );
}
