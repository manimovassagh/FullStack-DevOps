import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

// Terraform/make output carries ANSI colours: turned into spans. The text is never parsed as HTML.
const COLOR: Record<string, string> = {
  '1': 'font-semibold', '2': 'opacity-70', '31': 'text-red-400', '32': 'text-emerald-400', '33': 'text-amber-300', '34': 'text-sky-400',
  '35': 'text-fuchsia-400', '36': 'text-cyan-300', '90': 'text-zinc-500', '91': 'text-red-400', '92': 'text-emerald-400', '93': 'text-amber-300',
}
function Line({ text }: { text: string }) {
  const parts: { cls: string; text: string }[] = []
  let cls: string[] = []
  for (const part of text.split(/(\x1b\[[0-9;]*m)/)) {
    const m = part.match(/^\x1b\[([0-9;]*)m$/)
    if (m) {
      const codes = m[1].split(';').filter(Boolean)
      cls = !codes.length || codes.includes('0') ? [] : [...cls, ...codes.map((c) => COLOR[c] ?? '')]
      continue
    }
    if (part) parts.push({ cls: cls.join(' '), text: part })
  }
  const plain = text.replace(/\x1b\[[0-9;]*m/g, '')
  const tone = text.startsWith('$ ') ? 'text-emerald-300 font-semibold mt-2'
    : /\b(error|failed|FAIL)\b/i.test(plain) || plain.startsWith('[failed') ? 'text-red-300 bg-red-500/10'
    : /^\s*ok\s|PASSED|Apply complete|\bhealthy\b|^\[done\]|✓/.test(plain) ? 'text-emerald-300' : ''
  return <div className={cn('px-4 whitespace-pre-wrap break-words', tone)}>{parts.map((p, i) => <span key={i} className={p.cls}>{p.text}</span>)}</div>
}

export function LogView({ lines, filter = '', follow = true, className }: { lines: string[]; filter?: string; follow?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(true)
  const shown = useMemo(() => (filter ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase())) : lines), [lines, filter])
  useEffect(() => {
    const el = ref.current
    if (el && follow && stuck) el.scrollTop = el.scrollHeight
  }, [shown.length, follow, stuck])
  return (
    <div ref={ref} onScroll={(e) => { const el = e.currentTarget; setStuck(el.scrollTop + el.clientHeight >= el.scrollHeight - 40) }}
      className={cn('overflow-auto bg-[#070a08] py-3 font-mono text-[12.5px] leading-[1.55] text-zinc-300', className)}>
      {shown.length ? shown.map((l, i) => <Line key={i} text={l} />) : <div className="px-4 text-zinc-500">Waiting for output…</div>}
    </div>
  )
}
