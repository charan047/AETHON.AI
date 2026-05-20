import { Fragment, type ReactNode } from 'react'
import { clsx } from 'clsx'

export function cleanMarkdownContent(content: string) {
  return content.replace(/<action>[\s\S]*?<\/action>/g, '').trim()
}

function renderInline(text: string) {
  return text
    .split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={index} className="font-semibold text-white">
            {part.slice(2, -2)}
          </strong>
        )
      }
      if (
        part.startsWith('*') &&
        part.endsWith('*') &&
        !part.startsWith('**') &&
        !part.endsWith('**')
      ) {
        return (
          <em key={index} className="italic text-white/80">
            {part.slice(1, -1)}
          </em>
        )
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code
            key={index}
            className="rounded border border-white/[0.08] bg-black/20 px-1 py-0.5 font-mono text-xs text-emerald-300"
          >
            {part.slice(1, -1)}
          </code>
        )
      }
      return <Fragment key={index}>{part}</Fragment>
    })
}

function renderTable(lines: string[]) {
  const rows = lines
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()))
    .filter(row => row.length > 0)

  if (rows.length < 2) return null
  const [header, ...body] = rows.filter((row, index) => index !== 1 || !row.every(cell => /^:?-{2,}:?$/.test(cell)))
  if (!header?.length) return null

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-white/[0.03]">
      <table className="min-w-full divide-y divide-white/[0.08] text-left text-sm text-[#D7E3F4]">
        <thead className="bg-white/[0.03]">
          <tr>
            {header.map((cell, index) => (
              <th key={index} className="px-4 py-3 font-semibold text-white">
                {renderInline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-4 py-3 align-top">
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderTextBlock(block: string, key: string) {
  const lines = block.split('\n')
  const nodes: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]?.trimEnd() || ''
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      const level = trimmed.match(/^#+/)?.[0].length || 1
      const content = trimmed.replace(/^#{1,3}\s+/, '')
      const Tag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3'
      nodes.push(
        <Tag
          key={`${key}_heading_${index}`}
          className={
            level === 1
              ? 'text-lg font-bold tracking-tight text-white mt-4 mb-2'
              : level === 2
                ? 'text-base font-bold text-white mt-4 mb-2'
                : 'text-sm font-semibold text-white/90 mt-3 mb-1'
          }
        >
          {renderInline(content)}
        </Tag>,
      )
      index += 1
      continue
    }

    if (trimmed.startsWith('|')) {
      const tableLines: string[] = []
      while (index < lines.length && (lines[index] || '').trim().startsWith('|')) {
        tableLines.push(lines[index] || '')
        index += 1
      }
      const table = renderTable(tableLines)
      if (table) nodes.push(<div key={`${key}_table_${index}`}>{table}</div>)
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length && /^[-*]\s+/.test((lines[index] || '').trim())) {
        items.push((lines[index] || '').trim().replace(/^[-*]\s+/, ''))
        index += 1
      }
      nodes.push(
        <ul key={`${key}_ul_${index}`} className="space-y-2">
          {items.map((item, itemIndex) => (
            <li key={itemIndex} className="flex gap-2.5 text-sm leading-6 text-[#D7E3F4]">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>,
      )
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length && /^\d+\.\s+/.test((lines[index] || '').trim())) {
        items.push((lines[index] || '').trim().replace(/^\d+\.\s+/, ''))
        index += 1
      }
      nodes.push(
        <ol key={`${key}_ol_${index}`} className="space-y-2">
          {items.map((item, itemIndex) => (
            <li key={itemIndex} className="flex gap-3 text-sm leading-6 text-[#D7E3F4]">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-[11px] font-semibold text-blue-300">
                {itemIndex + 1}
              </span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ol>,
      )
      continue
    }

    if (/^>\s?/.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length && /^>\s?/.test((lines[index] || '').trim())) {
        items.push((lines[index] || '').trim().replace(/^>\s?/, ''))
        index += 1
      }
      nodes.push(
        <blockquote
          key={`${key}_quote_${index}`}
          className="border-l-2 border-blue-500 pl-3 text-sm leading-7 text-white/70"
        >
          {items.map((item, itemIndex) => (
            <p key={itemIndex}>{renderInline(item)}</p>
          ))}
        </blockquote>,
      )
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length) {
      const candidate = (lines[index] || '').trim()
      if (
        !candidate ||
        /^#{1,3}\s+/.test(candidate) ||
        /^[-*]\s+/.test(candidate) ||
        /^\d+\.\s+/.test(candidate) ||
        /^>\s?/.test(candidate) ||
        candidate.startsWith('|')
      ) {
        break
      }
      paragraph.push(lines[index] || '')
      index += 1
    }

    if (paragraph.length > 0) {
      nodes.push(
        <p key={`${key}_p_${index}`} className="text-sm leading-7 text-[#D7E3F4]">
          {renderInline(paragraph.join(' '))}
        </p>,
      )
    } else {
      index += 1
    }
  }

  return nodes
}

export function MarkdownContent({
  content,
  className,
}: {
  content: string
  className?: string
}) {
  const cleaned = cleanMarkdownContent(content)
  if (!cleaned) return null

  const parts = cleaned.split(/```/g)

  return (
    <div className={clsx('space-y-4', className)}>
      {parts.map((part, index) => {
        const isCode = index % 2 === 1
        if (isCode) {
          return (
            <pre
              key={`code_${index}`}
              className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-black/30 p-4 font-mono text-xs leading-6 text-emerald-100"
            >
              <code>{part.replace(/^\w+\n/, '')}</code>
            </pre>
          )
        }

        return (
          <div key={`text_${index}`} className="space-y-3">
            {renderTextBlock(part, `text_${index}`)}
          </div>
        )
      })}
    </div>
  )
}
