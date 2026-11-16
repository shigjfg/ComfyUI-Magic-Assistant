/**
 * Magic Assistant — Shared UI Theme Loader & Modal Utilities
 * Minimal High-End Dark Style (Linear / Vercel / ComfyUI Modern Dark)
 */

export const MA_THEME = {
    bgBackdrop: "rgba(4, 4, 7, 0.72)",
    bg0: "#09090b",
    bg1: "#111114",
    bg2: "#18181c",
    bg3: "#222228",
    bgHover: "#27272e",
    borderSubtle: "rgba(255, 255, 255, 0.07)",
    border: "rgba(255, 255, 255, 0.11)",
    borderStrong: "rgba(255, 255, 255, 0.18)",
    text1: "#f4f4f5",
    text2: "#a1a1aa",
    text3: "#71717a",
    accent: "#6366f1",
    accentHover: "#818cf8",
    accentSoft: "rgba(99, 102, 241, 0.14)",
    accentBorder: "rgba(99, 102, 241, 0.42)",
    success: "#10b981",
    warning: "#f59e0b",
    danger: "#ef4444",
};

export function ensureMagicModalThemeCss() {
    if (typeof document === "undefined") return;
    if (document.querySelector("link[data-magic-modal-theme]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("./magic_modal_theme.css", import.meta.url).href;
    link.setAttribute("data-magic-modal-theme", "1");
    document.head.appendChild(link);
}

// Auto-install on import
ensureMagicModalThemeCss();
