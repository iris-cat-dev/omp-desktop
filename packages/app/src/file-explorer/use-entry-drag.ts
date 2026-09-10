import type { ExplorerEntryDragBinding, UseExplorerEntryDragInput } from "./use-entry-drag.types";

const NATIVE_DRAG_BINDING: ExplorerEntryDragBinding = {
  ref: undefined,
  isDropTarget: false,
};

export function useExplorerEntryDrag(_input: UseExplorerEntryDragInput): ExplorerEntryDragBinding {
  return NATIVE_DRAG_BINDING;
}
