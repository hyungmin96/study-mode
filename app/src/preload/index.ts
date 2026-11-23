import { contextBridge, ipcRenderer } from 'electron'
import type { StudyApi, JobInfo } from '../shared/types'

const api: StudyApi = {
  listIndex: () => ipcRenderer.invoke('index:list'),
  getTopic: (key) => ipcRenderer.invoke('topic:get', key),
  ask: (req) => ipcRenderer.invoke('job:ask', req),
  listJobs: () => ipcRenderer.invoke('job:list'),
  cancelJob: (id) => ipcRenderer.invoke('job:cancel', id),
  createFolder: (n, p) => ipcRenderer.invoke('folder:create', n, p),
  renameFolder: (i, n) => ipcRenderer.invoke('folder:rename', i, n),
  renameTopic: (k, n) => ipcRenderer.invoke('topic:rename', k, n),
  moveTopic: (k, f) => ipcRenderer.invoke('topic:move', k, f),
  moveFolder: (i, p) => ipcRenderer.invoke('folder:move', i, p),
  deleteTopic: (k) => ipcRenderer.invoke('topic:delete', k),
  deleteItems: (r) => ipcRenderer.invoke('items:delete', r),
  deleteFolder: (i) => ipcRenderer.invoke('folder:delete', i),
  contextMenu: (t) => ipcRenderer.invoke('menu:context', t),
  onJob: (cb) => {
    const h = (_e: unknown, j: JobInfo): void => cb(j)
    ipcRenderer.on('job:event', h)
    return () => ipcRenderer.removeListener('job:event', h)
  }
}
contextBridge.exposeInMainWorld('study', api)
