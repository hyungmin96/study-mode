import { useState } from 'react'
import type { IndexData, MenuTarget } from '../../shared/types'

interface Props {
  hidden?: boolean
  data: IndexData
  selected: string | null
  running: Set<string>
  onSelect: (key: string) => void
  onNew: () => void
  onChange: () => void
  onError: (msg: string) => void
}

function FolderIcon({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg className="ficon" viewBox="0 0 20 16" aria-hidden="true">
      <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h4.6l1.8 2H17.5A1.5 1.5 0 0 1 19 4.5V13.5A1.5 1.5 0 0 1 17.5 15h-15A1.5 1.5 0 0 1 1 13.5z" fill="#b58900" />
      <path d={open ? 'M1 7h18l-1.6 7.3a1 1 0 0 1-1 .7H2.6a1 1 0 0 1-1-.7z' : 'M1 5h18v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 1 13.5z'} fill="#d4a017" />
    </svg>
  )
}

function ChatPlusIcon(): React.JSX.Element {
  return (
    <svg className="bicon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 2.5h12A2.5 2.5 0 0 1 18.5 5v7A2.5 2.5 0 0 1 16 14.5H9.5L5.5 18v-3.5H4A2.5 2.5 0 0 1 1.5 12V5A2.5 2.5 0 0 1 4 2.5z" fill="#3f63b8" />
      <path d="M10 5.5v6M7 8.5h6" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}
function FolderPlusIcon(): React.JSX.Element {
  return (
    <svg className="bicon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M1.5 5A1.5 1.5 0 0 1 3 3.5h4.2l1.7 1.8H17A1.5 1.5 0 0 1 18.5 6.8V15A1.5 1.5 0 0 1 17 16.5H3A1.5 1.5 0 0 1 1.5 15z" fill="#b98a00" />
      <path d="M10 8v5.5M7.25 10.75h5.5" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}
function TrashIcon(): React.JSX.Element {
  return (
    <svg className="bicon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7.5 2.5h5l.6 1.5H17a.75.75 0 0 1 0 1.5H3A.75.75 0 0 1 3 4h3.9z" fill="#b94a48" />
      <path d="M4.5 7h11l-.8 9.2a1.5 1.5 0 0 1-1.5 1.3H6.8a1.5 1.5 0 0 1-1.5-1.3z" fill="#b94a48" />
      <path d="M8.2 9.5v5M11.8 9.5v5" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

type Ref = { kind: 'folder' | 'topic'; id: string }
const same = (a: Ref | null, b: Ref): boolean => !!a && a.kind === b.kind && a.id === b.id

export function Sidebar({ hidden, data, selected, running, onSelect, onNew, onChange, onError }: Props): React.JSX.Element {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<Ref | null>(null)
  const [over, setOver] = useState<string | null>(null) // 드롭 대상 폴더 id, '' = 최상위
  const [drag, setDrag] = useState<Ref | null>(null)
  const [delMode, setDelMode] = useState(false) // 삭제 선택 모드
  const [picked, setPicked] = useState<Set<string>>(new Set()) // 선택 항목: 't:<key>' | 'f:<id>'
  const [naming, setNaming] = useState<string | null>(null) // 폴더 만들기 모달의 입력값, null = 닫힘

  const makeFolder = (): void => {
    const n = (naming ?? '').trim()
    setNaming(null)
    if (n) void run(() => window.study.createFolder(n, null))
  }

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
    } catch (e) {
      onError(String(e).replace(/^Error: (Error invoking remote method '[^']*': )?/, ''))
    }
    onChange()
  }

  const foldersIn = (parent: string | null): string[] =>
    Object.keys(data.folders)
      .filter((f) => (data.folders[f].parent ?? null) === parent)
      .sort((a, b) => data.folders[a].order - data.folders[b].order)
  const topicsIn = (folder: string | null): [string, IndexData['topics'][string]][] =>
    Object.entries(data.topics)
      .filter(([, t]) => (t.folder ?? null) === folder)
      .sort(([, a], [, b]) => b.created.localeCompare(a.created))
  const count = (f: string): number => topicsIn(f).length + foldersIn(f).reduce((n, c) => n + count(c), 0)

  const menu = async (e: React.MouseEvent, target: MenuTarget): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    const a = await window.study.contextMenu(target)
    if (!a) return
    const ref = target.kind === 'root' ? null : (target as Ref)
    if (a.type === 'newFolder') {
      await run(async () => {
        const id = await window.study.createFolder('새 폴더', a.parent)
        if (a.parent) setOpen((o) => ({ ...o, [a.parent as string]: true }))
        setEditing({ kind: 'folder', id })
      })
    } else if (a.type === 'rename' && ref) setEditing(ref)
    else if (a.type === 'move' && ref) {
      await run(() => (ref.kind === 'topic' ? window.study.moveTopic(ref.id, a.to) : window.study.moveFolder(ref.id, a.to)))
      if (a.to) setOpen((o) => ({ ...o, [a.to as string]: true }))
    } else if (a.type === 'delete' && ref) {
      await run(() => (ref.kind === 'topic' ? window.study.deleteTopic(ref.id) : window.study.deleteFolder(ref.id)))
    }
  }

  const commit = (ref: Ref, name: string, orig: string): void => {
    setEditing(null)
    const n = name.trim()
    if (!n || n === orig) return
    void run(() => (ref.kind === 'topic' ? window.study.renameTopic(ref.id, n) : window.study.renameFolder(ref.id, n)))
  }

  const label = (ref: Ref, text: string, prefix: React.ReactNode = ''): React.ReactNode =>
    same(editing, ref) ? (
      <input
        className="rename"
        autoFocus
        defaultValue={text}
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => commit(ref, e.currentTarget.value, text)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') setEditing(null)
        }}
      />
    ) : (
      <>{prefix}{text}</>
    )

  const drop = (target: string | null) => (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setOver(null)
    const d = drag
    setDrag(null)
    if (!d) return
    if (d.kind === 'folder' && d.id === target) return
    void run(() => (d.kind === 'topic' ? window.study.moveTopic(d.id, target) : window.study.moveFolder(d.id, target)))
    if (target) setOpen((o) => ({ ...o, [target]: true }))
  }
  const dragProps = (ref: Ref) => ({
    draggable: !delMode && !same(editing, ref),
    onDragStart: (e: React.DragEvent) => {
      e.stopPropagation()
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', ref.id)
      setDrag(ref)
    },
    onDragEnd: () => {
      setDrag(null)
      setOver(null)
    }
  })

  const toggle = (id: string): void =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const enterDel = (): void => {
    const all: Record<string, boolean> = {}
    for (const f of Object.keys(data.folders)) all[f] = true
    setOpen(all)
    setPicked(new Set())
    setDelMode(true)
  }
  const leaveDel = (): void => {
    setDelMode(false)
    setPicked(new Set())
  }
  const removePicked = async (): Promise<void> => {
    const ids = [...picked]
    let n = 0
    await run(async () => {
      n = await window.study.deleteItems({
        topics: ids.filter((x) => x.startsWith('t:')).map((x) => x.slice(2)),
        folders: ids.filter((x) => x.startsWith('f:')).map((x) => x.slice(2))
      })
    })
    if (n) leaveDel()
  }
  // 선택된 폴더 안의 항목은 함께 지워지므로 체크된 것으로 보여 준다
  const underPicked = (folder: string | null): boolean => {
    for (let f = folder; f; f = data.folders[f]?.parent ?? null) if (picked.has('f:' + f)) return true
    return false
  }
  const check = (id: string, inherited: boolean): React.JSX.Element => (
    <span className={'chk' + (picked.has(id) || inherited ? ' on' : '')} />
  )

  const topicRow = ([k, t]: [string, IndexData['topics'][string]], depth: number): React.JSX.Element => {
    const ref: Ref = { kind: 'topic', id: k }
    return (
      <div
        key={k}
        className={'item' + (selected === k && !delMode ? ' active' : '') + (delMode && (picked.has('t:' + k) || underPicked(t.folder ?? null)) ? ' picked' : '')}
        style={{ paddingLeft: 12 + depth * 14 }}
        onClick={() => (delMode ? !underPicked(t.folder ?? null) && toggle('t:' + k) : onSelect(k))}
        onContextMenu={(e) => menu(e, ref)}
        onDragOver={(e) => {
          if (!drag) return
          e.preventDefault()
          e.stopPropagation()
          setOver(t.folder ?? '')
        }}
        onDrop={drop(t.folder ?? null)}
        {...dragProps(ref)}
      >
        {delMode && check('t:' + k, underPicked(t.folder ?? null))}
        {label(ref, t.topic, running.has(k) ? <span className="spinner sm" /> : '')}
      </div>
    )
  }

  const folderRow = (f: string, depth: number): React.JSX.Element => {
    const ref: Ref = { kind: 'folder', id: f }
    return (
      <div key={f}>
        <div
          className={'item folder' + (over === f ? ' over' : '') + (delMode && (picked.has('f:' + f) || underPicked(data.folders[f].parent ?? null)) ? ' picked' : '')}
          style={{ paddingLeft: 12 + depth * 14 }}
          onClick={() => (delMode ? !underPicked(data.folders[f].parent ?? null) && toggle('f:' + f) : setOpen({ ...open, [f]: !open[f] }))}
          onContextMenu={(e) => menu(e, ref)}
          onDragOver={(e) => {
            if (!drag) return
            e.preventDefault()
            e.stopPropagation()
            setOver(f)
          }}
          onDrop={drop(f)}
          {...dragProps(ref)}
        >
          {delMode && check('f:' + f, underPicked(data.folders[f].parent ?? null))}
          {label(ref, data.folders[f].name, <FolderIcon open={!!open[f]} />)}
          <span className="cnt">{count(f)}</span>
        </div>
        {open[f] && (
          <>
            {foldersIn(f).map((c) => folderRow(c, depth + 1))}
            {topicsIn(f).map((e) => topicRow(e, depth + 1))}
          </>
        )}
      </div>
    )
  }

  return (
    <aside className={'sidebar' + (hidden ? ' hidden' : '')}>
      <div className="drag" />
      <div className="newrow">
        <button className="new" onClick={() => { leaveDel(); onNew() }}><ChatPlusIcon />새 채팅</button>
        <button className="ibtn" title="폴더 만들기" aria-label="폴더 만들기" onClick={() => setNaming('')}><FolderPlusIcon /></button>
        <button className={'ibtn' + (delMode ? ' active' : '')} title="삭제할 항목 선택" aria-label="삭제할 항목 선택" onClick={() => (delMode ? leaveDel() : enterDel())}><TrashIcon /></button>
      </div>
      <div
        className={'list' + (over === '' ? ' over' : '')}
        onClick={(e) => e.target === e.currentTarget && onNew()}
        onContextMenu={(e) => menu(e, { kind: 'root' })}
        onDragOver={(e) => {
          if (!drag) return
          e.preventDefault()
          setOver('')
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setOver(null)}
        onDrop={drop(null)}
      >
        {foldersIn(null).map((f) => folderRow(f, 0))}
        {topicsIn(null).map((e) => topicRow(e, 0))}
      </div>
      {delMode && (
        <div className="pickbar">
          <span>{picked.size ? `${picked.size}개 선택됨` : '삭제할 주제·폴더를 선택하세요'}</span>
          <button onClick={leaveDel}>취소</button>
          <button className="danger" disabled={!picked.size} onClick={removePicked}>삭제</button>
        </div>
      )}
      {naming !== null && (
        <div className="modal-back" onMouseDown={() => setNaming(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-title">새 폴더</div>
            <input
              autoFocus
              placeholder="폴더 이름"
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if (e.key === 'Enter') makeFolder()
                else if (e.key === 'Escape') setNaming(null)
              }}
            />
            <div className="modal-btns">
              <button onClick={() => setNaming(null)}>취소</button>
              <button className="primary" disabled={!naming.trim()} onClick={makeFolder}>만들기</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
