'use client';

import ModalDialog from './ModalDialog';
import AgentResultSummaryComponent from './AgentResultSummaryComponent';
import type { AgentRunRef } from '@/lib/agentRuns';

interface AgentResultSummaryDialogProps {
  open: boolean;
  onClose: () => void;
  initialRun?: AgentRunRef | null;
}

export default function AgentResultSummaryDialog({
  open,
  onClose,
  initialRun,
}: AgentResultSummaryDialogProps) {
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Agent Solutions"
      description="Solutions preview and impact."
      width="w-[calc(100vw-3rem)]"
      height="h-[calc(100vh-3rem)]"
    >
      <AgentResultSummaryComponent
        className="h-full p-6"
        initialRun={initialRun ?? undefined}
      />
    </ModalDialog>
  );
}
