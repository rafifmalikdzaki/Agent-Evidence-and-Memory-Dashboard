/** ProjectDetail — tabs Overview / Board / Evidence / Kanban / Skills (slice 4). */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { projectsApi, subscribeProjectStream, type Project, type Message, type EvidenceItem, type Finding, type Board, type BoardColumn, type BoardTask, type ProjectSkill, type AuthorType } from '@/lib/api/projects';
import { skillApi } from '@/lib/api/skills';
import { useTeams } from '@/stores/backend';
import './projects.css';

type Tab = 'overview' | 'board' | 'evidence' | 'kanban' | 'skills';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' }, { id: 'board', label: 'Board' }, { id: 'evidence', label: 'Evidence' },
  { id: 'kanban', label: 'Kanban' }, { id: 'skills', label: 'Skills' },
];
function Prov({ p }: { p: { author_type: string; author_id: string; model: string | null; session_id: string | null } }) {
  return <span className="proj-muted">{p.author_type} · {p.author_id}{p.model ? ` · ${p.model}` : ''}{p.session_id ? ` · session ${p.session_id}` : ''}</span>;
}
function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null); const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const reload = useCallback(() => { setLoading(true); fn().then((d) => { setData(d); setErr(null); }).catch((e) => setErr(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false)); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload]);
  return { data, err, loading, reload, setData };
}

function BoardTab({ id }: { id: string }) {
  const { data, err, reload } = useLoad(() => projectsApi.boardMessages(id), [id]);
  const [live, setLive] = useState(false);
  useEffect(() => subscribeProjectStream(id, (t) => { setLive(true); if (t !== 'ready' && t !== 'ping') reload(); }), [id, reload]);
  const [body, setBody] = useState(''); const [as, setAs] = useState<AuthorType>('human'); const [busy, setBusy] = useState(false);
  async function post(e: React.FormEvent) { e.preventDefault(); if (!body.trim()) return; setBusy(true); try { await projectsApi.postBoardMessage(id, { body: body.trim(), author_type: as }); setBody(''); reload(); } finally { setBusy(false); } }
  const msgs: Message[] = data?.items ?? [];
  return <div>{err && <div className="proj-error">{err}</div>}<div className="proj-muted">{live ? '● live (SSE)' : '○ connecting…'}</div>
    {msgs.length === 0 ? <p className="proj-muted">No messages yet.</p> : msgs.map((m) => <div key={m.id} className={`proj-msg ${m.author_type === 'agent' ? 'agent' : ''}`}><span className="proj-badge">{m.author_type}</span><Prov p={m} /><div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{m.body}</div><div className="proj-muted">{new Date(m.created_at).toLocaleString()}</div></div>)}
    <form className="proj-form" onSubmit={post}><input className="proj-input" placeholder="Write a message…" value={body} onChange={(e) => setBody(e.target.value)} style={{ flex: 1, minWidth: 240 }} />
      <select className="proj-select" value={as} onChange={(e) => setAs(e.target.value as AuthorType)}><option value="human">human</option><option value="agent">agent</option></select>
      <button className="proj-btn" disabled={busy}>Post</button></form></div>;
}

