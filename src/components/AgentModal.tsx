'use client';

import { useState } from 'react';
import AgentRunResultsList from './AgentRunResultsList';
import type { AgentRunRef } from '@/lib/agentRuns';

interface AgentModalProps {
  open: boolean;
  onClose: () => void;
  onShowSummary?: (run: AgentRunRef) => void;
}

export default function AgentModal({ open, onClose, onShowSummary }: AgentModalProps) {
  const [promptText, setPromptText] = useState('');

  const promptHints: string[] = [
    'Help me plan for regulations, budget 1024 sims',
    'Help me regulate Upper Munich Airspace from 10:00 - 12:00',
    'Design a regulation plan with minimal total delay and bounded max delay',
    'Identify hotspots between 09:00 - 13:00 and propose cap adjustments',
    'Compare two regulation plans for Frankfurt TMA from 11:00 - 13:00',
  ];

  if (!open) return null;

  const handleRunSelect = (run: AgentRunRef) => {
    onClose();
    onShowSummary?.(run);
  };

  return (
    <div className="fixed inset-0 z-[9999]">
      <div
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-[18px]"
        onClick={onClose}
      />
      <div className="absolute inset-0 overflow-y-auto">
        <div className="min-h-full flex items-center justify-center px-4 py-12">
          <div className="relative w-full max-w-6xl">
            <div className="absolute inset-0 rounded-[36px] bg-gradient-to-br from-cyan-500/10 via-purple-500/10 to-pink-500/10 blur-3xl" />
            <div className="relative rounded-[32px] border border-white/10 bg-slate-950/60 backdrop-blur-3xl text-white shadow-[0_0_120px_-20px_rgba(168,85,247,0.4)] overflow-hidden">
              <div className="absolute -top-28 -right-20 w-80 h-80 bg-pink-500/20 blur-3xl" />
              <div className="absolute -bottom-32 -left-24 w-[28rem] h-[28rem] bg-cyan-500/20 blur-3xl" />
              <div className="relative px-8 py-10 sm:px-12 sm:py-12">
                <div className="flex items-start justify-between gap-6">
                  <div className="space-y-3 max-w-2xl">
                    
                    <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white via-purple-100 to-pink-200 bg-clip-text text-transparent">Regulation Agent</h2>
                    <p className="text-sm text-white/50 leading-relaxed font-medium">
                      By default, up to 12 independent runs with varying parameters will be executed in parallel.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/70 transition hover:border-white/20 hover:bg-white/[0.12] hover:text-white"
                    aria-label="Close agent modal"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6L6 18" />
                      <path d="M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1.15fr),minmax(0,0.85fr)]">
                  <div className="flex h-[500px] flex flex-col space-y-8">
                    <div className="flex flex-col flex-1">
                      <div className="absolute -inset-6 rounded-[36px] bg-gradient-to-br from-cyan-400/20 via-purple-500/20 to-pink-500/20 opacity-80 blur-3xl pointer-events-none" aria-hidden />
                      <div className="flex-1 rounded-[30px] bg-gradient-to-br from-cyan-400 via-purple-500 to-pink-500 p-[2px] shadow-[0_0_80px_-20px_rgba(168,85,247,0.5)]">
                        <div className="flex flex-col h-full rounded-[28px] bg-slate-950/80 px-6 py-6 backdrop-blur-3xl shadow-inner shadow-black/40">
                          <textarea
                            value={promptText}
                            onChange={(e) => setPromptText(e.target.value)}
                            placeholder="Describe your preferred solutions in natural language for the Regulation Agent"
                            className="flex-1 w-full resize-none bg-transparent px-2 py-2 text-lg leading-relaxed text-white placeholder:text-white/40 focus:outline-none"
                          />
                          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between px-2">
                            <span className="text-sm leading-relaxed text-white/50">
                              Tip: Include time windows (e.g. 10:00-12:00), traffic volume IDs, and a simulation budget (e.g. 1024 sims).
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                // TODO: Handle send action
                                console.log('Sending prompt:', promptText);
                              }}
                              disabled={!promptText.trim()}
                              className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 px-7 py-2.5 text-sm font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/60 disabled:from-slate-800 disabled:via-slate-800 disabled:to-slate-800 disabled:text-white/30 disabled:shadow-none disabled:cursor-not-allowed hover:from-cyan-400 hover:via-purple-400 hover:to-pink-400 shadow-[0_0_25px_-5px_rgba(168,85,247,0.6)]"
                            >
                              Send
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="overflow-x-auto p-1 -mx-1 no-scrollbar">
                      <div className="flex min-w-max gap-3">
                        {promptHints.map((hint) => (
                          <button
                            key={hint}
                            type="button"
                            onClick={() => setPromptText(hint)}
                            className="whitespace-nowrap rounded-full border border-white/10 bg-white/[0.03] px-5 py-2 text-sm text-white/70 transition-all hover:border-purple-500/50 hover:bg-purple-500/10 hover:text-white hover:shadow-[0_0_20px_-5px_rgba(168,85,247,0.4)]"
                          >
                            {hint}
                          </button>
                        ))}
                      </div>
                    </div>

                  </div>

                  <div className="relative h-[500px]">
                    <div
                      className="absolute -inset-8 rounded-[36px] bg-gradient-to-br from-cyan-500/20 via-purple-500/15 to-pink-500/20 opacity-70 blur-3xl pointer-events-none"
                      aria-hidden
                    />
                    <div className="absolute inset-0 opacity-30 pointer-events-none">
                      <div className="absolute top-6 left-12 h-32 w-32 rounded-full bg-cyan-400/40 blur-3xl animate-pulse" />
                      <div className="absolute bottom-12 right-12 h-40 w-40 rounded-full bg-pink-400/40 blur-3xl animate-pulse [animation-delay:700ms]" />
                    </div>
                    <AgentRunResultsList
                      className="relative z-10 h-full shadow-[0_0_60px_-20px_rgba(168,85,247,0.4)]"
                      onRunSelect={handleRunSelect}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
