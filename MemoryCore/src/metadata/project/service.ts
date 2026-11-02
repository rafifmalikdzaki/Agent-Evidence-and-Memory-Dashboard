import type { IProjectRepository } from "./repository.js";
import { generateUlid, isUlid } from "./ulid.js";
import type * as T from "./types.js";

export class ProjectError extends Error { constructor(public code: "not_found" | "validation" | "conflict" | "forbidden", msg: string) { super(msg); this.name = "ProjectError"; } }
const now = () => new Date().toISOString();
const req = (v: string, f: string) => { if (!v?.trim()) throw new ProjectError("validation", `${f} required`); return v.trim(); };
function prov(p: T.ProvenanceInput): T.Provenance {
  if (p.author_type && p.author_type !== "human" && p.author_type !== "agent") throw new ProjectError("validation", "author_type must be human|agent");
  return { author_type: p.author_type ?? "human", author_id: req(p.author_id, "author_id"), model: p.model ?? null, session_id: p.session_id ?? null };
}
export class ProjectService {
  constructor(private repo: IProjectRepository) {}
  private mustProject(id: string) { const p = this.repo.getProject(id); if (!p) throw new ProjectError("not_found", `project not found: ${id}`); return p; }
  createProject(i: T.CreateProjectInput): T.Project {
    req(i.team_id, "team_id"); req(i.name, "name");
    const t = now(); const e: T.Project = { id: generateUlid(), team_id: i.team_id, name: i.name.trim(), description: i.description ?? null, status: "active", metadata_json: i.metadata_json ?? "{}", ...prov(i.provenance), created_at: t, updated_at: t };
    this.repo.createProject(e);
    // creator auto-member owner
    this.repo.addMember({ id: generateUlid(), project_id: e.id, user_id: i.provenance.author_id, role: "owner", status: "active", created_at: t, updated_at: t });
    return e;
  }
  getProject(id: string) { return this.mustProject(id); }
  listProjectsByTeam(teamId: string) { return this.repo.listProjectsByTeam(teamId); }
  archiveProject(id: string) { this.mustProject(id); return this.repo.updateProject(id, { status: "archived", updated_at: now() })!; }
  addMember(i: T.AddMemberInput): T.ProjectMember { this.mustProject(i.project_id); req(i.user_id, "user_id"); if (this.repo.getMember(i.project_id, i.user_id)) throw new ProjectError("conflict", "already a member"); const t = now(); const e = { id: generateUlid(), project_id: i.project_id, user_id: i.user_id, role: i.role ?? "member" as T.ProjectRole, status: "active" as const, created_at: t, updated_at: t }; this.repo.addMember(e); return e; }
  listMembers(pid: string) { this.mustProject(pid); return this.repo.listMembers(pid); }
  removeMember(pid: string, uid: string) { this.mustProject(pid); this.repo.removeMember(pid, uid); }
  assertMember(pid: string, uid: string) { if (!this.repo.getMember(pid, uid)) throw new ProjectError("forbidden", `user ${uid} is not a project member`); }

  createThread(i: T.CreateThreadInput): T.Thread { this.mustProject(i.project_id); const t = now(); const e: T.Thread = { id: generateUlid(), project_id: i.project_id, title: req(i.title, "title"), ...prov(i.provenance), created_at: t, updated_at: t }; return this.repo.createThread(e); }
  listThreads(pid: string) { this.mustProject(pid); return this.repo.listThreads(pid); }
  postMessage(i: T.PostMessageInput): T.Message { const th = this.repo.getThread(i.thread_id); if (!th) throw new ProjectError("not_found", `thread not found: ${i.thread_id}`); const t = now(); const e: T.Message = { id: generateUlid(), thread_id: i.thread_id, project_id: th.project_id, body: req(i.body, "body"), ...prov(i.provenance), created_at: t, updated_at: t }; return this.repo.createMessage(e); }
  listMessages(tid: string) { if (!this.repo.getThread(tid)) throw new ProjectError("not_found", `thread not found: ${tid}`); return this.repo.listMessages(tid); }

