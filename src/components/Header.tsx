'use client';

import { useState } from 'react';

export default function Header() {
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <header className="absolute top-0 left-0 right-0 z-50 bg-gradient-to-b from-black to-transparent">
      <div className="flex items-center justify-between px-6 py-1">
        <div className="flex items-center">
          <h1 className="text-xl font-bold text-white">Flow's Kitchen</h1>
        </div>
        
        <div className="flex items-center space-x-8">
          <nav className="flex items-center space-x-6">
            <a href="#" className="text-white/80 hover:text-white transition-colors">
              Regulations
            </a>
            <a href="#" className="text-white/80 hover:text-white transition-colors">
              Predictions
            </a>
            <a href="#" className="text-white/80 hover:text-white transition-colors">
              Reroutes
            </a>
          </nav>
          
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-white/10 transition-colors"
            >
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                <span className="text-white font-medium text-sm">TH</span>
              </div>
              <div className="text-left">
                <div className="text-xs text-white/60">Signed in as</div>
                <div className="text-sm text-white font-medium">Jensen Hoang</div>
              </div>
            </button>
            
            {showDropdown && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-white/80 backdrop-blur-sm border border-white/20 rounded-lg shadow-xl">
                <button 
                  onClick={() => setShowDropdown(false)}
                  className="w-full px-4 py-3 text-left text-slate-700 hover:text-slate-900 hover:bg-white/20 transition-colors rounded-lg"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}