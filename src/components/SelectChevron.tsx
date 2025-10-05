export default function SelectChevron() {
  return (
    <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-white/70">
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="w-4 h-4"
      >
        <path
          fillRule="evenodd"
          d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.184l3.71-2.954a.75.75 0 0 1 .94 1.168l-4.24 3.38a.75.75 0 0 1-.94 0l-4.24-3.38a.75.75 0 0 1 .02-1.06z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
}
