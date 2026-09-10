import { Bot } from "lucide-react-native";
import { createElement, type ComponentType } from "react";
import { Text } from "react-native";
import { OmpIcon } from "@/components/icons/omp-icon";

export interface ProviderIconProps {
  size: number;
  color: string;
}

export type ProviderIconComponent = ComponentType<ProviderIconProps>;

const OMP_ICON = OmpIcon as unknown as ProviderIconComponent;

const PROVIDER_MONOGRAMS: Record<string, string> = {
  anthropic: "A",
  codex: "CX",
  cursor: "C",
  google: "G",
  groq: "GQ",
  openai: "AI",
  openrouter: "OR",
  pi: "π",
  xai: "xAI",
};
const monogramIcons = new Map<string, ProviderIconComponent>();

export function resolveProviderMonogram(provider: string): string | null {
  const namespace = provider.startsWith("omp:") ? provider.slice(4) : provider;
  if (!namespace || namespace === "omp") return null;
  return (
    PROVIDER_MONOGRAMS[namespace.toLowerCase()] ??
    namespace
      .split(/[^a-z0-9]+/i)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("")
      .slice(0, 2) ??
    null
  );
}

function getMonogramIcon(monogram: string): ProviderIconComponent {
  const cached = monogramIcons.get(monogram);
  if (cached) return cached;
  const ProviderMonogram = ({ size, color }: ProviderIconProps) =>
    createElement(
      Text,
      {
        style: {
          width: size,
          color,
          fontSize: Math.max(8, Math.round(size * 0.48)),
          fontWeight: "700",
          lineHeight: size,
          textAlign: "center",
        },
      },
      monogram,
    );
  ProviderMonogram.displayName = `ProviderMonogram(${monogram})`;
  monogramIcons.set(monogram, ProviderMonogram);
  return ProviderMonogram;
}

export function getProviderIcon(provider: string): ProviderIconComponent {
  if (provider === "omp") return OMP_ICON;
  const monogram = resolveProviderMonogram(provider);
  return monogram ? getMonogramIcon(monogram) : Bot;
}
