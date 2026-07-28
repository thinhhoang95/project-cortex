import { ChevronDown } from "lucide-react";
export default function SelectChevron() {
  return (
    <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-white/70">
      <ChevronDown aria-hidden="true" className="w-4 h-4" />
    </div>
  );
}
