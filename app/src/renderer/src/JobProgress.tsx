import { useEffect, useRef } from 'react'
import type { JobInfo, StageState } from '../../shared/types'

function Mark({ st }: { st: StageState }): React.JSX.Element {
  if (st === 'run') return <span className="spinner" aria-label="진행 중" />
  if (st === 'ok') return <span className="mk ok">✓</span>
  if (st === 'fail') return <span className="mk fail">✗</span>
  return <span className="mk wait" />
}

interface Props {
  job: JobInfo
  onOpen?: () => void // 완료된 카드를 누르면 답변을 연다
  onClose?: () => void // 실패한 카드를 치운다
  reveal?: boolean // 나타날 때 화면 안으로 스크롤 (주제 화면 하단 진행 카드)
  onCancel?: () => void // 진행 중인 질문을 취소한다 (카드에 마우스를 올릴 때만 ✕ 표시)
}

export function JobProgress({ job, onOpen, onClose, onCancel, reveal }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (reveal) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const failed = job.state === 'failed'
  const done = job.state === 'done'
  const active = job.state === 'running'
  const clickable = done && !!onOpen
  return (
    <div
      ref={ref}
      className={'job' + (failed ? ' bad' : '') + (done ? ' done' : '') + (active ? ' active' : '') + (clickable ? ' clickable' : '')}
      onClick={clickable ? onOpen : undefined}
      role={clickable ? 'button' : undefined}
    >
      <div className="jhead">
        <div className="jq">{job.question}</div>
        {clickable && <span className="jopen">답변 보기 ›</span>}
        {failed && onClose && <button className="jclose" aria-label="닫기" onClick={onClose}>✕</button>}
        {(job.state === 'running' || job.state === 'queued') && onCancel && (
          <button className="jcancel" aria-label="취소" title="취소" onClick={(e) => { e.stopPropagation(); onCancel() }}>✕</button>
        )}
      </div>
      {done ? (
        <div className="stages"><span className="st ok"><Mark st="ok" />완료</span></div>
      ) : job.state === 'queued' ? (
        <div className="js">대기 중<span className="dots" /></div>
      ) : failed ? null : (
        <div className="stages">
          <span className="st run">
            <span className="spinner" aria-label="진행 중" />
            {job.stages.codex === 'ok' || job.stages.finish === 'run' ? '정리 중' : '수집 중'}
            <span className="dots" />
          </span>
        </div>
      )}
      {failed && <div className="js">실패: {job.error}</div>}
    </div>
  )
}
