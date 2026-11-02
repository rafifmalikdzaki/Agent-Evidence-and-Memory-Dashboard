import type * as T from "./types.js";
export interface IProjectRepository {
  init(): void; close(): void;
  createProject(e: T.Project): T.Project; getProject(id: string): T.Project | null; listProjectsByTeam(teamId: string): T.ListPage<T.Project>; updateProject(id: string, p: Partial<T.Project>): T.Project | null;
  addMember(e: T.ProjectMember): T.ProjectMember; getMember(projectId: string, userId: string): T.ProjectMember | null; listMembers(projectId: string): T.ListPage<T.ProjectMember>; removeMember(projectId: string, userId: string): void;
  createThread(e: T.Thread): T.Thread; getThread(id: string): T.Thread | null; listThreads(projectId: string): T.ListPage<T.Thread>;
  createMessage(e: T.Message): T.Message; listMessages(threadId: string): T.ListPage<T.Message>;
  createEvidence(e: T.EvidenceItem): T.EvidenceItem; getEvidence(id: string): T.EvidenceItem | null; listEvidence(projectId: string): T.ListPage<T.EvidenceItem>;
  createFinding(e: T.Finding): T.Finding; getFinding(id: string): T.Finding | null; listFindings(projectId: string, f?: { status?: T.FindingStatus; severity?: T.FindingSeverity }): T.ListPage<T.Finding>; updateFinding(id: string, p: Partial<T.Finding>): T.Finding | null;
  createBoard(e: T.Board): T.Board; getBoard(id: string): T.Board | null; listBoards(projectId: string): T.ListPage<T.Board>;
  createColumn(e: T.BoardColumn): T.BoardColumn; getColumn(id: string): T.BoardColumn | null; listColumns(boardId: string): T.ListPage<T.BoardColumn>;
  createBoardTask(e: T.BoardTask): T.BoardTask; getBoardTask(id: string): T.BoardTask | null; listBoardTasks(boardId: string): T.ListPage<T.BoardTask>; updateBoardTask(id: string, p: Partial<T.BoardTask>): T.BoardTask | null;
  attachSkill(e: T.ProjectSkill): T.ProjectSkill; listSkills(projectId: string): T.ListPage<T.ProjectSkill>;
}
