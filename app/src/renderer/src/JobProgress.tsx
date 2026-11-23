import type { JobInfo, StageState } from '../../shared/types'

const NAMES: [keyof JobInfo['stages'], string][] = [
  ['codex', '수집(luna)'],
  ['finish', '정리']
]
const MARK: Record<StageState, string> = { wait: '·', run: '⏳', ok: '✓', fail: '✗' }

export function JobProgress({ job }: { job: JobInfo }): React.JSX.Element {
  const failed = job.state === 'failed'
  return (
    <div className={'job' + (failed ? ' bad' : '')}>
      <div className="jq">{job.question}</div>
      {job.state === 'queued' ? (
        <div className="js">앞선 질문이 끝나면 시작합니다…</div>
      ) : (
        <div className="stages">
          {NAMES.map(([k, label]) => (
            <span key={k} className={'st ' + job.stages[k]}>
              {MARK[job.stages[k]]} {label}
              {job.substitute[k] ? ` (대체: ${job.substitute[k]})` : ''}
            </span>
          ))}
        </div>
      )}
      {failed && <div className="js">실패: {job.error}</div>}
    </div>
  )
}
