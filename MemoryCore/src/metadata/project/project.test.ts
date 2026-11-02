import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteProjectRepository } from "./sqlite-repository.js";
import { ProjectService, ProjectError } from "./service.js";
import { generateUlid, isUlid } from "./ulid.js";

const human = { author_id: "usr-1", author_type: "human" as const };
const agent = { author_id: "agt-1", author_type: "agent" as const, model: "gpt-x", session_id: "sess-1" };
let svc: ProjectService; let repo: SqliteProjectRepository;
beforeEach(() => { repo = new SqliteProjectRepository(":memory:"); repo.init(); svc = new ProjectService(repo); });
afterEach(() => repo.close());

describe("ulid", () => { it("26-char Crockford, unique", () => { const a = generateUlid(), b = generateUlid(); expect(isUlid(a)).toBe(true); expect(a).not.toBe(b); expect(a).toHaveLength(26); }); });

describe("project + members", () => {
  it("creates project, auto-owner, provenance persisted", () => {
    const p = svc.createProject({ team_id: "team-1", name: " Alpha ", provenance: agent });
    expect(isUlid(p.id)).toBe(true); expect(p.name).toBe("Alpha"); expect(p.author_type).toBe("agent"); expect(p.model).toBe("gpt-x"); expect(p.session_id).toBe("sess-1");
    expect(svc.listMembers(p.id).items[0]).toMatchObject({ user_id: "agt-1", role: "owner" });
  });
  it("rejects empty name and duplicate member", () => {
    expect(() => svc.createProject({ team_id: "t", name: " ", provenance: human })).toThrowError(ProjectError);
    const p = svc.createProject({ team_id: "t", name: "P", provenance: human });
    svc.addMember({ project_id: p.id, user_id: "u2" });
    expect(() => svc.addMember({ project_id: p.id, user_id: "u2" })).toThrowError(/already/);
    expect(() => svc.getProject("nope")).toThrowError(/not found/);
  });
});

describe("thread/message, evidence/finding", () => {
  it("full flow with provenance + validation", () => {
    const p = svc.createProject({ team_id: "t", name: "P", provenance: human });
    const th = svc.createThread({ project_id: p.id, title: "Board", provenance: human });
    const m = svc.postMessage({ thread_id: th.id, body: "hello", provenance: agent });
    expect(m.project_id).toBe(p.id); expect(m.model).toBe("gpt-x");
    expect(svc.listMessages(th.id).total).toBe(1);
    expect(() => svc.postMessage({ thread_id: "missing", body: "x", provenance: human })).toThrowError(/not found/);
    const ev = svc.createEvidence({ project_id: p.id, title: "log", kind: "log", uri: "file://x", provenance: agent });
    const f = svc.createFinding({ project_id: p.id, title: "Bug", evidence_id: ev.id, severity: "high", provenance: agent });
    expect(f.status).toBe("open"); expect(svc.setFindingStatus(f.id, "resolved").status).toBe("resolved");
    expect(svc.listFindings(p.id, { status: "resolved" }).total).toBe(1);
    expect(() => svc.createFinding({ project_id: p.id, title: "x", evidence_id: "missing", provenance: human })).toThrowError(/not found/);
  });
});

describe("kanban + skills", () => {
  it("board/column/task create and move updates column/position/status", () => {
    const p = svc.createProject({ team_id: "t", name: "P", provenance: human });
    const b = svc.createBoard({ project_id: p.id, name: "Sprint", provenance: human });
    const c1 = svc.createColumn({ board_id: b.id, name: "Todo" });
    const c2 = svc.createColumn({ board_id: b.id, name: "Done" });
    expect([c1.position, c2.position]).toEqual([0, 1]);
    const t = svc.createBoardTask({ board_id: b.id, column_id: c1.id, title: "Task1", provenance: agent });
    const moved = svc.moveBoardTask(t.id, c2.id, 0);
    expect(moved.column_id).toBe(c2.id); expect(moved.status).toBe("done");
    expect(() => svc.createBoardTask({ board_id: b.id, column_id: "nope", title: "x", provenance: human })).toThrowError(/not found/);
    const s = svc.attachSkill({ project_id: p.id, skill_id: "skl-1", name: "Review", provenance: agent });
    expect(s.skill_id).toBe("skl-1"); expect(svc.listSkills(p.id).total).toBe(1);
    expect(() => svc.attachSkill({ project_id: p.id, skill_id: "skl-1", name: "Review", provenance: human })).toThrowError(/already/);
  });
  it("archive project", () => { const p = svc.createProject({ team_id: "t", name: "P", provenance: human }); expect(svc.archiveProject(p.id).status).toBe("archived"); });
});
