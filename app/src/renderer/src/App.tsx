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
  const [side, setSide] = useState<boolean>(() => {
    try {
      return localStorage.getItem('side') !== '0'
    } catch {
      return true
    }
  })
  const toggleSide = (): void =>
    setSide((v) => {
      try {
        localStorage.setItem('side', v ? '0' : '1')
      } catch {
        /* 저장 실패는 무시 */
      }
      return !v
    })
  const [startJobs, setStartJobs] = useState<string[]>([]) // 시작 화면에서 던진 질문들 (각각 독립된 새 주제)

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
    if (sel && Object.keys(data.topics).length && !data.topics[sel]) setSel(null)
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
      if (!key) setStartJobs((p) => [...p, id])
    } catch (e) {
      setErr(String(e))
    }
  }

  // 새 채팅: 끝난 질문 카드는 치우고(진행 중인 것은 유지) 시작 화면으로
  const newChat = (): void => {
    setStartJobs((p) => p.filter((id) => jobs[id] && (jobs[id].state === 'running' || jobs[id].state === 'queued')))
    setSel(null)
  }

  const running = new Set(
    Object.values(jobs).filter((j) => j.key && (j.state === 'running' || j.state === 'queued')).map((j) => j.key as string)
  )
  const topic = sel ? data.topics[sel] : null
  const live = Object.values(jobs).filter((j) => j.key === sel && j.state !== 'done' && j.state !== 'cancelled')
  const unfinished = topic ? topic.rounds > rounds.length && live.length === 0 : false

  return (
    <div className={'app' + (side ? '' : ' collapsed')}>
      <div className="topdrag" />
      <button className="sidetoggle" title={side ? '사이드바 접기' : '사이드바 펴기'} aria-label="사이드바 접기/펴기" onClick={toggleSide}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2" y="3.5" width="16" height="13" rx="3" fill="currentColor" opacity=".28" />
          <path d="M5 3.5h3.5v13H5a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3z" fill="currentColor" />
        </svg>
      </button>
      <Sidebar hidden={!side} data={data} selected={sel} running={running} onSelect={setSel} onNew={newChat} onChange={refresh} onError={setErr} />
      <main className="main">
        {topic ? (
          <>
            <TopicView key={sel} title={topic.topic} rounds={rounds} onBack={() => setSel(null)}>
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
            <div className="start-top">
              <h1>무엇을 검색할까요?</h1>
              <div className="startjobs">
                {[...startJobs].reverse().slice(0, 10).map((id) => jobs[id] && (
                  <JobProgress
                    key={id}
                    job={jobs[id]}
                    onOpen={jobs[id].key ? () => setSel(jobs[id].key) : undefined}
                    onClose={() => setStartJobs((p) => p.filter((x) => x !== id))}
                  />
                ))}
              </div>
            </div>
            <ChatInput placeholder="질문을 입력하고 Enter (Shift+Enter 줄바꿈)" onSubmit={(t) => ask(t)} />
            {err && <div className="err">{err}</div>}
          </div>
        )}
      </main>
    </div>
  )
}
