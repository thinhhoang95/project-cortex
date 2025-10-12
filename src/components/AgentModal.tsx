'use client';

import { useState } from 'react';
import AgentRunResultsList from './AgentRunResultsList';

interface AgentModalProps {
  open: boolean;
  onClose: () => void;
  onShowSummary?: (runId: string) => void;
}

export default function AgentModal({ open, onClose, onShowSummary }: AgentModalProps) {
  const [promptText, setPromptText] = useState('');

  const promptHints: string[] = [
    'Help me plan for regulations with Regulation Agent, budget 1024 sims',
    'Help me regulate Upper Munich Airspace from 10:00 - 12:00',
    'Design a regulation plan with minimal total delay and bounded max delay',
    'Identify hotspots between 09:00 - 13:00 and propose cap adjustments',
    'Compare two regulation plans for Frankfurt TMA from 11:00 - 13:00',
  ];

  if (!open) return null;

  const handleRunSelect = (runId: string) => {
    onClose();
    onShowSummary?.(runId);
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
            <div className="absolute inset-0 rounded-[36px] bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-fuchsia-500/10 blur-3xl" />
            <div className="relative rounded-[32px] border border-white/10 bg-white/[0.04] backdrop-blur-2xl text-white shadow-[0_30px_120px_-40px_rgba(59,130,246,0.75)] overflow-hidden">
              <div className="absolute -top-28 -right-20 w-80 h-80 bg-purple-500/20 blur-3xl" />
              <div className="absolute -bottom-32 -left-24 w-[28rem] h-[28rem] bg-blue-500/15 blur-3xl" />
              <div className="relative px-8 py-10 sm:px-12 sm:py-12">
                <div className="flex items-start justify-between gap-6">
                  <div className="space-y-3 max-w-2xl">
                    
                    <h2 className="text-3xl font-semibold text-white">Regulation Agent</h2>
                    <p className="text-sm text-white/60 leading-relaxed">
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
                      <div className="absolute -inset-6 rounded-[36px] bg-gradient-to-br from-blue-500/20 via-purple-500/10 to-pink-500/20 opacity-60 blur-3xl pointer-events-none" aria-hidden />
                      <div className="flex-1 rounded-[30px] bg-gradient-to-br from-blue-500/60 via-purple-500/60 to-fuchsia-500/60 p-[1.5px] shadow-[0_25px_65px_-30px_rgba(76,29,149,0.9)]">
                        <div className="flex flex-col h-full rounded-[30px] border border-white/15 bg-slate-950/65 px-7 py-8 backdrop-blur-[28px] shadow-inner shadow-black/20">
                          <textarea
                            value={promptText}
                            onChange={(e) => setPromptText(e.target.value)}
                            placeholder="Describe your preferred solutions in natural language for the Regulation Agent"
                            className="flex-1 w-full resize-none rounded-[20px] border border-white/5 bg-white/[0.02] px-5 py-4 text-lg leading-relaxed text-white placeholder:text-white/50 focus:border-white/20 focus:outline-none focus:ring-2 focus:ring-purple-400/40"
                          />
                          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <span className="text-sm leading-relaxed text-white/60">
                              Tip: Include time windows (e.g. 10:00-12:00), traffic volume IDs, and a simulation budget (e.g. 1024 sims).
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                // TODO: Handle send action
                                console.log('Sending prompt:', promptText);
                              }}
                              disabled={!promptText.trim()}
                              className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-blue-500 to-purple-600 px-6 py-2.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/60 disabled:from-slate-600 disabled:to-slate-700 disabled:text-white/60 disabled:shadow-none disabled:cursor-not-allowed hover:from-blue-600 hover:to-purple-700 shadow-[0_12px_35px_-18px_rgba(59,130,246,0.8)]"
                            >
                              Send
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded-full no-scrollbar">
                      <div className="flex min-w-max gap-3">
                        {promptHints.map((hint) => (
                          <button
                            key={hint}
                            type="button"
                            onClick={() => setPromptText(hint)}
                            className="whitespace-nowrap rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white/75 transition hover:border-white/25 hover:bg-white/[0.12] hover:text-white"
                          >
                            {hint}
                          </button>
                        ))}
                      </div>
                    </div>

                  </div>

                  <div className="relative h-[500px]">
                    <div
                      className="absolute -inset-8 rounded-[36px] bg-gradient-to-br from-blue-500/20 via-purple-500/10 to-pink-500/20 opacity-70 blur-3xl pointer-events-none"
                      aria-hidden
                    />
                    <div className="absolute inset-0 opacity-20 pointer-events-none">
                      <div className="absolute top-6 left-12 h-28 w-28 rounded-full bg-blue-400/40 blur-3xl animate-pulse" />
                      <div className="absolute bottom-12 right-12 h-36 w-36 rounded-full bg-purple-400/40 blur-3xl animate-pulse [animation-delay:700ms]" />
                    </div>
                    <AgentRunResultsList
                      className="relative z-10 h-full shadow-[0_20px_60px_-30px_rgba(59,130,246,0.8)]"
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
