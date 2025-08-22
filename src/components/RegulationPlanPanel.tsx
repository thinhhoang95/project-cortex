"use client";
import { useState } from "react";

interface RegulationData {
  id: string;
  trafficVolume: string;
  type: string;
  status: "Active" | "Pending" | "Expired";
  startTime: string;
  endTime: string;
  rate: number;
  delay: number;
  affectedFlights: number;
}

const dummyRegulations: RegulationData[] = [
  {
    id: "REG001",
    trafficVolume: "LFPGCTA",
    type: "Flow Control",
    status: "Active",
    startTime: "08:30",
    endTime: "12:00",
    rate: 15,
    delay: 12,
    affectedFlights: 45
  },
  {
    id: "REG002", 
    trafficVolume: "EDDFAPP",
    type: "ATFM",
    status: "Active",
    startTime: "09:15",
    endTime: "14:30",
    rate: 20,
    delay: 8,
    affectedFlights: 32
  },
  {
    id: "REG003",
    trafficVolume: "EGLLAPP",
    type: "Weather",
    status: "Pending",
    startTime: "11:00",
    endTime: "16:00",
    rate: 12,
    delay: 15,
    affectedFlights: 67
  },
  {
    id: "REG004",
    trafficVolume: "LIRF002",
    type: "Capacity",
    status: "Active",
    startTime: "07:45",
    endTime: "10:30",
    rate: 18,
    delay: 5,
    affectedFlights: 28
  },
  {
    id: "REG005",
    trafficVolume: "LEMD001",
    type: "Flow Control",
    status: "Expired",
    startTime: "06:00",
    endTime: "08:00",
    rate: 22,
    delay: 3,
    affectedFlights: 19
  }
];

interface RegulationPlanPanelProps {
  isRegulationPanelOpen: boolean;
}

export default function RegulationPlanPanel({ isRegulationPanelOpen }: RegulationPlanPanelProps) {
  const [selectedRegulation, setSelectedRegulation] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"All" | "Active" | "Pending" | "Expired">("All");

  const filteredRegulations = dummyRegulations.filter(reg => 
    filterStatus === "All" || reg.status === filterStatus
  );

  const getStatusColor = (status: RegulationData["status"]) => {
    switch (status) {
      case "Active": return "text-green-400 bg-green-400/20 border-green-400/30";
      case "Pending": return "text-yellow-400 bg-yellow-400/20 border-yellow-400/30";
      case "Expired": return "text-gray-400 bg-gray-400/20 border-gray-400/30";
      default: return "text-gray-400 bg-gray-400/20 border-gray-400/30";
    }
  };

  return (
    <div 
      className={`absolute top-20 z-40 min-w-[380px] max-w-[450px] max-h-[calc(100vh-6rem)]
                  rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md
                  shadow-xl text-white flex flex-col transition-all duration-300 ${
                    isRegulationPanelOpen ? 'right-[380px]' : 'right-4'
                  }`}
    >
      <div className="flex items-center justify-between p-4 border-b border-white/20 flex-shrink-0">
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-70">Active Network</div>
          <div className="text-lg font-semibold">Regulation Plan</div>
          <div className="text-xs opacity-80">
            {filteredRegulations.filter(r => r.status === "Active").length} Active, {filteredRegulations.filter(r => r.status === "Pending").length} Pending
          </div>
        </div>
      </div>

      <div className="overflow-y-auto no-scrollbar p-4 flex-1 space-y-4">
        {/* Status Filter */}
        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
          <div className="font-medium text-sm opacity-90 mb-2">Filter by Status</div>
          <div className="grid grid-cols-4 gap-2">
            {(["All", "Active", "Pending", "Expired"] as const).map((status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`px-2 py-1 text-xs font-medium rounded-md backdrop-blur-sm border transition-all duration-200 ${
                  filterStatus === status 
                    ? 'bg-blue-500/30 border-blue-400/50 text-blue-200' 
                    : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15 hover:border-white/30'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Regulations Table */}
        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="font-medium text-sm opacity-90">
              Regulations ({filteredRegulations.length})
            </div>
            <button className="text-xs px-2 py-1 rounded border border-white/20 hover:bg-white/10">
              Export
            </button>
          </div>
          
          {filteredRegulations.length === 0 ? (
            <div className="text-xs opacity-70 text-center py-4">
              No regulations found for the selected filter.
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto no-scrollbar">
              <div className="space-y-2">
                {filteredRegulations.map((reg) => (
                  <div
                    key={reg.id}
                    onClick={() => setSelectedRegulation(selectedRegulation === reg.id ? null : reg.id)}
                    className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 ${
                      selectedRegulation === reg.id
                        ? 'bg-white/15 border-white/30'
                        : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="font-mono text-sm font-semibold">{reg.id}</div>
                        <div className="text-xs opacity-80">{reg.trafficVolume}</div>
                      </div>
                      <div className={`px-2 py-1 rounded-full text-[10px] font-medium border ${getStatusColor(reg.status)}`}>
                        {reg.status}
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="opacity-70">Type:</span> {reg.type}
                      </div>
                      <div>
                        <span className="opacity-70">Rate:</span> {reg.rate}/h
                      </div>
                      <div>
                        <span className="opacity-70">Time:</span> {reg.startTime}-{reg.endTime}
                      </div>
                      <div>
                        <span className="opacity-70">Delay:</span> {reg.delay}min
                      </div>
                    </div>
                    
                    {selectedRegulation === reg.id && (
                      <div className="mt-3 pt-3 border-t border-white/20">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="opacity-70">Affected Flights:</span>
                            <div className="font-semibold text-orange-300">{reg.affectedFlights}</div>
                          </div>
                          <div>
                            <span className="opacity-70">Avg Delay:</span>
                            <div className="font-semibold text-red-300">{reg.delay} min</div>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-2">
                          <button className="flex-1 px-2 py-1 rounded text-[10px] bg-blue-500/20 border border-blue-400/30 text-blue-200 hover:bg-blue-500/30">
                            View Details
                          </button>
                          <button className="flex-1 px-2 py-1 rounded text-[10px] bg-orange-500/20 border border-orange-400/30 text-orange-200 hover:bg-orange-500/30">
                            Modify
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white/10 rounded-lg p-2">
            <div className="text-[10px] opacity-70">Total Delays</div>
            <div className="text-sm font-semibold text-red-300">
              {filteredRegulations.reduce((sum, reg) => sum + reg.delay * reg.affectedFlights, 0)} min
            </div>
          </div>
          <div className="bg-white/10 rounded-lg p-2">
            <div className="text-[10px] opacity-70">Affected Flights</div>
            <div className="text-sm font-semibold text-orange-300">
              {filteredRegulations.reduce((sum, reg) => sum + reg.affectedFlights, 0)}
            </div>
          </div>
          <div className="bg-white/10 rounded-lg p-2">
            <div className="text-[10px] opacity-70">Avg Rate</div>
            <div className="text-sm font-semibold text-cyan-300">
              {Math.round(filteredRegulations.reduce((sum, reg) => sum + reg.rate, 0) / filteredRegulations.length || 0)}/h
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button className="flex-1 px-3 py-2 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 text-white font-medium shadow hover:opacity-90 flex items-center justify-center gap-2 text-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2v20M2 12h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            New Regulation
          </button>
          <button className="px-3 py-2 rounded-xl border border-white/30 bg-white/10 hover:bg-white/20 text-white font-medium shadow text-sm">
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}