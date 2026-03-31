import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface TagView {
  title: string;
  path: string;
  name: string;
}

interface StudioUiState {
  visitedViews: TagView[];
  addVisitedView: (view: TagView) => void;
  removeVisitedView: (path: string) => void;
  clearAllViews: () => void;
  clearOtherViews: (path: string) => void;
}

export const useStudioUiStore = create<StudioUiState>()(
  persist(
    (set) => ({
      visitedViews: [],
      addVisitedView: (view) =>
        set((state) => {
          if (state.visitedViews.some((v) => v.path === view.path)) {
            return state;
          }
          return { visitedViews: [...state.visitedViews, view] };
        }),
      removeVisitedView: (path) =>
        set((state) => ({
          visitedViews: state.visitedViews.filter((v) => v.path !== path),
        })),
      clearAllViews: () => set({ visitedViews: [] }),
      clearOtherViews: (path) =>
        set((state) => ({
          visitedViews: state.visitedViews.filter((v) => v.path === path),
        })),
    }),
    {
      name: "studio-ui-storage",
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
