"use client";
import React from "react";

type PrecautionBannerProps = {
  positionClass?: string;
  regulationPrecaution?: boolean;
};

export default function PrecautionBanner({ positionClass = "bottom-4", regulationPrecaution = false }: PrecautionBannerProps) {
  return (
    <div className={`absolute ${positionClass} left-1/2 transform -translate-x-1/2 bg-white-600/30 backdrop-blur-sm text-xs text-gray-400 pointer-events-auto text-center px-4 py-2 rounded-lg z-20`}>
      Experimental work. I'm currently open to work, find me on <a href="https://www.linkedin.com/in/thinh-hoang-571252b7/" target="_blank" rel="noopener noreferrer" className="text-white">LinkedIn</a>.
      <br />
      {regulationPrecaution && <>This Flow Regulation Module is part of my own research and is fundamentally different from Task 4.2 and Task 4.3's.<br /></>}
      Data provided by <a href="https://opensky-network.org/" target="_blank" rel="noopener noreferrer" className="text-white">OpenSky Network</a> and EUROCONTROL as part of the SESAR DeepFlow project.
    </div>
  );
}


