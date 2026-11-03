import { alpha, createTheme } from "@mui/material/styles";

// Utraders clean look: solid, borderless surfaces with soft shadows on a calm page, in light or dark.
// Lines are avoided; grouping comes from spacing, tonal fills and shadow.
export const BRAND_GRADIENT = "linear-gradient(135deg, #2bb3ad 0%, #4a8fe7 55%, #5b6ee1 100%)";
export const MONO = '"JetBrains Mono Variable", "SF Mono", Menlo, Consolas, monospace';
const SANS = '"Plus Jakarta Sans Variable", "Segoe UI", system-ui, -apple-system, sans-serif';

const TOKENS = {
  light: {
    page: "#f3f5fa", pageGlow: "#eaf0fb", surface: "#ffffff", subtle: "#f6f7fb", tint: "#eef2fd",
    track: "#e9edf5", trackSelected: "#ffffff", chip: "#eef1f7", input: "#f2f4f9", inputFocus: "#ffffff",
    ink: "#14213d", muted: "#5b6478", line: "rgba(20, 33, 61, 0.06)", hover: "rgba(20, 33, 61, 0.05)",
    primary: "#4a6fe0", accent: "#3557c4", success: "#0e9f6e", error: "#e0445a", warning: "#d68b12", info: "#4a8fe7",
    shadow: "0 1px 2px rgba(16, 24, 40, 0.04), 0 6px 20px rgba(16, 24, 40, 0.06)",
    shadowHover: "0 2px 4px rgba(16, 24, 40, 0.05), 0 12px 32px rgba(16, 24, 40, 0.10)",
    pop: "0 12px 32px rgba(16, 24, 40, 0.16)", bar: "rgba(255, 255, 255, 0.82)", barEdge: "rgba(16, 24, 40, 0.05)",
  },
  dark: {
    page: "#0a0f1a", pageGlow: "#111a2e", surface: "#121a2a", subtle: "#172033", tint: "#1a2540",
    track: "#1b2438", trackSelected: "#2a3654", chip: "#1e2840", input: "#18213a", inputFocus: "#1d2742",
    ink: "#e8edf6", muted: "#97a3b8", line: "rgba(232, 237, 246, 0.07)", hover: "rgba(232, 237, 246, 0.06)",
    primary: "#7c9bf2", accent: "#9db4ff", success: "#34c795", error: "#ff6b7d", warning: "#f0b04a", info: "#78aef2",
    shadow: "0 1px 2px rgba(0, 0, 0, 0.30), 0 8px 24px rgba(0, 0, 0, 0.28)",
    shadowHover: "0 2px 4px rgba(0, 0, 0, 0.35), 0 14px 36px rgba(0, 0, 0, 0.40)",
    pop: "0 14px 40px rgba(0, 0, 0, 0.55)", bar: "rgba(14, 20, 33, 0.86)", barEdge: "rgba(255, 255, 255, 0.05)",
  },
};

// Kept for components that read raw values (hover lift on clickable cards).
export const glass = {
  shadow: TOKENS.light.shadow,
  shadowHover: TOKENS.light.shadowHover,
  blur: "blur(14px) saturate(160%)",
};

