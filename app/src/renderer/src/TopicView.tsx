import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import type { Round } from '../../shared/types'
import { enhance } from './diagrams'

const clean = (html: string): string =>
  DOMPurify.sanitize(html, { USE_PROFILES: { html: true, svg: true, svgFilters: true } })

const STAGE_LABEL: Record<string, string> = { collect: '수집', render: '정리', merge: '표·그림' }

interface TocChunk { id: string; title: string }
interface TocRound { id: string; n: number; question: string; chunks: TocChunk[] }

function RoundBlock({ r, asked, onReady, onAsk }: { r: Round; asked: Set<string>; onReady: () => void; onAsk?: (q: string) => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => clean(r.html), [r.html])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.querySelectorAll<HTMLElement>('.chunk').forEach((c, j) => (c.id = `r${r.n}-c${j + 1}`))
    enhance(el).finally(onReady)
  }, [html]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="round" id={`r${r.n}`}>
      <h3 className="q">
        <span>Q{r.n}</span> {r.question}
      </h3>
      <div className="answer" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
      {onAsk && r.suggest.filter((q) => !asked.has(q)).length > 0 && (
        <div className="suggest">
          <div className="sg-h">알아두면 좋은 질문</div>
          {r.suggest.filter((q) => !asked.has(q)).map((q, i) => (
            <button key={q} className="sg" onClick={() => onAsk(q)}>
              <span className="sg-n">{i + 1}.</span>
              {q}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

export function TopicView({ title, rounds, onBack, onAsk, children }: { title: string; rounds: Round[]; onBack: () => void; onAsk?: (q: string) => void; children?: React.ReactNode }): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const [toc, setToc] = useState<TocRound[]>([])
  const [active, setActive] = useState<string>('')
  const asked = useMemo(() => new Set(rounds.map((r) => r.question)), [rounds])
  const totalTokens = rounds.reduce((a, r) => a + r.tokens, 0)

  const buildToc = (): void => {
    const root = scroller.current
    if (!root) return
    setToc(
      rounds.map((r) => ({
        id: `r${r.n}`,
        n: r.n,
        question: r.question,
        chunks: Array.from(root.querySelectorAll<HTMLElement>(`#r${r.n} .chunk`)).map((c) => ({
          id: c.id,
          title: c.getAttribute('data-title') || c.querySelector('h2')?.textContent || ''
        }))
      }))
    )
  }
  useEffect(() => {
    buildToc()
  }, [rounds]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const spy = (): void => {
      const y = root.scrollTop + 80
      let cur = root.querySelector<HTMLElement>('.round')?.id ?? ''
      root.querySelectorAll<HTMLElement>('.round, .chunk').forEach((el) => {
        if (el.offsetTop <= y) cur = el.id
      })
      setActive(cur)
    }
    root.addEventListener('scroll', spy, { passive: true })
    spy()
    return () => root.removeEventListener('scroll', spy)
  }, [toc])

  const go = (id: string): void =>
    scroller.current?.querySelector('#' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const activeRound = active.split('-')[0]

  return (
    <div className="topic">
      <div className="tcol">
        <div className="titlebar">
          <div className="tb-in">
            <button className="back" title="처음 화면으로" aria-label="뒤로가기" onClick={onBack}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <h1>{title}</h1>
          </div>
        </div>
        <div className="scroller" ref={scroller}>
          <div className="doc">
          {rounds.map((r) => (
            <RoundBlock key={r.n} r={r} asked={asked} onReady={buildToc} onAsk={onAsk} />
          ))}
          {children}
          {totalTokens > 0 && (
            <div className="tokens">
              <div className="tk-h">사용 토큰</div>
              {rounds.filter((r) => r.tokens > 0).map((r) => (
                <div key={r.n} className="tk-row">
                  <b>Q{r.n}</b>
                  {Object.entries(r.stages).filter(([, v]) => v > 0).map(([k, v]) => (
                    <span key={k}>{STAGE_LABEL[k] ?? k} {v.toLocaleString()}</span>
                  ))}
                  <span className="tk-sub">소계 {r.tokens.toLocaleString()}</span>
                </div>
              ))}
              <div className="tk-total">총 합계 <b>{totalTokens.toLocaleString()}</b></div>
            </div>
          )}
          </div>
        </div>
      </div>
      <nav className="toc">
        {toc.map((r) => (
          <div key={r.id} className={'rq' + (activeRound === r.id ? ' on' : '')}>
            <a className="qh" onClick={() => go(r.id)}>
              <b>Q{r.n}</b> <span>{r.question}</span>
            </a>
            {activeRound === r.id &&
              r.chunks.map((c) => (
                <a key={c.id} className={'sub' + (active === c.id ? ' on' : '')} onClick={() => go(c.id)}>
                  {c.title}
                </a>
              ))}
          </div>
        ))}
      </nav>
    </div>
  )
}