  createEvidence(i: T.CreateEvidenceInput): T.EvidenceItem { this.mustProject(i.project_id); const t = now(); const e: T.EvidenceItem = { id: generateUlid(), project_id: i.project_id, title: req(i.title, "title"), kind: i.kind ?? "note", uri: i.uri ?? null, content_ref: i.content_ref ?? null, task_ref: i.task_ref ?? null, ...prov(i.provenance), created_at: t, updated_at: t }; return this.repo.createEvidence(e); }
  listEvidence(pid: string) { this.mustProject(pid); return this.repo.listEvidence(pid); }
  createFinding(i: T.CreateFindingInput): T.Finding { this.mustProject(i.project_id); if (i.evidence_id && !this.repo.getEvidence(i.evidence_id)) throw new ProjectError("not_found", `evidence not found: ${i.evidence_id}`); const t = now(); const e: T.Finding = { id: generateUlid(), project_id: i.project_id, evidence_id: i.evidence_id ?? null, title: req(i.title, "title"), description: i.description ?? null, severity: i.severity ?? "info", status: "open", ...prov(i.provenance), created_at: t, updated_at: t }; return this.repo.createFinding(e); }
  listFindings(pid: string, f?: { status?: T.FindingStatus; severity?: T.FindingSeverity }) { this.mustProject(pid); return this.repo.listFindings(pid, f); }
  setFindingStatus(id: string, s: T.FindingStatus) { if (!this.repo.getFinding(id)) throw new ProjectError("not_found", `finding not found: ${id}`); return this.repo.updateFinding(id, { status: s, updated_at: now() })!; }

  createBoard(i: T.CreateBoardInput): T.Board { this.mustProject(i.project_id); const t = now(); return this.repo.createBoard({ id: generateUlid(), project_id: i.project_id, name: req(i.name, "name"), ...prov(i.provenance), created_at: t, updated_at: t }); }
  listBoards(pid: string) { this.mustProject(pid); return this.repo.listBoards(pid); }
  createColumn(i: T.CreateColumnInput): T.BoardColumn { const b = this.repo.getBoard(i.board_id); if (!b) throw new ProjectError("not_found", `board not found: ${i.board_id}`); const cols = this.repo.listColumns(i.board_id); const t = now(); return this.repo.createColumn({ id: generateUlid(), board_id: i.board_id, project_id: b.project_id, name: req(i.name, "name"), position: i.position ?? cols.total, created_at: t, updated_at: t }); }
  listColumns(bid: string) { if (!this.repo.getBoard(bid)) throw new ProjectError("not_found", `board not found: ${bid}`); return this.repo.listColumns(bid); }
  createBoardTask(i: T.CreateBoardTaskInput): T.BoardTask { const b = this.repo.getBoard(i.board_id); if (!b) throw new ProjectError("not_found", `board not found: ${i.board_id}`); const c = this.repo.getColumn(i.column_id); if (!c || c.board_id !== i.board_id) throw new ProjectError("not_found", `column not found: ${i.column_id}`); const sib = this.repo.listBoardTasks(i.board_id).items.filter(x => x.column_id === i.column_id); const t = now(); const e: T.BoardTask = { id: generateUlid(), board_id: i.board_id, column_id: i.column_id, project_id: b.project_id, title: req(i.title, "title"), description: i.description ?? null, status: "todo", assignee_id: i.assignee_id ?? null, position: i.position ?? sib.length, ...prov(i.provenance), created_at: t, updated_at: t }; return this.repo.createBoardTask(e); }
  listBoardTasks(bid: string) { if (!this.repo.getBoard(bid)) throw new ProjectError("not_found", `board not found: ${bid}`); return this.repo.listBoardTasks(bid); }
  moveBoardTask(taskId: string, columnId: string, position?: number): T.BoardTask { const task = this.repo.getBoardTask(taskId); if (!task) throw new ProjectError("not_found", `board task not found: ${taskId}`); const col = this.repo.getColumn(columnId); if (!col || col.board_id !== task.board_id) throw new ProjectError("not_found", `column not found: ${columnId}`); const status: T.BoardTaskStatus = col.name.toLowerCase().includes("done") ? "done" : col.name.toLowerCase().includes("progress") ? "in_progress" : task.status; return this.repo.updateBoardTask(taskId, { column_id: columnId, position: position ?? task.position, status, updated_at: now() })!; }

  attachSkill(i: T.AttachSkillInput): T.ProjectSkill { this.mustProject(i.project_id); if (this.repo.listSkills(i.project_id).items.some(s => s.skill_id === i.skill_id)) throw new ProjectError("conflict", "skill already attached"); const t = now(); return this.repo.attachSkill({ id: generateUlid(), project_id: i.project_id, skill_id: req(i.skill_id, "skill_id"), name: req(i.name, "name"), ...prov(i.provenance), created_at: t, updated_at: t }); }
  listSkills(pid: string) { this.mustProject(pid); return this.repo.listSkills(pid); }
}
export { isUlid };
