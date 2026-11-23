export interface Folder { name: string; parent: string | null; order: number }
export interface Topic {
  topic: string
  folder: string | null
  created: string
  rounds: number
  sections: string[]
  html?: string
}
export interface IndexData {
  folders: Record<string, Folder>
  topics: Record<string, Topic>
}
export interface Round { n: number; question: string; html: string; suggest: string[]; tokens: number; cached: number; stages: Record<string, number> }
export type StageState = 'wait' | 'run' | 'ok' | 'fail'
export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
export interface JobInfo {
  id: string
  key: string | null // 새 주제는 study.py 가 key 를 만든 뒤 채워진다
  question: string
  state: JobState
  stages: Record<'codex' | 'finish', StageState>
  substitute: Record<string, string> // 대체 수집 표시 (src → 대체 모델)
  error?: string
  fresh?: boolean // 새 주제로 시작한 질문
}
export type MenuTarget = { kind: 'root' } | { kind: 'folder' | 'topic'; id: string }
export type MenuAction =
  | { type: 'newFolder'; parent: string | null }
  | { type: 'rename' }
  | { type: 'move'; to: string | null }
  | { type: 'delete' }
export interface StudyApi {
  listIndex(): Promise<IndexData>
  getTopic(key: string): Promise<Round[]>
  ask(req: { key?: string; question: string }): Promise<string>
  listJobs(): Promise<JobInfo[]>
  cancelJob(id: string): Promise<void>
  onJob(cb: (j: JobInfo) => void): () => void
  createFolder(name: string, parent: string | null): Promise<string>
  renameFolder(id: string, name: string): Promise<void>
  renameTopic(key: string, name: string): Promise<void>
  moveTopic(key: string, folder: string | null): Promise<void>
  moveFolder(id: string, parent: string | null): Promise<void>
  deleteTopic(key: string): Promise<boolean>
  deleteItems(req: { topics: string[]; folders: string[] }): Promise<number>
  deleteFolder(id: string): Promise<boolean>
  contextMenu(target: MenuTarget): Promise<MenuAction | null>
}
