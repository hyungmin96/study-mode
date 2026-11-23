import type { JobInfo, StageState } from '../../shared/types'

// 수집 → 정리 → 완료 (완료는 작업이 끝난 뒤에만 켜진다)
const NAMES: ['codex' | 'finish' | 'complete', string][] = [
  ['codex', '수집'],
  ['finish', '정리'],
  ['complete', '완료']
]

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
}

export function JobProgress({ job, onOpen, onClose }: Props): React.JSX.Element {
  const failed = job.state === 'failed'
  const done = job.state === 'done'
  const active = job.state === 'running'
  const st = (k: 'codex' | 'finish' | 'complete'): StageState => (k === 'complete' ? (done ? 'ok' : 'wait') : job.stages[k])
  const clickable = done && !!onOpen
  return (
    <div
      className={'job' + (failed ? ' bad' : '') + (done ? ' done' : '') + (active ? ' active' : '') + (clickable ? ' clickable' : '')}
      onClick={clickable ? onOpen : undefined}
      role={clickable ? 'button' : undefined}
    >
      <div className="jhead">
        <div className="jq">{job.question}</div>
        {clickable && <span className="jopen">답변 보기 ›</span>}
        {failed && onClose && <button className="jclose" aria-label="닫기" onClick={onClose}>✕</button>}
      </div>
      {job.state === 'queued' ? (
        <div className="js">대기 중<span className="dots" /></div>
      ) : (
        <div className="stages">
          {NAMES.map(([k, label], i) => (
            <span key={k} className="stwrap">
              {i > 0 && <span className={'link' + (st(NAMES[i - 1][0]) === 'ok' ? ' on' : '')} />}
              <span className={'st ' + st(k)}>
                <Mark st={st(k)} />
                {label}
                {st(k) === 'run' && <span className="dots" />}
              </span>
            </span>
          ))}
        </div>
      )}
      {active && <div className="jbar"><i /></div>}
      {failed && <div className="js">실패: {job.error}</div>}
    </div>
  )
}
