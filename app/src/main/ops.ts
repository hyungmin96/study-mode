import { BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { existsSync } from 'fs'
import { basename, join } from 'path'
import type { IndexData, MenuAction, MenuTarget } from '../shared/types'
import type { Store } from './store'
import type { JobManager } from './jobs'

const KEY_RE = /^[A-Za-z0-9_-]+$/

function descendants(d: IndexData, folder: string): { folders: string[]; topics: string[] } {
  const folders = [folder]
  for (let i = 0; i < folders.length; i++) {
    for (const [id, f] of Object.entries(d.folders)) if (f.parent === folders[i] && !folders.includes(id)) folders.push(id)
  }
  const topics = Object.entries(d.topics).filter(([, t]) => t.folder && folders.includes(t.folder)).map(([k]) => k)
  return { folders, topics }
}

export function registerOps(studyHome: string, store: Store, jobs: JobManager): void {
  const busyKeys = (): Set<string> =>
    new Set(jobs.list().filter((j) => j.key && (j.state === 'running' || j.state === 'queued')).map((j) => j.key as string))

  const confirm = async (win: BrowserWindow | null, message: string, detail: string, ok: string): Promise<boolean> => {
    const opts = { type: 'warning' as const, buttons: [ok, '취소'], defaultId: 1, cancelId: 1, message, detail }
    const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    return r.response === 0
  }

  /** 주제 디렉터리(와 구버전 html 파일)를 휴지통으로 보낸다. */
  const trashTopic = async (key: string, d: IndexData): Promise<void> => {
    const dir = join(studyHome, 'data', key)
    if (existsSync(dir)) await shell.trashItem(dir)
    const h = d.topics[key]?.html
    if (h) {
      const f = join(studyHome, 'html', basename(h))
      if (basename(f).startsWith(key) && existsSync(f)) await shell.trashItem(f)
    }
  }

  const newFolderId = (d: IndexData): string => {
    for (;;) {
      const id = 'f_' + Math.random().toString(36).slice(2, 6)
      if (!d.folders[id]) return id
    }
  }

  ipcMain.handle('folder:create', async (_e, name: string, parent: string | null) => {
    const n = String(name).trim()
    if (!n) throw new Error('폴더 이름이 비었습니다')
    let id = ''
    await store.update((d) => {
      if (parent && !d.folders[parent]) throw new Error('상위 폴더가 없습니다')
      id = newFolderId(d)
      const order = Math.max(-1, ...Object.values(d.folders).map((f) => f.order)) + 1
      d.folders[id] = { name: n, parent, order }
    })
    return id
  })

  ipcMain.handle('folder:rename', async (_e, id: string, name: string) => {
    const n = String(name).trim()
    if (!n) throw new Error('이름이 비었습니다')
    await store.update((d) => {
      if (!d.folders[id]) throw new Error('폴더가 없습니다')
      d.folders[id].name = n
    })
  })

  ipcMain.handle('topic:rename', async (_e, key: string, name: string) => {
    const n = String(name).trim()
    if (!n || !KEY_RE.test(key)) throw new Error('잘못된 요청')
    await store.update((d) => {
      if (!d.topics[key]) throw new Error('주제가 없습니다')
      d.topics[key].topic = n
    })
  })

  ipcMain.handle('topic:move', async (_e, key: string, folder: string | null) => {
    await store.update((d) => {
      if (!d.topics[key]) throw new Error('주제가 없습니다')
      if (folder && !d.folders[folder]) throw new Error('폴더가 없습니다')
      d.topics[key].folder = folder
    })
  })

  ipcMain.handle('folder:move', async (_e, id: string, parent: string | null) => {
    await store.update((d) => {
      if (!d.folders[id]) throw new Error('폴더가 없습니다')
      if (parent && !d.folders[parent]) throw new Error('폴더가 없습니다')
      if (parent && descendants(d, id).folders.includes(parent)) throw new Error('자기 하위 폴더로는 옮길 수 없습니다')
      d.folders[id].parent = parent
    })
  })

  ipcMain.handle('topic:delete', async (e, key: string): Promise<boolean> => {
    if (!KEY_RE.test(key)) return false
    const win = BrowserWindow.fromWebContents(e.sender)
    const d = store.read()
    const t = d.topics[key]
    if (!t) return false
    if (busyKeys().has(key)) throw new Error('수집 중인 주제는 삭제할 수 없습니다')
    if (!(await confirm(win, `"${t.topic}" 주제를 삭제할까요?`, '데이터가 휴지통으로 이동합니다.', '삭제'))) return false
    await trashTopic(key, d)
    await store.update((x) => {
      delete x.topics[key]
    })
    return true
  })

  /** 선택한 주제·폴더를 한 번의 확인으로 삭제한다 (폴더는 안의 주제까지, 주제는 휴지통). */
  ipcMain.handle('items:delete', async (e, req: { topics: string[]; folders: string[] }): Promise<number> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const d = store.read()
    const fset = new Set<string>()
    const tset = new Set<string>()
    for (const id of req.folders ?? []) {
      if (!d.folders[id]) continue
      const r = descendants(d, id)
      r.folders.forEach((f) => fset.add(f))
      r.topics.forEach((t) => tset.add(t))
    }
    for (const k of req.topics ?? []) if (KEY_RE.test(k) && d.topics[k]) tset.add(k)
    if (!fset.size && !tset.size) return 0
    const busy = busyKeys()
    if ([...tset].some((k) => busy.has(k))) throw new Error('수집 중인 주제가 있어 삭제할 수 없습니다')
    const detail = `주제 ${tset.size}개${fset.size ? `와 폴더 ${fset.size}개` : ''}가 삭제되며, 주제 데이터는 휴지통으로 이동합니다.`
    if (!(await confirm(win, '선택한 항목을 삭제할까요?', detail, '삭제'))) return 0
    for (const k of tset) await trashTopic(k, d)
    await store.update((x) => {
      for (const k of tset) delete x.topics[k]
      for (const f of fset) delete x.folders[f]
    })
    return tset.size + fset.size
  })

  ipcMain.handle('folder:delete', async (e, id: string): Promise<boolean> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const d = store.read()
    const f = d.folders[id]
    if (!f) return false
    const { folders, topics } = descendants(d, id)
    const busy = busyKeys()
    if (topics.some((k) => busy.has(k))) throw new Error('수집 중인 주제가 있어 삭제할 수 없습니다')
    const detail = `폴더 ${folders.length}개와 안의 주제 ${topics.length}개가 함께 삭제되며, 주제는 휴지통으로 이동합니다.`
    if (!(await confirm(win, `"${f.name}" 폴더를 삭제할까요?`, detail, '삭제'))) return false
    for (const k of topics) await trashTopic(k, d)
    await store.update((x) => {
      for (const k of topics) delete x.topics[k]
      for (const fid of folders) delete x.folders[fid]
    })
    return true
  })

  /** 우클릭 메뉴: 네이티브 메뉴를 띄우고 고른 동작을 렌더러에 돌려준다 (이름 변경 입력은 렌더러가 처리). */
  ipcMain.handle('menu:context', (e, target: MenuTarget): Promise<MenuAction | null> => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const d = store.read()
    return new Promise((resolve) => {
      let picked: MenuAction | null = null
      const pick = (a: MenuAction) => (): void => {
        picked = a
      }
      const tpl: Electron.MenuItemConstructorOptions[] = []
      const folderId = target.kind === 'folder' ? target.id : null
      if (target.kind === 'root' || target.kind === 'folder') {
        tpl.push({ label: '새 폴더', click: pick({ type: 'newFolder', parent: folderId }) })
      }
      if (target.kind !== 'root') {
        tpl.push({ label: '이름 변경', click: pick({ type: 'rename' }) })
        const cur = target.kind === 'topic' ? d.topics[target.id]?.folder ?? null : d.folders[target.id]?.parent ?? null
        const banned = target.kind === 'folder' ? new Set(descendants(d, target.id).folders) : new Set<string>()
        const dests: Electron.MenuItemConstructorOptions[] = []
        if (cur !== null) dests.push({ label: '(최상위)', click: pick({ type: 'move', to: null }) })
        const label = (id: string): string => {
          const parts: string[] = []
          for (let c: string | null = id, n = 0; c && d.folders[c] && n < 20; c = d.folders[c].parent, n++) parts.unshift(d.folders[c].name)
          return parts.join(' / ')
        }
        for (const id of Object.keys(d.folders).sort((a, b) => label(a).localeCompare(label(b)))) {
          if (id !== cur && !banned.has(id)) dests.push({ label: label(id), click: pick({ type: 'move', to: id }) })
        }
        tpl.push({ label: '폴더로 이동', submenu: dests.length ? dests : [{ label: '(이동할 폴더 없음)', enabled: false }] })
        tpl.push({ type: 'separator' })
        tpl.push({ label: '삭제…', click: pick({ type: 'delete' }) })
      }
      Menu.buildFromTemplate(tpl).popup({ window: win, callback: () => resolve(picked) })
    })
  })
}
