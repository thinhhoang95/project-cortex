export function formatSeeMoreLabel(hiddenCount: number): string {
  const remaining = Math.max(0, hiddenCount);
  if (remaining <= 0) {
    return "See more";
  }

  const noun = remaining === 1 ? "other" : "others";
  return `See more (${remaining} ${noun})…`;
}

export const SEE_LESS_LABEL = "See less";
