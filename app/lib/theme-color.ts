import { NEUTRALS } from "~/styles/tokens";

/**
 * <meta name="theme-color"> (DS-PLT-04): the canvas, so the browser chrome
 * blends with the page (restrained palette: no per-module colour).
 */
export function themeColors() {
  return { light: NEUTRALS.canvas!.light, dark: NEUTRALS.canvas!.dark };
}
