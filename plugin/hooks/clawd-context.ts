/**
 * What `/clawd debug` shows of an autopick's request. Pure, no `$`.
 *
 * A `$.ui.log` row takes no colour, so a label leads each line instead. A part
 * of the request is shown in full the first time and whenever it changed; after
 * that it is left out and named. This diff is against what was shown, not the
 * API's prompt cache: the prompt starts with the session summary, which changes
 * at every pick, so that cache can serve the system prompt at most. The header
 * row gives the real cache counts.
 */

/** One part of a picker request: the system prompt, a `<tag>` block of the prompt, or the text around them. */
export type Part = { name: string; text: string }

/**
 * Splits a request into `system`, each `<tag>...</tag>` block of the prompt
 * (named by its tag), and `instructions` for each run of lines outside a block.
 * A name that comes twice gets a number, so every part has its own.
 */
export function contextParts(system: string, prompt: string): Part[] {
  const parts: Part[] = [{ name: 'system', text: system }]
  const lines = prompt.split('\n')
  let rest: string[] = []
  const add = (name: string, text: string) => {
    const n = parts.filter(p => p.name === name || p.name.startsWith(`${name} `)).length
    parts.push({ name: n ? `${name} ${n + 1}` : name, text })
  }
  for (let i = 0; i < lines.length; i++) {
    const tag = /^<([a-z_]+)>/.exec(lines[i] ?? '')?.[1]
    const end = tag ? lines.findIndex((l, j) => j >= i && l.includes(`</${tag}>`)) : -1
    if (!tag || end < 0) {
      rest.push(lines[i] ?? '')
      continue
    }
    if (rest.length) add('instructions', rest.join('\n'))
    rest = []
    add(tag, lines.slice(i, end + 1).join('\n'))
    i = end
  }
  if (rest.length) add('instructions', rest.join('\n'))
  return parts
}

function chars(n: number): string {
  return n < 1000 ? `${n} chars` : `${(n / 1000).toFixed(1)}k chars`
}

/**
 * The rows for one pick. First a line naming the parts shown and the parts left
 * out because they are as last shown, with their size. Then every line of each
 * part shown, led by `new` or, for a line the part already had when it was last
 * shown, `same`. `shown` holds the text last shown per part and is updated.
 */
export function contextRows(parts: Part[], shown: Map<string, string>): string[] {
  const fresh = parts.filter(p => shown.get(p.name) !== p.text)
  const kept = parts.filter(p => shown.get(p.name) === p.text)
  const head = ['context']
  if (fresh.length === parts.length) head.push(`all ${parts.length} parts`)
  else head.push(fresh.length ? `shown: ${fresh.map(p => p.name).join(', ')}` : 'nothing new')
  if (kept.length) {
    const size = kept.reduce((n, p) => n + p.text.length, 0)
    head.push(`left out, as shown before: ${kept.map(p => p.name).join(', ')} (${chars(size)})`)
  }
  if (fresh.some(p => p.name === 'system')) head.push("the CLI's identity block sent before the system prompt is not visible to a mod")
  const rows = [head.join(' · ')]
  for (const p of fresh) {
    const before = new Set(shown.get(p.name)?.split('\n') ?? [])
    const lines = p.text.split('\n')
    lines.forEach((line, i) => {
      const text = p.name === 'system' && i === 0 ? `system: ${line}` : line
      rows.push(`${before.has(line) ? 'same' : 'new '} │ ${text}`)
    })
    shown.set(p.name, p.text)
  }
  return rows
}
