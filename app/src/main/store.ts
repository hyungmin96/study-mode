import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, mkdirSync, rmdirSync, statSync } from 'fs'
import { join } from 'path'
import type { IndexData } from '../shared/types'

/** index.json 읽기/쓰기. 쓰기는 직렬화하고 tmp→rename 으로 원자적으로 저장한다. */
export class Store {
  readonly indexPath: string
  private chain: Promise<unknown> = Promise.resolve()

  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true })
    this.indexPath = join(dataDir, 'index.json')
  }

  /** 기존 평면 구조(key→주제)를 {folders, topics}로 1회 변환한다. 원본은 index.json.bak 으로 보존. */
  migrate(): void {
    if (!existsSync(this.indexPath)) {
      this.writeSync({ folders: {}, topics: {} })
      return
    }
    const raw = JSON.parse(readFileSync(this.indexPath, 'utf8'))
    if (raw.folders && raw.topics) return
    const bak = this.indexPath + '.bak'
    if (!existsSync(bak)) copyFileSync(this.indexPath, bak)
    const topics: IndexData['topics'] = {}
    for (const [k, m] of Object.entries<Record<string, unknown>>(raw)) {
      topics[k] = { folder: null, sections: [], rounds: 1, ...m } as unknown as IndexData['topics'][string]
    }
    this.writeSync({ folders: {}, topics })
  }

  read(): IndexData {
    const raw = JSON.parse(readFileSync(this.indexPath, 'utf8'))
    return { folders: raw.folders ?? {}, topics: raw.topics ?? {} }
  }

  /** study.py 와 공유하는 잠금(data/index.lock 디렉터리). 10초 넘은 잠금은 회수한다. */
  private async lock(): Promise<() => void> {
    const lock = join(this.dataDir, 'index.lock')
    const end = Date.now() + 10000
    for (;;) {
      try {
        mkdirSync(lock)
        return () => {
          try { rmdirSync(lock) } catch {}
        }
      } catch {
        try {
          if (Date.now() - statSync(lock).mtimeMs > 10000) { rmdirSync(lock); continue }
        } catch {}
        if (Date.now() > end) throw new Error('index.json 잠금 대기 초과')
        await new Promise((r) => setTimeout(r, 50))
      }
    }
  }

  private writeSync(d: IndexData): void {
    const tmp = this.indexPath + '.tmp'
    writeFileSync(tmp, JSON.stringify(d, null, 2))
    renameSync(tmp, this.indexPath)
  }

  /** read-modify-write 를 한 줄로 직렬화한다 (python 이 쓴 최신 topics 를 매번 다시 읽는다). */
  update(fn: (d: IndexData) => void): Promise<IndexData> {
    const run = this.chain.then(async () => {
      const unlock = await this.lock()
      try {
        const d = this.read()
        fn(d)
        this.writeSync(d)
        return d
      } finally {
        unlock()
      }
    })
    this.chain = run.catch(() => undefined)
    return run
  }
}