export function makeTheme(mode = "light") {
  const t = TOKENS[mode] || TOKENS.light;
  const surface = { backgroundColor: t.surface, backgroundImage: "none", border: 0, boxShadow: t.shadow };
  const frosted = { backgroundColor: t.bar, backgroundImage: "none", backdropFilter: glass.blur, WebkitBackdropFilter: glass.blur, border: 0 };
  return createTheme({
    palette: {
      mode,
      primary: { main: t.primary, contrastText: "#ffffff" },
      secondary: { main: "#1f9e98", contrastText: "#ffffff" },
      success: { main: t.success },
      error: { main: t.error },
      warning: { main: t.warning },
      info: { main: t.info },
      // Darker blue for text on tonal fills; lighter in dark mode so it stays readable.
      accent: { main: t.accent },
      text: { primary: t.ink, secondary: t.muted },
      background: { default: t.page, paper: t.surface, subtle: t.subtle, tint: t.tint },
      divider: t.line,
      action: { hover: t.hover },
    },
    shape: { borderRadius: 14 },
    typography: {
      fontFamily: SANS,
      h1: { fontSize: "1.65rem", fontWeight: 800, letterSpacing: "-0.01em" },
      h2: { fontSize: "1.15rem", fontWeight: 800 },
      h3: { fontSize: "0.95rem", fontWeight: 800 },
      subtitle1: { fontWeight: 700 },
      overline: { fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.08em", lineHeight: 1.6 },
      button: { textTransform: "none", fontWeight: 700 },
    },
    transitions: { duration: { shortest: 120, shorter: 160, short: 200, standard: 240, enteringScreen: 220, leavingScreen: 160 } },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            color: t.ink,
            minHeight: "100vh",
            backgroundColor: t.page,
            backgroundImage: `linear-gradient(180deg, ${t.pageGlow} 0px, ${alpha(t.page, 0)} 420px)`,
            backgroundRepeat: "no-repeat",
            fontVariantNumeric: "tabular-nums",
            transition: "background-color 200ms ease, color 200ms ease",
          },
          "::selection": { background: alpha(t.primary, 0.22) },
          "@media (prefers-reduced-motion: reduce)": {
            "*, *::before, *::after": { animationDuration: "0.01ms !important", transitionDuration: "0.01ms !important" },
          },
        },
      },
      MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: surface, rounded: { borderRadius: 16 } } },
      MuiCard: { styleOverrides: { root: { borderRadius: 16, transition: "transform 200ms ease, box-shadow 200ms ease" } } },
      MuiAppBar: {
        defaultProps: { elevation: 0, color: "transparent" },
        styleOverrides: { root: { ...frosted, borderRadius: 0, boxShadow: `0 1px 0 ${t.barEdge}` } },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 999, paddingInline: 16 },
          containedPrimary: { background: BRAND_GRADIENT, color: "#fff", "&:hover": { background: BRAND_GRADIENT, filter: "brightness(1.05)" } },
          // "Outlined" buttons are drawn as soft tonal fills: no border lines anywhere.
          outlined: { border: 0, backgroundColor: alpha(t.primary, 0.1), color: t.accent, "&:hover": { border: 0, backgroundColor: alpha(t.primary, 0.18) }, "&.Mui-disabled": { border: 0 } },
          text: { "&:hover": { backgroundColor: alpha(t.primary, 0.1) } },
        },
      },
      MuiIconButton: { styleOverrides: { root: { color: t.ink } } },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: { backgroundColor: t.track, border: 0, borderRadius: 999, padding: 3, gap: 2 },
          grouped: { border: 0, borderRadius: "999px !important", margin: 0 },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            textTransform: "none", fontWeight: 700, fontSize: "0.82rem", color: t.muted, paddingBlock: 5, paddingInline: 14, border: 0,
            "&:hover": { backgroundColor: alpha(t.trackSelected, 0.6) },
            "&.Mui-selected, &.Mui-selected:hover": { backgroundColor: t.trackSelected, color: t.ink, boxShadow: "0 1px 3px rgba(16, 24, 40, 0.18)" },
          },
        },
      },
      MuiTabs: { styleOverrides: { root: { minHeight: 42 }, indicator: { height: 3, borderRadius: 3, background: BRAND_GRADIENT } } },
      MuiTab: { styleOverrides: { root: { textTransform: "none", fontWeight: 700, minHeight: 42, color: t.muted, "&.Mui-selected": { color: t.ink } } } },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 700, borderRadius: 999 },
          sizeSmall: { height: 22, fontSize: "0.72rem" },
          // Outlined chips become tonal so no outlines appear.
          outlined: { border: 0, backgroundColor: t.chip },
          outlinedSuccess: { backgroundColor: alpha(t.success, 0.12) },
          outlinedError: { backgroundColor: alpha(t.error, 0.12) },
          outlinedPrimary: { backgroundColor: alpha(t.primary, 0.12) },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { borderBottomColor: t.line, paddingBlock: 8 },
          head: { fontWeight: 800, color: t.muted, fontSize: "0.68rem", letterSpacing: "0.06em", textTransform: "uppercase", backgroundColor: t.subtle, borderBottom: 0 },
        },
      },
      MuiTableRow: { styleOverrides: { root: { transition: "background-color 160ms ease", "&:last-child td": { borderBottom: 0 } } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 20, boxShadow: t.pop } } },
      MuiPopover: { styleOverrides: { paper: { boxShadow: t.pop } } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: t.input, borderRadius: 12, "& fieldset": { borderColor: "transparent" },
            "&:hover fieldset": { borderColor: alpha(t.ink, 0.14) }, "&.Mui-focused": { backgroundColor: t.inputFocus },
          },
        },
      },
      MuiNativeSelect: { styleOverrides: { select: { "& option": { backgroundColor: t.surface, color: t.ink } } } },
      MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: mode === "dark" ? "#2a3654" : alpha(t.ink, 0.92), fontSize: "0.75rem", borderRadius: 8 } } },
      MuiBottomNavigation: { styleOverrides: { root: { ...frosted, borderRadius: 0, height: 64, boxShadow: `0 -1px 0 ${t.barEdge}` } } },
      MuiBottomNavigationAction: {
        styleOverrides: {
          root: { color: t.muted, minWidth: 0, "&.Mui-selected": { color: t.primary } },
          label: { fontWeight: 700, fontSize: "0.7rem", "&.Mui-selected": { fontSize: "0.7rem" } },
        },
      },
      MuiAlert: { styleOverrides: { root: { borderRadius: 12, boxShadow: "none" } } },
      MuiDivider: { styleOverrides: { root: { borderColor: t.line } } },
      MuiLinearProgress: { styleOverrides: { root: { borderRadius: 999 }, bar: { background: BRAND_GRADIENT } } },
      MuiSwitch: { styleOverrides: { switchBase: { "&.Mui-checked + .MuiSwitch-track": { background: BRAND_GRADIENT, opacity: 1 } } } },
    },
  });
}

export default makeTheme("light");
