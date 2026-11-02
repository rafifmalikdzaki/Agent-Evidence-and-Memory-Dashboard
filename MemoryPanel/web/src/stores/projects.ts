/** stores/projects.ts — Projects zustand store (slice 4). Mirrors stores/backend.ts patterns. */
import { create } from 'zustand';
import { projectsApi, type Project } from '@/lib/api/projects';

interface ProjectsState {
  projects: Project[];
  teamId: string | null;
  loading: boolean;
  error: string | null;
  fetchProjects: (teamId: string) => Promise<void>;
  createProject: (teamId: string, name: string, description?: string) => Promise<Project | null>;
  clear: () => void;
}
export const useProjectStore = create<ProjectsState>((set, get) => ({
  projects: [], teamId: null, loading: false, error: null,
  fetchProjects: async (teamId) => {
    if (!teamId) { set({ projects: [], teamId: null }); return; }
    set({ loading: true, error: null, teamId });
    try { const page = await projectsApi.list(teamId); if (get().teamId === teamId) set({ projects: page.items, loading: false }); }
    catch (e) { set({ loading: false, error: e instanceof Error ? e.message : String(e) }); }
  },
  createProject: async (teamId, name, description) => {
    try { const p = await projectsApi.create({ team_id: teamId, name, description: description || null }); set((s) => ({ projects: [p, ...s.projects] })); return p; }
    catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); return null; }
  },
  clear: () => set({ projects: [], teamId: null, error: null }),
}));
