import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, resolve } from 'path'
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'fs'
import type { Round } from '../shared/types'
import { Store } from './store'
import { JobManager } from './jobs'
import { registerOps } from './ops'

// study.py·data 위치(studyHome) 결정: STUDY_HOME 환경변수 > 개발 모드(app/ 의 상위) > 저장된 설정 > 폴더 선택 대화상자.
let studyHome = ''
let store!: Store
let jobs!: JobManager

const isHome = (p: string): boolean => existsSync(join(p, 'study.py'))
const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')

async function resolveStudyHome(): Promise<string | null> {
  if (process.env.STUDY_HOME) return process.env.STUDY_HOME
  if (!app.isPackaged) return resolve(app.getAppPath(), '..')
  try {
    const saved = JSON.parse(readFileSync(settingsFile(), 'utf8')).studyHome
    if (typeof saved === 'string' && isHome(saved)) return saved
  } catch {}
  for (;;) {
    const r = await dialog.showOpenDialog({
      title: 'study.py 가 있는 study-mode 폴더를 선택하세요',
      properties: ['openDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return null
    if (isHome(r.filePaths[0])) {
      writeFileSync(settingsFile(), JSON.stringify({ studyHome: r.filePaths[0] }))
      return r.filePaths[0]
    }
    await dialog.showMessageBox({ type: 'warning', message: '선택한 폴더에 study.py 가 없습니다.' })
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  const home = await resolveStudyHome()
  if (!home) return app.quit()
  studyHome = home
  store = new Store(join(studyHome, 'data'))
  jobs = new JobManager(studyHome, (j) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('job:event', j)))
  store.migrate()
  ipcMain.handle('index:list', () => store.read())
  ipcMain.handle('topic:get', (_e, key: string): Round[] => {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) return []
    const dir = join(studyHome, 'data', key, 'rounds')
    if (!existsSync(dir)) return []
    const out: Round[] = []
    for (const name of readdirSync(dir).sort()) {
      const ch = join(dir, name, 'chunks.html')
      if (!existsSync(ch)) continue
      const q = join(dir, name, 'question.txt')
      out.push({
        n: parseInt(name, 10),
        question: existsSync(q) ? readFileSync(q, 'utf8').trim() : '',
        // 구버전 배지 제거 (study.py rebuild 와 동일)
        html: readFileSync(ch, 'utf8').replace(/<span class="fix">[^<]*<\/span>\s*/g, '')
      })
    }
    return out
  })
  ipcMain.handle('job:ask', (_e, req: { key?: string; question: string }) => {
    if (!req.question?.trim()) throw new Error('질문이 비었습니다')
    if (req.key && !/^[A-Za-z0-9_-]+$/.test(req.key)) throw new Error('잘못된 key')
    return jobs.ask(req)
  })
  registerOps(studyHome, store, jobs)
  ipcMain.handle('job:list', () => jobs.list())
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('before-quit', () => jobs?.cancelAll())
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
