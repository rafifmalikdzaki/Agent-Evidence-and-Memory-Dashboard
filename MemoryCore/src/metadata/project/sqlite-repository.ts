import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { IProjectRepository } from "./repository.js";
import type * as T from "./types.js";
const require = createRequire(import.meta.url);
type Row = Record<string, unknown>;
const page = <X>(items: X[]): T.ListPage<X> => ({ items, total: items.length });

export class SqliteProjectRepository implements IProjectRepository {
  private db!: DatabaseSync; private ready = false;
  constructor(private dbPath: string) {}
  init(): void {
    if (this.ready) return;
    const { DatabaseSync: Db } = require("node:sqlite") as typeof import("node:sqlite");
    if (this.dbPath !== ":memory:") mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new Db(this.dbPath);
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS proj_projects(id TEXT PRIMARY KEY,team_id TEXT NOT NULL,name TEXT NOT NULL,description TEXT,status TEXT NOT NULL DEFAULT 'active',author_type TEXT NOT NULL DEFAULT 'human',author_id TEXT NOT NULL,model TEXT,session_id TEXT,metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_proj_projects_team ON proj_projects(team_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS proj_members(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES proj_projects(id) ON DELETE CASCADE,user_id TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'member',status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(project_id,user_id));
      CREATE TABLE IF NOT EXISTS proj_threads(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES proj_projects(id) ON DELETE CASCADE,title TEXT NOT NULL,author_type TEXT NOT NULL,author_id TEXT NOT NULL,model TEXT,session_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proj_messages(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES proj_threads(id) ON DELETE CASCADE,project_id TEXT NOT NULL,body TEXT NOT NULL,author_type TEXT NOT NULL,author_id TEXT NOT NULL,model TEXT,session_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_proj_messages_thread ON proj_messages(thread_id,created_at ASC);
      CREATE TABLE IF NOT EXISTS proj_evidence(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES proj_projects(id) ON DELETE CASCADE,title TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'note',uri TEXT,content_ref TEXT,task_ref TEXT,author_type TEXT NOT NULL,author_id TEXT NOT NULL,model TEXT,session_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proj_findings(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES proj_projects(id) ON DELETE CASCADE,evidence_id TEXT,title TEXT NOT NULL,description TEXT,severity TEXT NOT NULL DEFAULT 'info',status TEXT NOT NULL DEFAULT 'open',author_type TEXT NOT NULL,author_id TEXT NOT NULL,model TEXT,session_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proj_boards(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES proj_projects(id) ON DELETE CASCADE,name TEXT NOT NULL,author_type TEXT NOT NULL,author_id TEXT NOT NULL,model TEXT,session_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proj_board_columns(id TEXT PRIMARY KEY,board_id TEXT NOT NULL REFERENCES proj_boards(id) ON DELETE CASCADE,project_id TEXT NOT NULL,name TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proj_board_tasks(id TEXT PRIMARY KEY,board_id TEXT NOT NULL REFERENCES proj_boards(id) ON DELETE CASCADE,column_id TEXT NOT NULL REFERENCES proj_board_columns(id) ON DELETE CASCADE,project_id TEXT NOT NULL,title TEXT NOT NULL,description TEXT,status TEXT NOT NULL DEFAULT 'todo',assignee_id TEXT,position INTEGER NOT NULL DEFAULT 0,author_type TEXT NOT NULL,author_id TEXT NOT NULL,model TEXT,session_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_proj_tasks_col ON proj_board_tasks(column_id,position ASC);
      CREATE TABLE IF NOT EXISTS proj_skills(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES proj_projects(id) ON DELETE CASCADE,skill_id TEXT NOT NULL,name TEXT NOT NULL,author_type TEXT NOT NULL,author_id TEXT NOT NULL,model TEXT,session_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(project_id,skill_id));
    `);
    this.ready = true;
  }
  close(): void { if (this.ready) { this.db.close(); this.ready = false; } }
  private run(sql: string, ...p: unknown[]) { (this.db.prepare(sql) as { run: (...a: unknown[]) => unknown }).run(...p); }
  private get<X>(sql: string, ...p: unknown[]): X | null { return ((this.db.prepare(sql) as { get: (...a: unknown[]) => unknown }).get(...p) as X) ?? null; }
  private all<X>(sql: string, ...p: unknown[]): X[] { return (this.db.prepare(sql) as unknown as { all: (...a: unknown[]) => X[] }).all(...p); }
  private ins(table: string, e: object) { const k = Object.keys(e); this.run(`INSERT INTO ${table}(${k.join(",")}) VALUES(${k.map(() => "?").join(",")})`, ...k.map(x => (e as Row)[x] ?? null)); }
  private upd(table: string, id: string, p: object) { const k = Object.keys(p).filter(x => x !== "id"); if (!k.length) return; this.run(`UPDATE ${table} SET ${k.map(x => `${x}=?`).join(",")} WHERE id=?`, ...k.map(x => (p as Row)[x] ?? null), id); }

  createProject(e: T.Project) { this.ins("proj_projects", e); return e; }
  getProject(id: string) { return this.get<T.Project>("SELECT * FROM proj_projects WHERE id=?", id); }
  listProjectsByTeam(teamId: string) { return page(this.all<T.Project>("SELECT * FROM proj_projects WHERE team_id=? ORDER BY created_at DESC", teamId)); }
  updateProject(id: string, p: Partial<T.Project>) { this.upd("proj_projects", id, p); return this.getProject(id); }
  addMember(e: T.ProjectMember) { this.ins("proj_members", e); return e; }
  getMember(pid: string, uid: string) { return this.get<T.ProjectMember>("SELECT * FROM proj_members WHERE project_id=? AND user_id=? AND status='active'", pid, uid); }
  listMembers(pid: string) { return page(this.all<T.ProjectMember>("SELECT * FROM proj_members WHERE project_id=? AND status='active' ORDER BY created_at ASC", pid)); }
  removeMember(pid: string, uid: string) { this.run("UPDATE proj_members SET status='removed',updated_at=? WHERE project_id=? AND user_id=?", new Date().toISOString(), pid, uid); }
  createThread(e: T.Thread) { this.ins("proj_threads", e); return e; }
  getThread(id: string) { return this.get<T.Thread>("SELECT * FROM proj_threads WHERE id=?", id); }
  listThreads(pid: string) { return page(this.all<T.Thread>("SELECT * FROM proj_threads WHERE project_id=? ORDER BY created_at ASC", pid)); }
  createMessage(e: T.Message) { this.ins("proj_messages", e); return e; }
  listMessages(tid: string) { return page(this.all<T.Message>("SELECT * FROM proj_messages WHERE thread_id=? ORDER BY created_at ASC", tid)); }
  createEvidence(e: T.EvidenceItem) { this.ins("proj_evidence", e); return e; }
  getEvidence(id: string) { return this.get<T.EvidenceItem>("SELECT * FROM proj_evidence WHERE id=?", id); }
  listEvidence(pid: string) { return page(this.all<T.EvidenceItem>("SELECT * FROM proj_evidence WHERE project_id=? ORDER BY created_at DESC", pid)); }
  createFinding(e: T.Finding) { this.ins("proj_findings", e); return e; }
  getFinding(id: string) { return this.get<T.Finding>("SELECT * FROM proj_findings WHERE id=?", id); }
  listFindings(pid: string, f?: { status?: T.FindingStatus; severity?: T.FindingSeverity }) { let q = "SELECT * FROM proj_findings WHERE project_id=?"; const a: unknown[] = [pid]; if (f?.status) { q += " AND status=?"; a.push(f.status); } if (f?.severity) { q += " AND severity=?"; a.push(f.severity); } return page(this.all<T.Finding>(q + " ORDER BY created_at DESC", ...a)); }
  updateFinding(id: string, p: Partial<T.Finding>) { this.upd("proj_findings", id, p); return this.getFinding(id); }
  createBoard(e: T.Board) { this.ins("proj_boards", e); return e; }
  getBoard(id: string) { return this.get<T.Board>("SELECT * FROM proj_boards WHERE id=?", id); }
  listBoards(pid: string) { return page(this.all<T.Board>("SELECT * FROM proj_boards WHERE project_id=? ORDER BY created_at ASC", pid)); }
  createColumn(e: T.BoardColumn) { this.ins("proj_board_columns", e); return e; }
  getColumn(id: string) { return this.get<T.BoardColumn>("SELECT * FROM proj_board_columns WHERE id=?", id); }
  listColumns(bid: string) { return page(this.all<T.BoardColumn>("SELECT * FROM proj_board_columns WHERE board_id=? ORDER BY position ASC,created_at ASC", bid)); }
  createBoardTask(e: T.BoardTask) { this.ins("proj_board_tasks", e); return e; }
  getBoardTask(id: string) { return this.get<T.BoardTask>("SELECT * FROM proj_board_tasks WHERE id=?", id); }
  listBoardTasks(bid: string) { return page(this.all<T.BoardTask>("SELECT * FROM proj_board_tasks WHERE board_id=? ORDER BY column_id,position ASC", bid)); }
  updateBoardTask(id: string, p: Partial<T.BoardTask>) { this.upd("proj_board_tasks", id, p); return this.getBoardTask(id); }
  attachSkill(e: T.ProjectSkill) { this.ins("proj_skills", e); return e; }
  listSkills(pid: string) { return page(this.all<T.ProjectSkill>("SELECT * FROM proj_skills WHERE project_id=? ORDER BY created_at ASC", pid)); }
}
