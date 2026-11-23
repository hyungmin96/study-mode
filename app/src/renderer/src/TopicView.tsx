import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import type { Round } from '../../shared/types'
import { enhance } from './diagrams'

const clean = (html: string): string =>
  DOMPurify.sanitize(html, { USE_PROFILES: { html: true, svg: true, svgFilters: true } })

interface TocChunk { id: string; title: string }
interface TocRound { id: string; n: number; question: string; chunks: TocChunk[] }

function RoundBlock({ r, onReady }: { r: Round; onReady: () => void }): React.JSX.Element {
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
      <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  )
}

export function TopicView({ title, rounds, onBack, children }: { title: string; rounds: Round[]; onBack: () => void; children?: React.ReactNode }): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const [toc, setToc] = useState<TocRound[]>([])
  const [active, setActive] = useState<string>('')

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
      <div className="scroller" ref={scroller}>
        <div className="doc">
          <div className="titlebar">
            <button className="back" title="처음 화면으로" aria-label="뒤로가기" onClick={onBack}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <h1>{title}</h1>
          </div>
          {rounds.map((r) => (
            <RoundBlock key={r.n} r={r} onReady={buildToc} />
          ))}
          {children}
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