function EvidenceTab({ id }: { id: string }) {
  const ev = useLoad(() => projectsApi.listEvidence(id), [id]);
  const fd = useLoad(() => projectsApi.listFindings(id), [id]);
  const [q, setQ] = useState(''); const [title, setTitle] = useState(''); const [kind, setKind] = useState('note'); const [fTitle, setFTitle] = useState(''); const [busy, setBusy] = useState(false);
  async function search(e: React.FormEvent) { e.preventDefault(); const r = await projectsApi.searchEvidence(id, q); ev.setData(r); }
  async function addEv(e: React.FormEvent) { e.preventDefault(); setBusy(true); try { await projectsApi.createEvidence(id, { title: title.trim(), kind: kind as EvidenceItem['kind'] }); setTitle(''); ev.reload(); } finally { setBusy(false); } }
  async function addFinding(e: React.FormEvent) { e.preventDefault(); setBusy(true); try { await projectsApi.createFinding(id, { title: fTitle.trim(), severity: 'info' }); setFTitle(''); fd.reload(); } finally { setBusy(false); } }
  const statusLabel = (s: string) => (s === 'confirmed' || s === 'resolved' ? 'approved' : s === 'open' ? 'draft' : s);
  return <div>
    <form className="proj-form" onSubmit={search}><input className="proj-input" placeholder="Search evidence…" value={q} onChange={(e) => setQ(e.target.value)} /><button className="proj-btn secondary">Search</button></form>
    {ev.err && <div className="proj-error">{ev.err}</div>}
    <table className="proj-table"><thead><tr><th>Evidence</th><th>Kind</th><th>Provenance</th><th>Created</th></tr></thead><tbody>
      {(ev.data?.items ?? []).map((x) => <tr key={x.id}><td><strong>{x.title}</strong><div className="proj-muted">{x.uri || x.content_ref || ''}</div></td><td>{x.kind}</td><td><Prov p={x} /></td><td>{new Date(x.created_at).toLocaleString()}</td></tr>)}
    </tbody></table>
    <form className="proj-form" onSubmit={addEv}><input className="proj-input" placeholder="New evidence title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <select className="proj-select" value={kind} onChange={(e) => setKind(e.target.value)}>{['file', 'url', 'log', 'screenshot', 'note', 'other'].map((k) => <option key={k}>{k}</option>)}</select>
      <button className="proj-btn" disabled={busy}>Add evidence</button></form>
    <h4>Findings (draft / approved)</h4>
    {(fd.data?.items ?? []).length === 0 ? <p className="proj-muted">No findings.</p> : (fd.data?.items ?? []).map((f: Finding) => <div key={f.id} className="proj-msg"><span className="proj-badge">{statusLabel(f.status)}</span><span className="proj-badge">{f.severity}</span><strong>{f.title}</strong> <Prov p={f} /></div>)}
    <form className="proj-form" onSubmit={addFinding}><input className="proj-input" placeholder="New finding title" value={fTitle} onChange={(e) => setFTitle(e.target.value)} required /><button className="proj-btn" disabled={busy}>Add finding</button></form>
  </div>;
}

