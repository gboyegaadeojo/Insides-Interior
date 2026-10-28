import { useMatches } from "react-router";
import type { Module } from "~/styles/tokens";

/** Route `handle` fields the shell reads: module colour and top-bar title. */
export interface AppHandle {
  module?: Module;
  title?: string;
}

/** The deepest matched route's module and title. */
export function useAppHandle(): Required<AppHandle> {
  const matches = useMatches();
  let module: Module = "home";
  let title = "Home";
  for (const match of matches) {
    const handle = match.handle as AppHandle | undefined;
    if (handle?.module) module = handle.module;
    if (handle?.title) title = handle.title;
  }
  return { module, title };
}
