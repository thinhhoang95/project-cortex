import { InputHTMLAttributes, forwardRef } from "react";

export interface SliderProps extends InputHTMLAttributes<HTMLInputElement> { }

export const Slider = forwardRef<HTMLInputElement, SliderProps>(
    ({ className = "", ...props }, ref) => {
        return (
            <input
                type="range"
                ref={ref}
                className={`appearance-none h-1.5 rounded-full bg-[var(--input-border)] accent-sky-400 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 ${className}`}
                {...props}
            />
        );
    }
);

Slider.displayName = "Slider";
