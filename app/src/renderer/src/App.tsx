import { useCallback, useEffect, useState } from 'react'
import type { IndexData, JobInfo, Round } from '../../shared/types'
import { Sidebar } from './Sidebar'
import { TopicView } from './TopicView'
import { ChatInput } from './ChatInput'
import { JobProgress } from './JobProgress'

export function App(): React.JSX.Element {
  const [data, setData] = useState<IndexData>({ folders: {}, topics: {} })
  const [sel, setSel] = useState<string | null>(null)
  const [rounds, setRounds] = useState<Round[]>([])
  const [jobs, setJobs] = useState<Record<string, JobInfo>>({})
  const [err, setErr] = useState('')

  const refresh = useCallback(() => window.study.listIndex().then(setData), [])
  const loadRounds = useCallback((k: string) => window.study.getTopic(k).then(setRounds), [])

  useEffect(() => {
    refresh()
    window.study.listJobs().then((l) => setJobs(Object.fromEntries(l.map((j) => [j.id, j]))))
    return window.study.onJob((j) => {
      setJobs((p) => {
        const prev = p[j.id]
        // 새 주제: key 가 정해지는 순간 사이드바에 나타나고 그 주제로 이동한다
        if (j.key && !prev?.key) refresh()
        if (j.state === 'done' || j.state === 'failed') refresh()
        return { ...p, [j.id]: j }
      })
    })
  }, [refresh])

  // 삭제된 주제가 열려 있으면 시작 화면으로
  useEffect(() => {
    if (sel && Object.keys(data.topics).length && !data.topics[sel] && !pendingNew) setSel(null)
  }, [data, sel])

  // 작업이 새로 끝나면 열려 있는 주제를 다시 읽는다
  const doneCount = Object.values(jobs).filter((j) => j.state === 'done' && j.key === sel).length
  useEffect(() => {
    setRounds([])
    if (sel) loadRounds(sel)
  }, [sel, doneCount, loadRounds])

  const ask = async (question: string, key?: string): Promise<void> => {
    setErr('')
    try {
      const id = await window.study.ask({ key, question })
      if (!key) setPendingNew(id)
    } catch (e) {
      setErr(String(e))
    }
  }

  // 새 주제 질문 직후: key 가 정해지면 그 주제를 연다
  const [pendingNew, setPendingNew] = useState<string | null>(null)
  useEffect(() => {
    const j = pendingNew ? jobs[pendingNew] : null
    if (j?.key) {
      setSel(j.key)
      setPendingNew(null)
    }
  }, [pendingNew, jobs])

  const running = new Set(
    Object.values(jobs).filter((j) => j.key && (j.state === 'running' || j.state === 'queued')).map((j) => j.key as string)
  )
  const topic = sel ? data.topics[sel] : null
  const live = Object.values(jobs).filter((j) => j.key === sel && j.state !== 'done' && j.state !== 'cancelled')
  const unfinished = topic ? topic.rounds > rounds.length && live.length === 0 : false

  return (
    <div className="app">
      <div className="topdrag" />
      <Sidebar data={data} selected={sel} running={running} onSelect={setSel} onNew={() => setSel(null)} onChange={refresh} onError={setErr} />
      <main className="main">
        {topic ? (
          <>
            <TopicView key={sel} title={topic.topic} rounds={rounds}>
              {live.map((j) => (
                <JobProgress key={j.id} job={j} />
              ))}
              {unfinished && <div className="job bad"><div className="js">마지막 질문이 중단되었습니다. 같은 질문을 다시 입력해 주세요.</div></div>}
            </TopicView>
            <div className="composer">
              <ChatInput placeholder="후속 질문을 입력하고 Enter" onSubmit={(t) => ask(t, sel!)} />
              {err && <div className="err">{err}</div>}
            </div>
          </>
        ) : (
          <div className="start">
            <h1>무엇을 검색할까요?</h1>
            <ChatInput placeholder="질문을 입력하고 Enter (Shift+Enter 줄바꿈)" onSubmit={(t) => ask(t)} />
            {err && <div className="err">{err}</div>}
          </div>
        )}
      </main>
    </div>
  )
}
