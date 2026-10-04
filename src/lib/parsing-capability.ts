export type ParsingMode = "client" | "server";

export type ParsingWorkload = {
  mimeType: string;
  sizeBytes: number;
};

export type ParsingPlan = {
  mode: ParsingMode;
  budgetMs: number;
  reason: string;
};

type ParseObservation = {
  durationMs: number;
  succeeded: boolean;
};

type DeviceSignals = {
  hardwareConcurrency: number;
  deviceMemoryGb?: number;
};

const OBSERVATIONS_KEY = "studybuddy:parsing-observations:v1";
const DEFAULT_BUDGET_MS = 45_000;
const COMPLEX_BUDGET_MS = 30_000;
const MAX_OBSERVATIONS = 8;

function readDeviceSignals(): DeviceSignals {
  if (typeof navigator === "undefined") {
    return { hardwareConcurrency: 2 };
  }

  const deviceMemory = (
    navigator as Navigator & { deviceMemory?: number }
  ).deviceMemory;

  return {
    hardwareConcurrency: Math.max(1, navigator.hardwareConcurrency || 2),
    deviceMemoryGb: deviceMemory,
  };
}

function readObservations(): ParseObservation[] {
  if (typeof window === "undefined") return [];

  try {
    const value = JSON.parse(
      window.localStorage.getItem(OBSERVATIONS_KEY) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter(
          (item): item is ParseObservation =>
            typeof item?.durationMs === "number" &&
            typeof item?.succeeded === "boolean",
        )
      : [];
  } catch {
    return [];
  }
}

export function chooseParsingPlan(workload: ParsingWorkload): ParsingPlan {
  const signals = readDeviceSignals();
  const observations = readObservations();
  const recentFailure = observations.some((observation) => !observation.succeeded);
  const recentSlowParse = observations.some(
    (observation) => observation.durationMs > DEFAULT_BUDGET_MS,
  );
  const isPlainText = workload.mimeType.startsWith("text/");
  const isComplexDocument =
    workload.mimeType === "application/pdf" ||
    workload.mimeType.includes("wordprocessingml") ||
    workload.mimeType.includes("presentationml") ||
    workload.mimeType.startsWith("image/");
  const isLarge = workload.sizeBytes > 8 * 1024 * 1024;
  const isLowMemory =
    signals.deviceMemoryGb !== undefined && signals.deviceMemoryGb <= 2;
  const isLowConcurrency = signals.hardwareConcurrency <= 2;

  if (isPlainText && workload.sizeBytes <= 5 * 1024 * 1024) {
    return {
      mode: "client",
      budgetMs: DEFAULT_BUDGET_MS,
      reason: "small plain-text file",
    };
  }

  if (isComplexDocument && (isLarge || isLowMemory || recentFailure || recentSlowParse)) {
    return {
      mode: "server",
      budgetMs: COMPLEX_BUDGET_MS,
      reason: isLarge
        ? "large document"
        : recentFailure || recentSlowParse
          ? "recent client parsing was unreliable or slow"
          : "complex document on a constrained device",
    };
  }

  return {
    mode: "client",
    budgetMs: isLowConcurrency ? COMPLEX_BUDGET_MS : DEFAULT_BUDGET_MS,
    reason: isLowConcurrency
      ? "client parsing allowed with a conservative budget"
      : "client device signals and workload are suitable",
  };
}

export function recordParsingObservation(observation: ParseObservation): void {
  if (typeof window === "undefined") return;

  try {
    const observations = [...readObservations(), observation].slice(
      -MAX_OBSERVATIONS,
    );
    window.localStorage.setItem(OBSERVATIONS_KEY, JSON.stringify(observations));
  } catch {
    // Storage may be disabled or unavailable; parsing still completed.
  }
}
