export type FundingThemeKey = "blue" | "cyan" | "yellow" | "purple" | "emerald" | "teal";

export interface FundingThemeClasses {
  spinner: string;
  primaryButton: string;
  activeControl: string;
  accentText: string;
  activeExchangeTab: string;
}

/** Literal class bundles keep every Tailwind utility statically discoverable. */
export const FUNDING_THEME_CLASSES: Record<FundingThemeKey, FundingThemeClasses> = {
  blue: {
    spinner: "border-blue-500",
    primaryButton: "bg-blue-600 hover:bg-blue-700",
    activeControl: "border-blue-600 bg-blue-600 text-white",
    accentText: "text-blue-400",
    activeExchangeTab: "border-blue-600 bg-blue-600 text-white shadow-lg shadow-blue-600/25",
  },
  cyan: {
    spinner: "border-cyan-500",
    primaryButton: "bg-cyan-600 hover:bg-cyan-700",
    activeControl: "border-cyan-600 bg-cyan-600 text-white",
    accentText: "text-cyan-400",
    activeExchangeTab: "border-cyan-600 bg-cyan-600 text-white shadow-lg shadow-cyan-600/25",
  },
  yellow: {
    spinner: "border-yellow-500",
    primaryButton: "bg-yellow-600 hover:bg-yellow-700",
    activeControl: "border-yellow-600 bg-yellow-600 text-white",
    accentText: "text-yellow-400",
    activeExchangeTab: "border-yellow-600 bg-yellow-600 text-white shadow-lg shadow-yellow-600/25",
  },
  purple: {
    spinner: "border-purple-500",
    primaryButton: "bg-purple-600 hover:bg-purple-700",
    activeControl: "border-purple-600 bg-purple-600 text-white",
    accentText: "text-purple-400",
    activeExchangeTab: "border-purple-600 bg-purple-600 text-white shadow-lg shadow-purple-600/25",
  },
  emerald: {
    spinner: "border-emerald-500",
    primaryButton: "bg-emerald-600 hover:bg-emerald-700",
    activeControl: "border-emerald-600 bg-emerald-600 text-white",
    accentText: "text-emerald-400",
    activeExchangeTab: "border-emerald-600 bg-emerald-600 text-white shadow-lg shadow-emerald-600/25",
  },
  teal: {
    spinner: "border-teal-500",
    primaryButton: "bg-teal-600 hover:bg-teal-700",
    activeControl: "border-teal-600 bg-teal-600 text-white",
    accentText: "text-teal-400",
    activeExchangeTab: "border-teal-600 bg-teal-600 text-white shadow-lg shadow-teal-600/25",
  },
};
