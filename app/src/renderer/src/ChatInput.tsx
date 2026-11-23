import { useLayoutEffect, useRef, useState } from 'react'

interface Props {
  placeholder: string
  disabled?: boolean
  onSubmit: (text: string) => void
}

/** 제미나이 웹 입력란 스타일: 둥근 큰 입력 상자 + 오른쪽 아래 원형 전송 버튼.
 *  Enter 전송, Shift+Enter 줄바꿈. 한글 조합 중 Enter 는 전송하지 않는다. */
export function ChatInput({ placeholder, disabled, onSubmit }: Props): React.JSX.Element {
  const [v, setV] = useState('')
  const ta = useRef<HTMLTextAreaElement>(null)

  // 내용에 맞춰 높이를 늘린다 (최대 높이는 CSS)
  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [v])

  const send = (): void => {
    const t = v.trim()
    if (!t || disabled) return
    onSubmit(t)
    setV('')
  }

  return (
    <div className="chatbox" onClick={() => ta.current?.focus()}>
      <textarea
        ref={ta}
        value={v}
        rows={1}
        autoFocus
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
          e.preventDefault()
          send()
        }}
      />
      <button className="send" type="button" disabled={!v.trim() || disabled} aria-label="전송" title="전송 (Enter)" onClick={send}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 15.5V5M5.5 9.5 10 5l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
      </button>
    </div>
  )
}
