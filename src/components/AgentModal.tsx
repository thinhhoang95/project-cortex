'use client';

import { useState } from 'react';
import ModalDialog from './ModalDialog';

interface AgentModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AgentModal({ open, onClose }: AgentModalProps) {
  const [promptText, setPromptText] = useState('');

  const promptHints: string[] = [
    'Help me plan for regulations with MCTS Agent, budget 1024 sims',
    'Help me regulate Upper Munich Airspace from 10:00 - 12:00',
    'Design a regulation plan with minimal total delay and bounded max delay',
    'Identify hotspots between 09:00 - 13:00 and propose cap adjustments',
    'Compare two regulation plans for Frankfurt TMA from 11:00 - 13:00',
  ];

  return (
    <ModalDialog open={open} onClose={onClose} title={
      <div className="flex items-center gap-3">
        <span>MCTS Agent</span>
      </div>
    }>
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-md shadow-xl">
          <div className="p-3">
            <div className="group rounded-xl p-[1px] bg-gradient-to-r from-blue-400 via-purple-400 to-fuchsia-500 focus-within:shadow-[0_0_0_3px_rgba(59,130,246,0.25)] transition-all flex items-center">
              <textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder="Describe your preferred solutions in natural language for the MCTS Agent"
                className="w-full h-28 resize-none rounded-[10px] px-4 py-3 bg-slate-900/80 border-0 outline-none placeholder-white/55 text-white/95 backdrop-blur-sm"
              />
            </div>
            <div className="flex items-center justify-between mt-3">
              <div className="text-xs text-white/50">
                Tip: You can include time windows (e.g. 10:00-12:00), traffic volume IDs, and a simulation budget (e.g. 1024 sims).
              </div>
              <button
                type="button"
                onClick={() => {
                  // TODO: Handle send action
                  console.log('Sending prompt:', promptText);
                }}
                disabled={!promptText.trim()}
                className="ml-4 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed text-white text-sm font-medium transition-all duration-200 hover:shadow-lg hover:shadow-blue-500/25"
              >
                Send
              </button>
            </div>
          </div>
          <div className="pointer-events-none absolute -bottom-10 -right-6 w-36 h-36 bg-gradient-to-br from-blue-500/25 to-purple-600/25 rounded-full blur-3xl" />
        </div>

        <div className="relative p-[1px] rounded-2xl bg-gradient-to-br from-blue-400/20 to-purple-400/20">
          <div
            className="relative rounded-[14px] border border-white/10 bg-white/[0.04] backdrop-blur-md min-h-[480px] overflow-hidden"
            style={{
              backgroundImage:
                'radial-gradient(800px 400px at -10% -10%, rgba(59,130,246,0.10), transparent), radial-gradient(700px 500px at 110% 120%, rgba(168,85,247,0.10), transparent)'
            }}
          >
            <div className="absolute inset-0 opacity-10 pointer-events-none">
              <div className="absolute top-6 left-10 w-28 h-28 bg-blue-400/30 rounded-full blur-3xl animate-pulse" />
              <div className="absolute bottom-10 right-10 w-36 h-36 bg-purple-400/30 rounded-full blur-3xl animate-pulse [animation-delay:700ms]" />
            </div>

            

            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center space-y-2">
                <div className="relative w-14 h-14 mx-auto rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-white/70">
                    <path d="M12 2L2 7v10c0 5.55 3.84 10 9 10s9-4.45 9-10V7l-10-5z" />
                    <path d="M12 8v8" />
                    <path d="M8 12h8" />
                  </svg>
                  <div className="absolute -inset-2 rounded-2xl bg-gradient-to-r from-blue-500/30 to-purple-500/30 blur-xl opacity-30" />
                </div>
                <div className="text-base font-semibold text-white/85">Oops, Agent is still snoozing</div>
                <div className="text-sm text-white/55 max-w-xl mx-auto px-4">
                  When Agent has a new proposal for you, it will appear here.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}


