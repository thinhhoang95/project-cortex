'use client';

import ModalDialog from './ModalDialog';
import AgentResultSummaryComponent from './AgentResultSummaryComponent';

interface AgentResultSummaryDialogProps {
  open: boolean;
  onClose: () => void;
  initialRunId?: string | null;
}

export default function AgentResultSummaryDialog({
  open,
  onClose,
  initialRunId,
}: AgentResultSummaryDialogProps) {
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Agent Results Summary"
      description="Review the latest solutions and their optimization impact."
      width="w-[calc(100vw-3rem)]"
      height="h-[calc(100vh-3rem)]"
    >
      <AgentResultSummaryComponent
        className="h-full p-6"
        initialRunId={initialRunId ?? undefined}
      />
    </ModalDialog>
  );
}
