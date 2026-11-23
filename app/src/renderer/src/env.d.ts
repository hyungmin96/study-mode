/// <reference types="vite/client" />
import type { StudyApi } from '../../shared/types'
declare global {
  interface Window { study: StudyApi }
}
