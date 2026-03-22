export function flightIdListsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function shouldEnableReset(params: {
  baselineFlightIds: string[];
  resultFlightIds: string[];
  isSubmitting: boolean;
  hasResponse: boolean;
  hasError: boolean;
}): boolean {
  const {
    baselineFlightIds,
    resultFlightIds,
    isSubmitting,
    hasResponse,
    hasError,
  } = params;
  if (baselineFlightIds.length === 0 || isSubmitting) return false;
  return hasResponse || hasError || (
    resultFlightIds.length > 0 && !flightIdListsEqual(resultFlightIds, baselineFlightIds)
  );
}
