import { useEffect, useRef, useState } from "react";

const TOKEN_OUTPUT_SPEED_STALE_MS = 6_500;

export interface OutputTokenSample {
  outputTokens: number;
  sampledAtMs: number;
}

export function calculateOutputTokenSpeed(
  previous: OutputTokenSample,
  current: OutputTokenSample,
): number | null {
  const elapsedMs = current.sampledAtMs - previous.sampledAtMs;
  const emittedTokens = current.outputTokens - previous.outputTokens;
  if (elapsedMs <= 0 || emittedTokens <= 0) {
    return null;
  }
  return (emittedTokens * 1_000) / elapsedMs;
}

export function formatOutputTokenSpeed(tokensPerSecond: number): string {
  return tokensPerSecond >= 100
    ? Math.round(tokensPerSecond).toString()
    : tokensPerSecond.toFixed(1);
}

export function useOutputTokenSpeed(
  provider: string | null | undefined,
  status: string | null,
  outputTokens: number | null,
): number | null {
  const previousSampleRef = useRef<OutputTokenSample | null>(null);
  const wasRunningRef = useRef(false);
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tokensPerSecond, setTokensPerSecond] = useState<number | null>(null);

  useEffect(() => {
    const isRunning =
      (provider === "omp" || provider === "pi" || provider === "codex") && status === "running";
    const hasOutputTokens = outputTokens !== null && Number.isFinite(outputTokens);

    if (isRunning && !wasRunningRef.current) {
      wasRunningRef.current = true;
      previousSampleRef.current = hasOutputTokens
        ? { outputTokens, sampledAtMs: Date.now() }
        : null;
      if (staleTimerRef.current) {
        clearTimeout(staleTimerRef.current);
        staleTimerRef.current = null;
      }
      setTokensPerSecond(null);
      return;
    }

    if (hasOutputTokens) {
      const currentSample = { outputTokens, sampledAtMs: Date.now() };
      const previousSample = previousSampleRef.current;
      if (!previousSample || outputTokens < previousSample.outputTokens) {
        previousSampleRef.current = currentSample;
      } else if (outputTokens > previousSample.outputTokens) {
        previousSampleRef.current = currentSample;
        const nextSpeed = calculateOutputTokenSpeed(previousSample, currentSample);
        if (nextSpeed !== null) {
          setTokensPerSecond(nextSpeed);
          clearTimeout(staleTimerRef.current ?? undefined);
          staleTimerRef.current = setTimeout(() => {
            staleTimerRef.current = null;
            previousSampleRef.current = null;
            setTokensPerSecond(null);
          }, TOKEN_OUTPUT_SPEED_STALE_MS);
        }
      }
    }

    if (!isRunning && wasRunningRef.current) {
      wasRunningRef.current = false;
      clearTimeout(staleTimerRef.current ?? undefined);
      staleTimerRef.current = setTimeout(() => {
        staleTimerRef.current = null;
        previousSampleRef.current = null;
        setTokensPerSecond(null);
      }, TOKEN_OUTPUT_SPEED_STALE_MS);
    }
  }, [outputTokens, provider, status]);

  useEffect(
    () => () => {
      clearTimeout(staleTimerRef.current ?? undefined);
    },
    [],
  );

  return tokensPerSecond;
}
