'use client';

import { useState, useEffect } from 'react';
import { useSimStore } from '@/components/useSimStore';
import { loadSectors } from '@/lib/airspace';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Header() {
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{id: string, type: 'flight' | 'traffic_volume', flight?: any, trafficVolume?: any}>>([]);
  const [trafficVolumes, setTrafficVolumes] = useState<any[]>([]);
  
  const { flights, setFocusMode, setFocusFlightIds, setT, t, setSelectedTrafficVolume } = useSimStore();
  const pathname = usePathname();

  // Load traffic volumes data on component mount
  useEffect(() => {
    const loadTrafficVolumes = async () => {
      try {
        const sectors = await loadSectors("/data/airspace.geojson");
        setTrafficVolumes(sectors.features);
      } catch (error) {
        console.error("Failed to load traffic volumes:", error);
      }
    };
    loadTrafficVolumes();
  }, []);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    setShowSearchResults(true);
    
    // Search for flights by identifier or callsign
    const matchingFlights = flights.filter(flight => 
      String(flight.flightId).toLowerCase().includes(searchQuery.toLowerCase()) ||
      (flight.callSign && String(flight.callSign).toLowerCase().includes(searchQuery.toLowerCase()))
    );
    
    // Search for traffic volumes by ID (exact match, case insensitive)
    const matchingTrafficVolumes = trafficVolumes.filter(volume => 
      volume.properties?.traffic_volume_id?.toLowerCase() === searchQuery.toLowerCase()
    );
    
    const results = [
      ...matchingFlights.map(flight => ({
        id: flight.flightId,
        type: 'flight' as const,
        flight
      })),
      ...matchingTrafficVolumes.map(volume => ({
        id: volume.properties.traffic_volume_id,
        type: 'traffic_volume' as const,
        trafficVolume: volume
      }))
    ];
    
    // Simulate search delay
    setTimeout(() => {
      setSearchResults(results);
      setIsSearching(false);
    }, 500);
  };

  const handleSearchKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleFlightSelect = (flight: any) => {
    // Find the earliest time this flight appears
    const earliestTime = flight.t0;
    
    // If current time is before the flight's start time, jump to start time
    if (t < earliestTime) {
      setT(earliestTime);
    }
    
    // Focus on this flight
    setFocusMode(true);
    setFocusFlightIds(new Set([flight.flightId]));
    
    // Close search results
    setShowSearchResults(false);
    setSearchQuery('');
    
    // Trigger map panning and popup (will need to communicate with MapCanvas)
    // We'll emit a custom event that MapCanvas can listen to
    const event = new CustomEvent('flight-search-select', { 
      detail: { flight } 
    });
    window.dispatchEvent(event);
  };

  const handleTrafficVolumeSelect = (trafficVolume: any) => {
    const trafficVolumeId = trafficVolume.properties.traffic_volume_id;
    
    // Set selected traffic volume (this opens the AirspaceInfo panel)
    setSelectedTrafficVolume(trafficVolumeId, trafficVolume);
    
    // Close search results
    setShowSearchResults(false);
    setSearchQuery('');
    
    // Trigger map panning to traffic volume
    const event = new CustomEvent('traffic-volume-search-select', { 
      detail: { trafficVolume } 
    });
    window.dispatchEvent(event);
  };

  const handleSearchBlur = () => {
    // Delay hiding to allow clicking on results
    setTimeout(() => {
      setShowSearchResults(false);
    }, 200);
  };

  return (
    <header className="absolute top-0 left-0 right-0 z-50 bg-gradient-to-b from-black to-transparent">
      <div className="flex items-center justify-between px-6 py-1">
        <div className="flex items-center">
          <h1 className="text-xl font-bold text-white">Flow's Kitchen</h1>
        </div>
        
        <div className="flex items-center space-x-8">
          <nav className="flex items-center space-x-6">
            <Link href="/" className={`${pathname === '/' ? 'text-blue-300' : 'text-white/80'} hover:text-white transition-colors`}>
              Predictions
            </Link>
            <Link href="/regulations" className={`${pathname === '/regulations' ? 'text-blue-300' : 'text-white/80'} hover:text-white transition-colors`}>
              Regulations
            </Link>
            <Link href="#" className="text-white/80 hover:text-white transition-colors">
              Reroutes
            </Link>
          </nav>
          
          <div className="relative">
            <input
              type="text"
              placeholder="Search flights or traffic volumes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={handleSearchKeyPress}
              onBlur={handleSearchBlur}
              onFocus={() => searchQuery && setShowSearchResults(true)}
              className="w-80 px-4 py-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/30 focus:bg-white/15 transition-all"
            />
            <svg 
              className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/60" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            
            {showSearchResults && (
              <div className="absolute top-full mt-2 w-full bg-white/80 backdrop-blur-sm border border-white/20 rounded-lg shadow-xl max-h-64 overflow-y-auto z-50">
                {isSearching ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-slate-700"></div>
                    <span className="ml-2 text-slate-700 text-sm">Searching...</span>
                  </div>
                ) : searchResults.length > 0 ? (
                  <div className="py-2">
                    {searchResults.map((result) => (
                      <button
                        key={result.id}
                        onClick={() => result.type === 'flight' ? handleFlightSelect(result.flight) : handleTrafficVolumeSelect(result.trafficVolume)}
                        className="w-full px-4 py-3 text-left hover:bg-white/20 transition-colors border-b border-white/10 last:border-b-0"
                      >
                        {result.type === 'flight' ? (
                          <>
                            <div className="text-sm font-medium text-slate-900">
                              <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mr-2"></span>
                              {result.flight.flightId}
                            </div>
                            <div className="text-xs text-slate-600">
                              {result.flight.callSign && `Callsign: ${result.flight.callSign}`}
                              {result.flight.origin && result.flight.destination && 
                                ` • ${result.flight.origin} → ${result.flight.destination}`
                              }
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-sm font-medium text-slate-900">
                              <span className="inline-block w-2 h-2 bg-orange-500 rounded-full mr-2"></span>
                              {result.trafficVolume.properties.traffic_volume_id}
                            </div>
                            <div className="text-xs text-slate-600">
                              Traffic Volume • FL {result.trafficVolume.properties.min_fl}-{result.trafficVolume.properties.max_fl}
                              {result.trafficVolume.properties.airspace_id && 
                                ` • ${result.trafficVolume.properties.airspace_id}`
                              }
                            </div>
                          </>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="py-4 px-4 text-sm text-slate-600">
                    No flights or traffic volumes found matching "{searchQuery}"
                  </div>
                )}
              </div>
            )}
          </div>
          
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-white/10 transition-colors"
            >
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                <span className="text-white font-medium text-sm">TH</span>
              </div>
              <div className="text-left">
                <div className="text-xs text-white/60">Welcome back, Chef!</div>
                <div className="text-sm text-white font-medium">Thinh Hoang Dinh</div>
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