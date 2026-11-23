import mermaidUrl from '../../../../vendor/mermaid.min.js?url'

type Mermaid = {
  initialize(c: object): void
  run(o: object): Promise<void>
}
let loading: Promise<Mermaid | null> | null = null

function loadMermaid(): Promise<Mermaid | null> {
  if (!loading) {
    loading = new Promise((res) => {
      const s = document.createElement('script')
      s.src = mermaidUrl
      s.onload = () => {
        const m = (window as unknown as { mermaid?: Mermaid }).mermaid
        if (!m) return res(null)
        const dk = matchMedia('(prefers-color-scheme: dark)').matches
        const lb = dk ? '#2b2a28' : '#f1efea'
        const lt = dk ? '#d9d6d0' : '#3a3833'
        const lbd = dk ? '#5c5a55' : '#d8d4cb'
        m.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: dk ? 'dark' : 'neutral',
          fontFamily: '-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif',
          themeVariables: { edgeLabelBackground: lb },
          flowchart: { useMaxWidth: false, padding: 12, nodeSpacing: 40, rankSpacing: 56 },
          state: { useMaxWidth: false },
          themeCSS:
            '.edgeLabel,.edgeLabel rect,.edgeLabel .labelBkg{background-color:transparent!important;fill:transparent!important}' +
            `.edgeLabel span.edgeLabel{display:inline-block;padding:4px 10px;border-radius:5px;border:1px solid ${lbd};background-color:${lb};color:${lt}}` +
            '.edgeLabel p,.edgeLabel span{font-size:12px;line-height:1.3;margin:0}'
        })
        res(m)
      }
      s.onerror = () => res(null)
      document.head.appendChild(s)
    })
  }
  return loading
}

/** root 안의 pre.mermaid 를 그림으로 바꾸고, 그림 속 단어 → legend 메모를 연결한다. */
export async function enhance(root: HTMLElement): Promise<void> {
  const pres = root.querySelectorAll('pre.mermaid:not([data-processed])')
  if (pres.length) {
    const m = await loadMermaid()
    if (m) {
      await m.run({ nodes: Array.from(pres), suppressErrors: true })
      root.querySelectorAll('pre.mermaid .edgeLabel').forEach((e) => {
        if (!e.textContent?.trim()) (e as HTMLElement).style.display = 'none'
      })
      root.querySelectorAll('pre.mermaid svg').forEach((s) => {
        const svg = s as SVGSVGElement
        const p = svg.parentElement as HTMLElement
        const w = svg.viewBox?.baseVal?.width || svg.getBoundingClientRect().width
        const c = p.clientWidth
        if (!w || w <= c) return
        if (c / w >= 0.7) svg.style.maxWidth = '100%'
        else p.classList.add('wide')
      })
    }
  }
  tips(root)
}

const norm = (s: string): string => (s || '').toLowerCase().replace(/[\s"'“”()·:?]/g, '')
let memo: HTMLElement | null = null
let cur: Element | null = null
function closeMemo(): void {
  memo?.remove()
  memo = null
  cur?.classList.remove('on')
  cur = null
}
let globalBound = false
function bindGlobal(): void {
  if (globalBound) return
  globalBound = true
  document.addEventListener('click', (e) => {
    if (memo && !memo.contains(e.target as Node)) closeMemo()
  })
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMemo())
  window.addEventListener('resize', closeMemo)
}

function openMemo(el: Element, name: string, desc: string): void {
  if (cur === el) return closeMemo()
  closeMemo()
  cur = el
  el.classList.add('on')
  memo = document.createElement('div')
  memo.className = 'memo'
  memo.setAttribute('role', 'note')
  const b = document.createElement('b')
  b.textContent = name
  const x = document.createElement('button')
  x.className = 'x'
  x.type = 'button'
  x.textContent = '×'
  x.setAttribute('aria-label', '닫기')
  x.addEventListener('click', (e) => {
    e.stopPropagation()
    closeMemo()
  })
  memo.append(x, b, document.createTextNode(desc))
  document.body.appendChild(memo)
  const r = el.getBoundingClientRect()
  const mw = memo.offsetWidth
  const mh = memo.offsetHeight
  const vw = document.documentElement.clientWidth
  const left = Math.min(Math.max(8, r.left + r.width / 2 - mw / 2), vw - mw - 8)
  let top = r.bottom + 8
  if (top + mh > window.innerHeight && r.top - mh - 8 > 0) top = r.top - mh - 8
  memo.style.left = left + 'px'
  memo.style.top = top + 'px'
}

function tips(root: HTMLElement): void {
  bindGlobal()
  root.querySelectorAll('figure.diagram:not([data-tips])').forEach((fig) => {
    const ul = fig.nextElementSibling
    if (!ul || !ul.matches('ul.legend')) return
    fig.setAttribute('data-tips', '1')
    const items: { name: string; desc: string; al: string[] }[] = []
    ul.querySelectorAll('li').forEach((li) => {
      const s = li.querySelector('strong')
      if (!s) return
      const name = (s.textContent || '').trim()
      const desc = (li.textContent || '').replace(s.textContent || '', '').replace(/^\s*[:：\-–]\s*/, '').trim()
      const al = [name]
      const m = name.match(/^(.*?)(\S+)\s*\/\s*(\S+)$/)
      if (m) al.push(m[1] + m[2], m[1] + m[3])
      name.split(/\s*(?:\/|·|,|와|과|및)\s*/).forEach((p) => p.length > 1 && al.push(p))
      items.push({ name, desc, al: al.map(norm).filter((a) => a.length > 1) })
    })
    if (!items.length) return
    const svg = fig.querySelector('svg')
    if (!svg) return
    let hit = 0
    const seen: Element[] = []
    svg
      .querySelectorAll('g.node, g.edgeLabel, g.cluster, text.actor, text.messageText, g.statediagram-state, text.noteText')
      .forEach((el) => {
        const label = el.matches('g.cluster') ? el.querySelector('.cluster-label, .nodeLabel, text') : el
        if (!label) return
        const t = norm(label.textContent || '')
        if (!t) return
        let best: (typeof items)[number] | null = null
        let score = 0
        items.forEach((it) =>
          it.al.forEach((a) => {
            const sc = t === a ? 1000 + a.length : t.indexOf(a) >= 0 && a.length / t.length >= 0.4 ? a.length : 0
            if (sc > score) {
              score = sc
              best = it
            }
          })
        )
        if (!best) return
        const b = best as (typeof items)[number]
        const target =
          el.matches('text.actor') && el.parentElement?.tagName.toLowerCase() === 'g'
            ? el.parentElement
            : el.matches('g.cluster')
              ? label
              : el
        if (seen.includes(target)) return
        seen.push(target)
        target.classList.add('tip')
        target.setAttribute('tabindex', '0')
        target.setAttribute('role', 'button')
        const go = (e: Event): void => {
          e.stopPropagation()
          openMemo(target, b.name, b.desc)
        }
        target.addEventListener('click', go)
        target.addEventListener('keydown', (e) => {
          const k = (e as KeyboardEvent).key
          if (k === 'Enter' || k === ' ') {
            e.preventDefault()
            go(e)
          }
        })
        hit++
      })
    if (!hit) return
    const hint = document.createElement('p')
    hint.className = 'tip-hint'
    hint.textContent = '그림 속 단어를 누르면 설명이 나와요'
    fig.appendChild(hint)
    const d = document.createElement('details')
    d.className = 'legend-all'
    const sm = document.createElement('summary')
    sm.textContent = `설명 전체 보기 (${items.length})`
    ul.parentNode!.insertBefore(d, ul)
    d.append(sm, ul)
  })
}