function KanbanTab({ id }: { id: string }) {
  const [board, setBoard] = useState<Board | null>(null); const [cols, setCols] = useState<BoardColumn[]>([]); const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [err, setErr] = useState<string | null>(null); const [newCol, setNewCol] = useState(''); const [titles, setTitles] = useState<Record<string, string>>({}); const [boardName, setBoardName] = useState('Sprint');
  const load = useCallback(async () => {
    try { const bs = await projectsApi.listBoards(id); const b = bs.items[0] ?? null; setBoard(b);
      if (b) { const [c, t] = await Promise.all([projectsApi.listColumns(id, b.id), projectsApi.listTasks(id, b.id)]); setCols(c.items); setTasks(t.items); }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  async function setup() { const b = await projectsApi.createBoard(id, boardName.trim() || 'Sprint'); for (const n of ['Todo', 'In Progress', 'Done']) await projectsApi.createColumn(id, b.id, n); await load(); }
  async function addCol(e: React.FormEvent) { e.preventDefault(); if (!board) return; await projectsApi.createColumn(id, board.id, newCol.trim()); setNewCol(''); await load(); }
  async function addTask(colId: string) { if (!board || !titles[colId]?.trim()) return; await projectsApi.createTask(id, board.id, { column_id: colId, title: titles[colId].trim() }); setTitles((s) => ({ ...s, [colId]: '' })); await load(); }
  async function move(task: BoardTask, dir: -1 | 1) { if (!board) return; const idx = cols.findIndex((c) => c.id === task.column_id); const next = cols[idx + dir]; if (!next) return; await projectsApi.moveTask(id, board.id, task.id, next.id); await load(); }
  if (!board) return <div>{err && <div className="proj-error">{err}</div>}<p className="proj-muted">No board yet.</p><div className="proj-form"><input className="proj-input" value={boardName} onChange={(e) => setBoardName(e.target.value)} /><button className="proj-btn" onClick={() => void setup()}>Create board with Todo / In Progress / Done</button></div></div>;
  return <div>{err && <div className="proj-error">{err}</div>}<h4 style={{ marginTop: 0 }}>{board.name}</h4>
    <div className="proj-kanban">{cols.map((c) => <div key={c.id} className="proj-col"><strong>{c.name}</strong>
      {tasks.filter((t) => t.column_id === c.id).map((t) => <div key={t.id} className="proj-task"><div>{t.title}</div><div className="proj-muted">{t.status}</div>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}><button className="proj-btn secondary" onClick={() => void move(t, -1)}>◀</button><button className="proj-btn secondary" onClick={() => void move(t, 1)}>▶</button></div></div>)}
      <div className="proj-form"><input className="proj-input" placeholder="Task title" value={titles[c.id] ?? ''} onChange={(e) => setTitles((s) => ({ ...s, [c.id]: e.target.value }))} /><button className="proj-btn secondary" onClick={() => void addTask(c.id)}>Add</button></div>
    </div>)}</div>
    <form className="proj-form" onSubmit={addCol}><input className="proj-input" placeholder="New column" value={newCol} onChange={(e) => setNewCol(e.target.value)} required /><button className="proj-btn secondary">Add column</button></form></div>;
}

function SkillsTab({ id, teamId }: { id: string; teamId: string | null }) {
  const { data, err, reload } = useLoad(() => projectsApi.listSkills(id), [id]);
  const [pool, setPool] = useState<Array<{ skill_id: string; name: string }>>([]); const [sid, setSid] = useState(''); const [sname, setSname] = useState('');
  useEffect(() => { if (teamId) skillApi.list(teamId).then((xs) => setPool(xs.map((x) => ({ skill_id: x.skill_id, name: x.name })))).catch(() => setPool([])); }, [teamId]);
  const attached = new Map((data?.items ?? []).map((s) => [s.skill_id, s]));
  async function toggle(skill_id: string, name: string, enabled: boolean) { await projectsApi.toggleSkill(id, { skill_id, name, enabled }); reload(); }
  const rows: Array<{ skill_id: string; name: string; enabled: boolean }> = [...pool.map((p) => ({ ...p, enabled: attached.get(p.skill_id)?.enabled ?? false })),
    ...(data?.items ?? []).filter((s: ProjectSkill) => !pool.some((p) => p.skill_id === s.skill_id)).map((s: ProjectSkill) => ({ skill_id: s.skill_id, name: s.name, enabled: s.enabled }))];
  return <div>{err && <div className="proj-error">{err}</div>}
    {rows.length === 0 ? <p className="proj-muted">No skills available. Add one by id below.</p> : rows.map((r) => <div key={r.skill_id} className="proj-msg" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span><strong>{r.name}</strong> <span className="proj-muted">{r.skill_id}</span></span>
      <label><input type="checkbox" checked={r.enabled} onChange={(e) => void toggle(r.skill_id, r.name, e.target.checked)} /> enabled</label></div>)}
    <div className="proj-form"><input className="proj-input" placeholder="skill_id" value={sid} onChange={(e) => setSid(e.target.value)} /><input className="proj-input" placeholder="Name" value={sname} onChange={(e) => setSname(e.target.value)} />
      <button className="proj-btn" onClick={() => sid.trim() && void toggle(sid.trim(), sname.trim() || sid.trim(), true)}>Attach skill</button></div></div>;
}

export function ProjectDetailPage() {
  const { id = '' } = useParams(); const navigate = useNavigate(); const { activeTeamId } = useTeams();
  const [tab, setTab] = useState<Tab>('overview'); const [project, setProject] = useState<Project | null>(null); const [err, setErr] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ messages: number; evidence: number; skills: number } | null>(null);
  useEffect(() => { projectsApi.get(id).then(setProject).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    Promise.all([projectsApi.boardMessages(id), projectsApi.listEvidence(id), projectsApi.listSkills(id)]).then(([m, ev, sk]) => setCounts({ messages: m.total, evidence: ev.total, skills: sk.items.filter((s) => s.enabled).length })).catch(() => setCounts(null)); }, [id]);
  return <div className="proj-wrap"><button className="proj-btn secondary" onClick={() => navigate('/projects')}>← Projects</button>
    {err && <div className="proj-error">{err}</div>}
    <h2 style={{ marginBottom: 4 }}>{project?.name ?? 'Loading…'}</h2>{project && <div className="proj-muted">{project.description || ''} · {project.status} · team {project.team_id}</div>}
    <div className="proj-tabs">{TABS.map((t) => <button key={t.id} className={`proj-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>
    {tab === 'overview' && (project ? <table className="proj-table"><tbody>
      <tr><th>ID</th><td>{project.id}</td></tr><tr><th>Status</th><td>{project.status}</td></tr><tr><th>Created by</th><td><Prov p={project} /></td></tr>
      <tr><th>Created</th><td>{new Date(project.created_at).toLocaleString()}</td></tr><tr><th>Board messages</th><td>{counts?.messages ?? '—'}</td></tr>
      <tr><th>Evidence</th><td>{counts?.evidence ?? '—'}</td></tr><tr><th>Enabled skills</th><td>{counts?.skills ?? '—'}</td></tr></tbody></table> : <p className="proj-muted">Loading…</p>)}
    {tab === 'board' && <BoardTab id={id} />}{tab === 'evidence' && <EvidenceTab id={id} />}{tab === 'kanban' && <KanbanTab id={id} />}{tab === 'skills' && <SkillsTab id={id} teamId={activeTeamId} />}
  </div>;
}
export default ProjectDetailPage;
