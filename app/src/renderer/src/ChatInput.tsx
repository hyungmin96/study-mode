import { useState } from 'react'

interface Props {
  placeholder: string
  disabled?: boolean
  onSubmit: (text: string) => void
  className?: string
}

/** Enter 전송, Shift+Enter 줄바꿈. 한글 조합 중 Enter 는 전송하지 않는다. */
export function ChatInput({ placeholder, disabled, onSubmit, className }: Props): React.JSX.Element {
  const [v, setV] = useState('')
  return (
    <textarea
      className={className}
      value={v}
      rows={2}
      autoFocus
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
        e.preventDefault()
        const t = v.trim()
        if (!t) return
        onSubmit(t)
        setV('')
      }}
    />
  )
}
