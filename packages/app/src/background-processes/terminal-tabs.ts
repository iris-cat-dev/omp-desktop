import { create } from "zustand";

// Terminal discovery normally reopens every live standalone terminal. A process-output
// tab is different: closing it hides the view, while the terminal remains discoverable.
export const useBackgroundProcessTerminalTabs = create<{
  hiddenByWorkspace: Record<string, ReadonlySet<string>>;
  setHidden(workspaceKey: string, terminalId: string, hidden: boolean): void;
}>((set) => ({
  hiddenByWorkspace: {},
  setHidden: (workspaceKey, terminalId, hidden) =>
    set((state) => {
      const previous = state.hiddenByWorkspace[workspaceKey];
      if ((previous?.has(terminalId) ?? false) === hidden) return state;
      const ids = new Set(previous);
      if (hidden) ids.add(terminalId);
      else ids.delete(terminalId);
      return { hiddenByWorkspace: { ...state.hiddenByWorkspace, [workspaceKey]: ids } };
    }),
}));
