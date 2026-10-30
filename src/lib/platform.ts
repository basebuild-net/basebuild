export type DesktopPlatform = "macos" | "windows" | "linux";

/** The OS the webview runs on, from the user agent (WKWebView reports "Macintosh"). */
export const desktopPlatform: DesktopPlatform = (() => {
  if (typeof navigator === "undefined") return "linux";
  const ua = navigator.userAgent;
  if (/Macintosh|Mac OS X/.test(ua)) return "macos";
  if (/Windows/.test(ua)) return "windows";
  return "linux";
})();

/** Expose the platform to CSS (`html[data-platform="macos"]`) before first paint. */
export function applyPlatformAttribute(): void {
  document.documentElement.dataset.platform = desktopPlatform;
}
