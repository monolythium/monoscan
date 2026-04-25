/**
 * Global type augmentations for monoscan.
 *
 * The current pages stash a tiny toast helper on `window.__msToast` (and a
 * matching timer on `window.__msToastT`). Stage 3 will replace this with a
 * real React-context toast — see `plans/monoscan.md`. Until then, declare the
 * fields here so `tsc --noEmit` doesn't fail.
 */
export {};

declare global {
  interface Window {
    __msToast?: ((msg: string) => void) | null;
    // Timer handle returned by setTimeout — typed as any to dodge the
    // node-vs-browser ReturnType<typeof setTimeout> drift.
    __msToastT?: any;
  }
}
