export type AuthorType = "human" | "agent";
export type ProjectStatus = "active" | "archived";
export type ProjectRole = "owner" | "admin" | "member" | "viewer";
export type MemberStatus = "active" | "removed";
export type FindingSeverity = "info" | "low" | "medium" | "high" | "critical";
export type FindingStatus = "open" | "confirmed" | "dismissed" | "resolved";
export type EvidenceKind = "file" | "url" | "log" | "screenshot" | "note" | "other";
export type BoardTaskStatus = "todo" | "in_progress" | "done" | "blocked";

export interface Provenance { author_type: AuthorType; author_id: string; model: string | null; session_id: string | null; }
export type ProvenanceInput = Partial<Provenance> & { author_id: string };

interface Base { id: string; created_at: string; updated_at: string; }
export interface Project extends Base, Provenance { team_id: string; name: string; description: string | null; status: ProjectStatus; metadata_json: string; }
export interface ProjectMember extends Base { project_id: string; user_id: string; role: ProjectRole; status: MemberStatus; }
export interface Thread extends Base, Provenance { project_id: string; title: string; }
export interface Message extends Base, Provenance { thread_id: string; project_id: string; body: string; }
export interface EvidenceItem extends Base, Provenance { project_id: string; title: string; kind: EvidenceKind; uri: string | null; content_ref: string | null; task_ref: string | null; }
export interface Finding extends Base, Provenance { project_id: string; evidence_id: string | null; title: string; description: string | null; severity: FindingSeverity; status: FindingStatus; }
export interface Board extends Base, Provenance { project_id: string; name: string; }
export interface BoardColumn extends Base { board_id: string; project_id: string; name: string; position: number; }
export interface BoardTask extends Base, Provenance { board_id: string; column_id: string; project_id: string; title: string; description: string | null; status: BoardTaskStatus; assignee_id: string | null; position: number; }
export interface ProjectSkill extends Base, Provenance { project_id: string; skill_id: string; name: string; }

export interface CreateProjectInput { team_id: string; name: string; description?: string | null; metadata_json?: string; provenance: ProvenanceInput; }
export interface AddMemberInput { project_id: string; user_id: string; role?: ProjectRole; }
export interface CreateThreadInput { project_id: string; title: string; provenance: ProvenanceInput; }
export interface PostMessageInput { thread_id: string; body: string; provenance: ProvenanceInput; }
export interface CreateEvidenceInput { project_id: string; title: string; kind?: EvidenceKind; uri?: string | null; content_ref?: string | null; task_ref?: string | null; provenance: ProvenanceInput; }
export interface CreateFindingInput { project_id: string; title: string; description?: string | null; evidence_id?: string | null; severity?: FindingSeverity; provenance: ProvenanceInput; }
export interface CreateBoardInput { project_id: string; name: string; provenance: ProvenanceInput; }
export interface CreateColumnInput { board_id: string; name: string; position?: number; }
export interface CreateBoardTaskInput { board_id: string; column_id: string; title: string; description?: string | null; assignee_id?: string | null; position?: number; provenance: ProvenanceInput; }
export interface AttachSkillInput { project_id: string; skill_id: string; name: string; provenance: ProvenanceInput; }
export interface ListPage<T> { items: T[]; total: number; }
