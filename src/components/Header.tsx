'use client';

import { useState, useEffect } from 'react';
import { useSimStore } from '@/components/useSimStore';
import { useThemeStore } from '@/components/useThemeStore';
import { loadSectors } from '@/lib/airspace';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clearAppCache } from '@/lib/cache';

export default function Header() {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showAnalyticsDropdown, setShowAnalyticsDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{id: string, type: 'flight' | 'traffic_volume', flight?: any, trafficVolume?: any}>>([]);
  const [trafficVolumes, setTrafficVolumes] = useState<any[]>([]);
  
  const router = useRouter();
  const { flights, setFocusMode, setFocusFlightIds, setT, t, setSelectedTrafficVolume, logout, user } = useSimStore();
  const { theme, toggleTheme } = useThemeStore();
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
    <header className="absolute top-0 left-0 right-0 z-[2000] bg-gradient-to-b from-black to-transparent">
      <div className="flex items-center justify-between px-6 py-1">
        <div className="flex items-center">
          <h1 className="text-xl font-bold text-white">Flow&apos;s Kitchen</h1>
        </div>
        
        <div className="flex items-center space-x-8">
          <nav className="flex items-center space-x-6">
            <Link href="/" className={`${pathname === '/' ? 'text-blue-300' : 'text-white/80'} hover:text-white transition-colors`}>
              Monitoring
            </Link>
            <Link href="/regulations" className={`${pathname === '/regulations' ? 'text-blue-300' : 'text-white/80'} hover:text-white transition-colors`}>
              Regulations
            </Link>
            <Link href="/flows" className={`${pathname && pathname.startsWith('/flows') ? 'text-blue-300' : 'text-white/80'} hover:text-white transition-colors`}>
              DeepFlow
            </Link>
            <div className="relative">
              <button
                onClick={() => setShowAnalyticsDropdown(!showAnalyticsDropdown)}
                className={`${pathname?.includes('/original_count') || pathname?.includes('/flow-evaluation') || pathname?.includes('/regulation-comparison') || pathname?.includes('/solution-comparison') ? 'text-blue-300' : 'text-white/80'} hover:text-white transition-colors`}
              >
                Analytics
              </button>
              {showAnalyticsDropdown && (
                <div className="absolute left-0 top-full mt-2 w-56 glass-menu rounded-lg shadow-xl z-[2100]">
                  <Link
                    href="/original_count"
                    onClick={() => setShowAnalyticsDropdown(false)}
                    className="block w-full px-4 py-3 text-left text-sm rounded-lg transition-colors hover:bg-[var(--menu-hover-bg)]"
                  >
                    Current Occupancy
                  </Link>
                  <Link
                    href="/regulation-comparison"
                    onClick={() => setShowAnalyticsDropdown(false)}
                    className="block w-full px-4 py-3 text-left text-sm rounded-lg transition-colors hover:bg-[var(--menu-hover-bg)]"
                  >
                    Compare Regulations Plans
                  </Link>
                  <Link
                    href="/solution-comparison"
                    onClick={() => setShowAnalyticsDropdown(false)}
                    className="block w-full px-4 py-3 text-left text-sm rounded-lg transition-colors hover:bg-[var(--menu-hover-bg)]"
                  >
                    Compare DeepFlow Plans
                  </Link>
                  {/* <Link
                    href="/flow-evaluation"
                    onClick={() => setShowAnalyticsDropdown(false)}
                    className="block w-full px-4 py-3 text-left text-slate-700 hover:text-slate-900 hover:bg-white/20 transition-colors rounded-lg"
                  >
                    Flow Evaluation
                  </Link> */}
                  
                </div>
              )}
            </div>
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
              className="w-80 px-4 py-2 glass-input backdrop-blur-sm rounded-full focus:outline-none focus:ring-2 focus:ring-white/30 focus:bg-[var(--panel-bg-muted)] transition-all"
            />
            <svg
              className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--panel-text-muted)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            
            {showSearchResults && (
              <div className="absolute top-full mt-2 w-full glass-menu rounded-lg max-h-64 overflow-y-auto z-[2100]">
                {isSearching ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[color:var(--menu-text)]"></div>
                    <span className="ml-2 text-sm text-[var(--menu-text-muted)]">Searching...</span>
                  </div>
                ) : searchResults.length > 0 ? (
                  <div className="py-2">
                    {searchResults.map((result) => (
                      <button
                        key={result.id}
                        onClick={() => result.type === 'flight' ? handleFlightSelect(result.flight) : handleTrafficVolumeSelect(result.trafficVolume)}
                        className="w-full px-4 py-3 text-left transition-colors border-b border-[var(--menu-border)] last:border-b-0 hover:bg-[var(--menu-hover-bg)]"
                      >
                        {result.type === 'flight' ? (
                          <>
                            <div className="text-sm font-medium text-[var(--menu-text)]">
                              <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mr-2"></span>
                              {result.flight.flightId}
                            </div>
                            <div className="text-xs text-[var(--menu-text-muted)]">
                              {result.flight.callSign && `Callsign: ${result.flight.callSign}`}
                              {result.flight.origin && result.flight.destination &&
                                ` • ${result.flight.origin} → ${result.flight.destination}`
                              }
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-sm font-medium text-[var(--menu-text)]">
                              <span className="inline-block w-2 h-2 bg-orange-500 rounded-full mr-2"></span>
                              {result.trafficVolume.properties.traffic_volume_id}
                            </div>
                            <div className="text-xs text-[var(--menu-text-muted)]">
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
                  <div className="py-4 px-4 text-sm text-[var(--menu-text-muted)]">
                    No flights or traffic volumes found matching &ldquo;{searchQuery}&rdquo;
                  </div>
                )}
              </div>
            )}
          </div>
          
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-[var(--panel-bg-muted)] transition-colors"
            >
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                <span className="text-white font-medium text-sm">NO</span>
              </div>
              <div className="text-left">
                <div className="text-xs text-white/60">Welcome back, Chef!</div>
                <div className="text-sm text-white font-medium">{user?.displayName ? (user?.organization ? `${user.displayName} (${user.organization})` : user.displayName) : 'Network Operator'}</div>
              </div>
            </button>
            
            {showDropdown && (
              <div className="absolute right-0 top-full mt-2 w-56 glass-menu rounded-lg shadow-xl z-[2100]">
                <button
                  onClick={async () => {
                    await clearAppCache();
                    setShowDropdown(false);
                    // Give lightweight feedback; keep UX simple for now
                    alert('Cached data cleared');
                  }}
                  className="w-full px-4 py-3 text-left text-sm transition-colors rounded-lg hover:bg-[var(--menu-hover-bg)]"
                >
                  Clear Cache
                </button>
                <button
                  onClick={() => {
                    toggleTheme();
                  }}
                  className="w-full px-4 py-3 text-left text-sm transition-colors rounded-lg hover:bg-[var(--menu-hover-bg)] flex items-center justify-between"
                >
                  <span>Appearance</span>
                  <span className="text-xs uppercase glass-menu-muted">{theme === 'dark' ? 'Dark' : 'Light'}</span>
                </button>
                <button
                  onClick={() => {
                    setShowDropdown(false);
                    logout();
                    router.push('/login');
                  }}
                  className="w-full px-4 py-3 text-left text-sm transition-colors rounded-lg hover:bg-[var(--menu-hover-bg)]"
                >
                  Sign Out
                </button>
                <div className="mx-4 my-2 glass-menu-divider" />
                <div className="px-4 pb-3 text-xs glass-menu-muted">
                  Version 25.09.19.0 (summerbreeze)
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
