import { MODULES, type Module, NEUTRALS, PALETTE } from "~/styles/tokens";

/** <meta name="theme-color"> per module (DS-PLT-04): the module tint, dark canvas in dark mode. */
export function themeColors(module: Module) {
  return { light: PALETTE[MODULES[module]].tint, dark: NEUTRALS.canvas!.dark };
}
