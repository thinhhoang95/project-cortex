"use client";

interface ShimmeringTextProps {
  text: string;
  className?: string;
}

export default function ShimmeringText({ text, className = "" }: ShimmeringTextProps) {
  return (
    <div className={`relative inline-block font-bold ${className}`}>
      <span className="relative bg-gradient-to-r from-white/20 via-white/90 to-white/20 bg-clip-text text-transparent animate-shimmer bg-[length:200%_100%]">
        {text}
      </span>
      <style jsx>{`
        @keyframes shimmerMove {
          0% {
            background-position: -200% 0;
          }
          100% {
            background-position: 200% 0;
          }
        }
        @keyframes shimmerOpacity {
          0% {
            opacity: 0.55;
          }
          40% {
            opacity: 0.55;
          }
          65% {
            opacity: 1;
          }
          85% {
            opacity: 1;
          }
          100% {
            opacity: 0.55;
          }
        }
        .animate-shimmer {
          will-change: background-position, opacity;
          animation: shimmerMove 1.75s cubic-bezier(.4, 0, .2, 1) infinite,
            shimmerOpacity 1.75s cubic-bezier(.4, 0, .2, 1) infinite;
        }
      `}</style>
    </div>
  );
}