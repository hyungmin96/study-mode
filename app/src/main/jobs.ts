import { spawn, execFileSync, type ChildProcess } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { JobInfo, StageState } from '../shared/types'

const SRCS = ['codex'] as const

/** GUI 앱은 셸 PATH 를 상속하지 않으므로 로그인 셸에서 읽어 온다 (claude·codex·agy 위치 확보). */
function loginPath(): string {
  try {
    const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-lc', 'echo -n "$PATH"'], { encoding: 'utf8', timeout: 8000 })
    return out.split('\n').pop() || process.env.PATH || ''
  } catch {
    return process.env.PATH || ''
  }
}

/**
 * study.py run 을 하위 프로세스로 실행하고 진행을 알린다.
 * - 진행 상태는 rounds/NN/<src>.done, finish.done 파일과 stdout 으로 읽는다 (study.py 출력 형식 변경 없음).
 * - 같은 주제는 한 번에 1작업 (후속 질문은 큐에 대기). 다른 주제는 동시 진행.
 */
export class JobManager {
  private jobs = new Map<string, JobInfo>()
  private procs = new Map<string, ChildProcess>()
  private rdirs = new Map<string, string>()
  private seq = 0
  private path = ''

  constructor(
    private home: string,
    private emit: (j: JobInfo) => void
  ) {}

  list(): JobInfo[] {
    return [...this.jobs.values()]
  }

  ask(req: { key?: string; question: string }): string {
    const id = `j${Date.now().toString(36)}${this.seq++}`
    const job: JobInfo = {
      id,
      key: req.key ?? null,
      question: req.question.trim(),
      state: 'queued',
      stages: { codex: 'wait', finish: 'wait' },
      substitute: {}
    }
    this.jobs.set(id, job)
    this.emit(job)
    this.pump()
    return id
  }

  private busy(key: string | null): boolean {
    return key !== null && this.list().some((j) => j.key === key && j.state === 'running')
  }

  private pump(): void {
    for (const j of this.list()) if (j.state === 'queued' && !this.busy(j.key)) this.start(j)
  }

  private start(job: JobInfo): void {
    if (!this.path) this.path = loginPath()
    job.state = 'running'
    // 첫 단어가 기존 key 와 겹쳐 후속 질문으로 오인되지 않도록, 새 주제도 그대로 넘기되 key 가 있으면 앞에 붙인다.
    const args = [join(this.home, 'study.py'), 'run', '--no-open', '--no-html']
    if (job.key) args.push(job.key)
    args.push(job.question)
    const p = spawn('python3', args, {
      cwd: this.home,
      env: { ...process.env, PATH: this.path },
      detached: true, // 프로세스 그룹으로 묶어 claude·codex·agy 자식까지 함께 종료
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.procs.set(job.id, p)
    let buf = ''
    let err = ''
    p.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        this.line(job, buf.slice(0, i))
        buf = buf.slice(i + 1)
      }
    })
    p.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-600)))
    const timer = setInterval(() => this.poll(job), 1000)
    p.on('close', (code) => {
      clearInterval(timer)
      this.procs.delete(job.id)
      this.poll(job)
      if (job.state === 'cancelled') return this.finishUp(job)
      const fin = this.rdirs.has(job.id) ? join(this.rdirs.get(job.id)!, 'finish.done') : ''
      const ok = code === 0 && fin && existsSync(fin) && readFileSync(fin, 'utf8') === 'ok'
      job.state = ok ? 'done' : 'failed'
      if (!ok) job.error = (err.trim() || (fin && existsSync(fin) ? readFileSync(fin, 'utf8') : '') || `종료 코드 ${code}`).slice(-300)
      else job.stages.finish = 'ok'
      this.finishUp(job)
    })
    this.emit(job)
  }

  private finishUp(job: JobInfo): void {
    this.emit(job)
    this.pump()
  }

  private line(job: JobInfo, s: string): void {
    const m = s.match(/^key=(\S+) round=(\d+) /)
    if (m) {
      job.key = m[1]
      this.rdirs.set(job.id, join(this.home, 'data', m[1], 'rounds', m[2]))
      this.emit(job)
    } else if (s.startsWith('[정리] ') && job.stages.finish === 'wait') {
      job.stages.finish = 'run'
      this.emit(job)
    }
  }

  private poll(job: JobInfo): void {
    const rd = this.rdirs.get(job.id)
    if (!rd) return
    let changed = false
    for (const s of SRCS) {
      const f = join(rd, `${s}.done`)
      const st: StageState = existsSync(f) ? (readFileSync(f, 'utf8') === 'ok' ? 'ok' : 'fail') : 'run'
      if (job.stages[s] !== st) { job.stages[s] = st; changed = true }
      const sub = join(rd, `${s}.src`)
      if (existsSync(sub) && !job.substitute[s]) { job.substitute[s] = readFileSync(sub, 'utf8').trim(); changed = true }
    }
    if (changed) this.emit(job)
  }

  /** 앱 종료 시 진행 중 작업을 모두 중단한다. 라운드 폴더에 chunks.html 이 없으면 다음 실행에서 "중단됨"으로 보인다. */
  cancelAll(): void {
    for (const [id, p] of this.procs) {
      const j = this.jobs.get(id)
      if (j) j.state = 'cancelled'
      try { if (p.pid) process.kill(-p.pid, 'SIGTERM') } catch { /* 이미 종료 */ }
    }
  }
}
