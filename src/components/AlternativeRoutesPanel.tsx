import { useSimStore } from "@/components/useSimStore";
import PanelCloseButton from "@/components/PanelCloseButton";

type Props = {
  embedded?: boolean;
};

export default function AlternativeRoutesPanel({ embedded = false }: Props) {
  const {
    selectedFlightForAnalysis,
    alternativeRoutes,
    alternativeRoutesLoading,
    alternativeRoutesError,
    closeAlternativeRoutesPanel,
    setHoveredAlternativeRoute,
    hoveredAlternativeRoute,
    flights,
  } = useSimStore();

  const selectedFlight = flights.find((f) => f.flightId === selectedFlightForAnalysis);
  let origin = selectedFlight?.origin;
  let destination = selectedFlight?.destination;

  if (alternativeRoutes && Object.keys(alternativeRoutes).length > 0) {
    const segments = Object.values(alternativeRoutes)[0];
    if (segments && segments.length > 0) {
      if (!origin) origin = segments[0].origin_aerodrome;
      if (!destination) destination = segments[0].destination_aerodrome;
    }
  }

  if (!selectedFlightForAnalysis) {
    return null;
  }

  const wrapperClasses = embedded
    ? "w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col"
    : "absolute top-20 right-4 z-50 min-w-[320px] max-w-[400px] max-h-[calc(100vh-6rem)] rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col";

  // Check if the error is actually a 404, which means no routes found
  const is404 = alternativeRoutesError && alternativeRoutesError.includes("404");
  const showEmptyState = !alternativeRoutesLoading && (
    (alternativeRoutes && Object.keys(alternativeRoutes).length === 0) ||
    is404
  );

  // Real error is when it's an error but NOT a 404
  const showError = alternativeRoutesError && !is404;

  return (
    <div className={wrapperClasses}>
      <div className="flex items-center justify-between p-4 border-b border-white/20 flex-shrink-0">
        <h2 className="font-semibold text-lg tracking-tight">Alternative Routes</h2>
        <div className="flex items-center gap-2">
          <PanelCloseButton onClick={closeAlternativeRoutesPanel} ariaLabel="Close alternative routes panel" title="Close panel" />
        </div>
      </div>

      <div className="p-4 flex-1 overflow-y-auto custom-scrollbar">
        <div className="mb-5 bg-white/5 p-3 rounded-lg border border-white/10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <span className="text-slate-400">Flight:</span>
            <span className="font-mono font-semibold text-blue-200">{selectedFlightForAnalysis}</span>
          </div>

          {(origin || destination) && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>Route:</span>
              <div className="flex items-center gap-1.5 font-mono text-slate-200">
                <span>{origin || '???'}</span>
                <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
                <span>{destination || '???'}</span>
              </div>
            </div>
          )}
        </div>

        {alternativeRoutesLoading && (
          <div className="flex flex-col items-center justify-center py-12 text-slate-300 space-y-3">
            <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
            <div className="text-sm font-medium">Calculating routes...</div>
          </div>
        )}

        {showError && (
          <div className="flex flex-col gap-2 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-200">
            <div className="flex items-center gap-2 font-medium text-red-100">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Error loading routes</span>
            </div>
            <div className="text-sm opacity-90 pl-7">
              {alternativeRoutesError}
            </div>
          </div>
        )}

        {showEmptyState && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4 border border-white/10">
              <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
            </div>
            <h3 className="text-white font-medium mb-1">No Alternative Routes</h3>
            <p className="text-sm text-slate-400 max-w-[200px]">
              No viable alternative routes were found for this flight.
            </p>
          </div>
        )}

        {!alternativeRoutesLoading && alternativeRoutes && !is404 && Object.keys(alternativeRoutes).length > 0 && (
          <div className="space-y-3">
            {Object.entries(alternativeRoutes).map(([routeStr, segments]) => {
              const prob = segments[0]?.p_route ?? 0;
              const isHovered = hoveredAlternativeRoute === routeStr;
              return (
                <div
                  key={routeStr}
                  className={`group p-3 rounded-xl border transition-all duration-200 cursor-pointer relative overflow-hidden ${isHovered
                    ? "bg-blue-500/10 border-blue-400/50 shadow-[0_0_15px_rgba(59,130,246,0.15)]"
                    : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"
                    }`}
                  onMouseEnter={() => setHoveredAlternativeRoute(routeStr)}
                  onMouseLeave={() => setHoveredAlternativeRoute(null)}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2 py-1 rounded-md border ${isHovered
                        ? "bg-blue-500/20 text-blue-200 border-blue-500/30"
                        : "bg-white/10 text-slate-300 border-white/10"
                        }`}>
                        {(prob * 100).toFixed(1)}%
                      </span>
                      <span className="text-[10px] uppercase tracking-wider font-medium text-slate-400">Probability</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">{segments.length} segs</span>
                  </div>

                  <div className="text-xs font-mono text-slate-300 break-words leading-relaxed group-hover:text-white transition-colors">
                    {routeStr.split(' -> ').map((point, i, arr) => (
                      <span key={i}>
                        {point}
                        {i < arr.length - 1 && <span className="text-slate-600 mx-1">→</span>}
                      </span>
                    ))}
                  </div>

                  {isHovered && (
                    <div className="absolute inset-0 pointer-events-none rounded-xl ring-1 ring-inset ring-blue-400/30" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
