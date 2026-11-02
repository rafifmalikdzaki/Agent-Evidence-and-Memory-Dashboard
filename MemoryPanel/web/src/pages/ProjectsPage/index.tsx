/** ProjectsPage — list + create, wired to /api/v1/projects (slice 4). */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeams } from '@/stores/backend';
import { useProjectStore } from '@/stores/projects';
import './projects.css';

export function ProjectsPage() {
  const navigate = useNavigate();
  const { activeTeamId, teams } = useTeams();
  const { projects, loading, error, fetchProjects, createProject } = useProjectStore();
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (activeTeamId) void fetchProjects(activeTeamId); }, [activeTeamId, fetchProjects]);
  const teamName = teams.find((t) => t.team_id === activeTeamId)?.name ?? activeTeamId ?? '';
  async function onCreate(e: React.FormEvent) {
    e.preventDefault(); if (!activeTeamId || !name.trim()) return; setBusy(true);
    const p = await createProject(activeTeamId, name.trim(), desc.trim()); setBusy(false);
    if (p) { setName(''); setDesc(''); navigate(`/projects/${p.id}`); }
  }
  return (
    <div className="proj-wrap">
      <div className="proj-head"><div><h2 style={{ margin: 0 }}>Projects</h2><div className="proj-muted">Team: {teamName || '— select a team'}</div></div></div>
      <form className="proj-form" onSubmit={onCreate}>
        <input className="proj-input" placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} required style={{ minWidth: 220 }} />
        <input className="proj-input" placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} style={{ minWidth: 260 }} />
        <button className="proj-btn" disabled={busy || !activeTeamId}>{busy ? 'Creating…' : 'Create project'}</button>
      </form>
      {error && <div className="proj-error">{error}</div>}
      {loading ? <p className="proj-muted">Loading projects…</p> : projects.length === 0 ? <p className="proj-muted">No projects yet for this team.</p> : (
        <div className="proj-grid">{projects.map((p) => (
          <div key={p.id} className="proj-card" onClick={() => navigate(`/projects/${p.id}`)}>
            <strong>{p.name}</strong><div className="proj-muted">{p.description || 'No description'}</div>
            <div style={{ marginTop: 8 }}><span className="proj-badge">{p.status}</span><span className="proj-badge">{p.author_type}</span><span className="proj-muted">{new Date(p.created_at).toLocaleString()}</span></div>
          </div>))}</div>)}
    </div>
  );
}
export default ProjectsPage;
