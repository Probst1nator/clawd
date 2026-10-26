import type { RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  bandRows,
  besideClawd,
  callActs,
  createWorld,
  emoteFrom,
  emoteJson,
  emotePreview,
  emoteSheet,
  endMini,
  frameCells,
  linkRoutine,
  onPrompt,
  onTool,
  onTurnEnd,
  perform,
  resize,
  routineFrom,
  seeded,
  setEdge,
  setLabel,
  setSkin,
  skinAsEmote,
  skinFrom,
  spawnMini,
  step,
  wantsTall,
  MINI_GAP,
  WALK,
} from '../hooks/clawd-sim'
import type { Emote, Routine, Skin } from '../hooks/clawd-sim'
import { contextParts, contextRows } from '../hooks/clawd-context'
import { UML_LEGEND, UML_WIDTH, clawdUml, umlKinds } from '../hooks/clawd-uml'
import { COMMANDS, marksFor, menuFor, menuLayout, orderOf, writeOut } from '../hooks/clawd-words'
import type { Names } from '../hooks/clawd-words'

// The Raster cells as text, one string per row (glyphs only).
function rows(cells: string, columns: number): string[] {
  const bytes = (Uint8Array as unknown as { fromBase64(s: string): Uint8Array }).fromBase64(cells)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: string[] = []
  let line = ''
  for (let i = 0; i < bytes.byteLength / 12; i++) {
    line += String.fromCodePoint(view.getUint32(i * 12, true))
    if ((i + 1) % columns === 0) {
      out.push(line.trimEnd())
      line = ''
    }
  }
  return out
}

test('standing still, Clawd is the logo, on its floor line', async () => {
  const w = createWorld(20, 3, seeded(1))
  w.queue = []
  w.x = 9
  w.act = { kind: 'idle', t0: 0, stage: 0, dur: 99, next: 99, look: 0 }
  w.blinkAt = 999
  step(w)
  expect(rows(frameCells(w), 20)).toEqual([' ▐▛███▜▌', '▝▜█████▛▘', `──▘▘─▝▝${'─'.repeat(13)}`])
})

test('while /clawd is typed, the floor is the top edge of the menu, with Clawd standing on it', async () => {
  const w = createWorld(40, 3, seeded(1))
  w.queue = []
  w.x = 49
  w.act = { kind: 'idle', t0: 0, stage: 0, dur: 99, next: 99, look: 0 }
  w.blinkAt = 999
  step(w)
  setEdge(w, '/clawd', 'hi')
  expect(rows(frameCells(w), 40)[2]).toBe(`╭─ /clawd · hi ${'─'.repeat(7)}▘▘─▝▝${'─'.repeat(12)}╮`)
  // A title too long for the edge ends in `...`, clear of both corners. Clawd's feet still cover it.
  setEdge(w, '/clawd act', 'x'.repeat(60))
  expect(rows(frameCells(w), 40)[2]).toMatch(/^╭─ \/clawd act · x+▘▘x▝▝x+\.\.\. ─╮$/)
  expect(rows(frameCells(w), 40)[2]).toHaveLength(40)
  setEdge(w, null)
  expect(rows(frameCells(w), 40)[2]).toBe(`${'─'.repeat(22)}▘▘─▝▝${'─'.repeat(13)}`)
})

test('session events steer Clawd: work builds a pile, an error trips it, the turn end celebrates', async () => {
  const w = createWorld(100, 5, seeded(3))
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * 20; i++) step(w)
  }
  run(4)
  onPrompt(w)
  expect(w.mode).toBe('work')
  for (let i = 0; i < 8; i++) {
    onTool(w, false)
    run(2)
  }
  expect(w.pile).toBeGreaterThan(1)

  onTool(w, true)
  run(0.1)
  expect(w.act?.kind).toBe('trip')

  onTurnEnd(w, 'answer')
  run(0.3)
  expect(w.mode).toBe('idle')
  expect(w.particles.some(p => p.glyph === '*' || p.glyph === '+')).toBe(true)
})

test('a call that only reads has Clawd hold up a scroll until 1.2 s after the last one, with no brick', async () => {
  const w = createWorld(100, 5, seeded(3))
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 20); i++) step(w)
  }
  run(4)
  onTool(w, false, undefined, true) // idle: Clawd does not react
  expect(w.queue.some(a => a.kind === 'read')).toBe(false)

  onPrompt(w)
  onTool(w, false, undefined, true)
  for (let i = 0; i < 200 && w.act?.kind !== 'read'; i++) step(w)
  const read = w.act
  expect(read?.kind).toBe('read')
  for (let k = 0; k < 3; k++) {
    run(0.5)
    onTool(w, false, undefined, true)
  }
  expect(w.queue.some(a => a.kind === 'read' || a.kind === 'carry')).toBe(false)
  const shown = colors(frameCells(w))
  expect(shown.has(0xe8dcb8) && shown.has(0x8b5e34)).toBe(true) // the scroll's paper and rolls

  const last = w.t
  for (let i = 0; i < 100 && w.act === read; i++) step(w)
  expect(w.t - last).toBeGreaterThan(1.1)
  expect(w.t - last).toBeLessThan(1.4)
  expect(w.pile).toBe(0)

  onTool(w, true, undefined, true)
  run(0.1)
  expect(w.act?.kind).toBe('trip')

  const mini = spawnMini(w, 'agent-x', 'Read the docs', 'Explore')
  run(4)
  onTool(w, false, 'agent-x', true)
  run(0.1)
  expect(mini?.act?.kind).toBe('read')
  expect(mini?.queue.some(a => a.kind === 'carry')).toBe(false)
})

test('/clawd jump 3 queues three jumps, and each one finishes', async () => {
  const w = createWorld(100, 5, seeded(2))
  for (let i = 0; i < 40; i++) step(w)
  perform(w, 'jump', 3)
  expect(w.queue.map(a => a.kind)).toEqual(['jump', 'jump', 'jump'])
  const started = new Set<object>()
  for (let i = 0; i < 20 * 20; i++) {
    step(w)
    if (w.act?.kind === 'jump') started.add(w.act)
    if (w.act?.kind !== 'jump' && !w.queue.some(a => a.kind === 'jump')) break
  }
  expect(started.size).toBe(3)
  expect(w.act?.kind).not.toBe('jump')
})

test('a routine a model wrote is checked, plays its steps, and the label sits at the top right', async () => {
  expect(routineFrom({ name: 'jump', title: 'x', steps: [{ do: 'hop' }] })).toBe('jump is a built-in act')
  expect(routineFrom({ name: 'spin', title: 'x', steps: [{ do: 'fly' }] })).toBe('unknown step "fly"')
  const r = routineFrom({
    name: 'victory_lap',
    title: 'Victory lap',
    steps: [{ do: 'run', to: 0.5 }, { do: 'mark', glyph: '!' }, { do: 'pose', arms: 'up', dur: 9, extra: 1 }],
  })
  expect(r).toEqual({
    name: 'victory_lap',
    title: 'Victory lap',
    steps: [{ do: 'run', to: 0.5 }, { do: 'mark', glyph: '!' }, { do: 'pose', arms: 'up', dur: 4 }],
  })

  const w = createWorld(40, 4, seeded(5))
  w.queue = []
  w.x = 10
  w.act = { kind: 'idle', t0: 0, stage: 0, dur: 0.1, next: 99, look: 0 }
  callActs(w, [{ who: 'clawd', what: r as Routine, delay: 0 }])
  const kinds: string[] = []
  let sawMark = false
  for (let i = 0; i < 20 * 15; i++) {
    step(w)
    const kind = w.act?.routine === 'victory_lap' ? w.act.kind : undefined
    if (kind && kinds[kinds.length - 1] !== kind) kinds.push(kind)
    sawMark ||= w.particles.some(p => p.glyph === '!')
  }
  expect(kinds).toEqual(['run', 'pose'])
  expect(sawMark).toBe(true)

  setLabel(w, 'act: victory_lap 🎉')
  // Ends four cells from the right edge, clear of the engine's `[-]`.
  expect(rows(frameCells(w), 40)[0]).toMatch(/ act: victory_lap$/)
  expect(rows(frameCells(w), 40)[0]).toHaveLength(36)
})

test('a run with wrap leaves the band ahead, runs straight back in from the other edge, and stops where it started', async () => {
  const r = routineFrom({ name: 'lap', title: 'a lap', steps: [{ do: 'run', wrap: true, dir: 1 }] })
  expect(r).toEqual({ name: 'lap', title: 'a lap', steps: [{ do: 'run', dir: 1, wrap: true }] })

  const w = createWorld(40, 4, seeded(5)) // 80 sub-pixels wide
  w.queue = []
  w.x = 30
  w.act = { kind: 'idle', t0: 0, stage: 0, dur: 0.1, next: 99, look: 0 }
  callActs(w, [{ who: 'clawd', what: r as Routine, delay: 0 }])
  const path: string[] = []
  let seconds = 0
  for (let i = 1; i <= 20 * 8; i++) {
    step(w)
    const where = w.x > 80 ? 'off right' : w.x < 0 ? 'off left' : 'on'
    if (path[path.length - 1] !== where) path.push(where)
    if (w.act?.kind === 'run') seconds = i / 20
    else if (seconds) break
  }
  expect(path).toEqual(['on', 'off right', 'off left', 'on'])
  expect(w.x).toBe(30)
  // 108 sub-pixels at full speed (36 a second) is 3 s; a walk back would take far longer.
  expect(seconds).toBeLessThan(3.5)
})

test("a step's arms, eyes, look and up apply on top of any act, so a run waves while it runs", async () => {
  const r = routineFrom({
    name: 'wave_run',
    title: 'runs and waves',
    steps: [{ do: 'run', to: 0.8, arms: 'wave', eyes: 'wide', look: -1, up: true }, { do: 'run', to: 0.2 }],
  })
  expect(r).toEqual({
    name: 'wave_run',
    title: 'runs and waves',
    steps: [{ do: 'run', to: 0.8, arms: 'wave', eyes: 'wide', look: -1, up: true }, { do: 'run', to: 0.2 }],
  })
  const w = createWorld(40, 4, seeded(5))
  w.queue = []
  w.x = 10
  w.act = { kind: 'idle', t0: 0, stage: 0, dur: 0.1, next: 99, look: 0 }
  callActs(w, [{ who: 'clawd', what: r as Routine, delay: 0 }])
  const seen: string[] = []
  for (let i = 0; i < 20 * 10; i++) {
    step(w)
    if (w.act?.routine !== 'wave_run' || w.vx === 0) continue
    const what = `${w.act.to! > 40 ? 'out' : 'back'}: ${w.arms} ${w.eyes} ${w.look} ${w.lookUp}`
    if (seen[seen.length - 1] !== what) seen.push(what)
  }
  // The first run waves, stares and looks back and up; the second runs as a plain run does.
  expect(seen).toEqual(['out: wave wide -1 true', 'back: out open 1 false'])
})

test('a move step goes at the speed it names, and an eased one speeds up from a stand and slows to a stop', async () => {
  const r = routineFrom({
    name: 'moves',
    title: 'moves',
    steps: [
      { do: 'move', to: 0.5, speed: 2 },
      { do: 'move', to: 0.1, speed: 'run', ease: true },
      { do: 'move', speed: 9 },
      { do: 'wander', speed: 'fast', ease: 1 },
    ],
  })
  expect((r as Routine).steps).toEqual([
    { do: 'move', to: 0.5, speed: 2 },
    { do: 'move', to: 0.1, speed: 'run', ease: true },
    { do: 'move', speed: 4 },
    { do: 'wander' },
  ])
  const w = createWorld(40, 4, seeded(5)) // 80 sub-pixels wide
  w.queue = []
  w.x = 10
  w.act = { kind: 'idle', t0: 0, stage: 0, dur: 0.1, next: 99, look: 0 }
  callActs(w, [{ who: 'clawd', what: { ...(r as Routine), steps: (r as Routine).steps.slice(0, 2) }, delay: 0 }])
  const speeds: number[][] = [[], []]
  let at = -1
  for (let i = 0; i < 20 * 10; i++) {
    const before = w.x
    step(w)
    if (w.act?.routine !== 'moves' && speeds[1]!.length > 0) break
    if (w.act?.routine !== 'moves') continue
    const n = w.act.ease ? 1 : 0
    if (n === 1 && at < 0) at = before
    speeds[n]!.push(Math.abs(w.vx))
  }
  // Two walking speeds is 24 a second, flat from the first tick to the last.
  expect(new Set(speeds[0]!.slice(0, -1))).toEqual(new Set([24]))
  expect(at).toBe(40)
  // The eased run starts slow, reaches 36 and slows down before it stops at 8.
  const eased = speeds[1]!.filter(v => v > 0)
  // 4.5, 9, ... 36 over 0.4 s; then 32.6, 27.7, 22.8, 17.7, 12.4 and it stands.
  expect(eased[0]).toBeLessThan(6)
  expect(Math.max(...eased)).toBe(36)
  expect(eased.slice(-4).every((v, i, all) => v < 30 && (i === 0 || v < all[i - 1]!))).toBe(true)
  expect(w.x).toBe(8)
})

test('an emote step puts on a look and the act goes on in it; a play step plays another made act, one level deep', async () => {
  expect(routineFrom({ name: 'loop', title: 'loop', steps: [{ do: 'play', name: 'loop' }] })).toBe('loop plays itself')
  expect(routineFrom({ name: 'odd', title: 'odd', steps: [{ do: 'emote', name: 'Octo!' }] })).toBe('bad emote name "Octo!"')
  const look = emoteFrom(OCTOPUS) as Emote
  const inner = routineFrom({ name: 'inner', title: 'inner', steps: [{ do: 'hop' }, { do: 'play', name: 'outer' }, { do: 'wave', dur: 0.4 }] }) as Routine
  const outer = routineFrom({
    name: 'outer',
    title: 'outer',
    steps: [{ do: 'emote', name: 'octo', dur: 50 }, { do: 'play', name: 'inner' }, { do: 'emote', name: 'nobody' }, { do: 'sparks', n: 2 }],
  }) as Routine
  expect(outer.steps[0]).toEqual({ do: 'emote', name: 'octo', dur: 20 })
  const linked = linkRoutine(outer, name => [look, inner, outer].find(x => x.name === name))
  expect(linked.steps[0]!.worn).toBe(look)
  // inner's own play of outer is dropped there, so acts cannot play each other in a loop.
  expect(linked.steps[1]!.inner!.map(s => s.do)).toEqual(['hop', 'play', 'wave'])
  expect(linked.steps[1]!.inner![1]!.inner).toBe(undefined)
  expect(linked.steps[2]!.worn).toBe(undefined)
  expect(outer.steps[0]!.worn).toBe(undefined)

  const w = createWorld(40, 5, seeded(6))
  w.queue = []
  w.x = 30
  w.act = { kind: 'idle', t0: 0, stage: 0, dur: 99, next: 99, look: 0 }
  perform(w, linked)
  step(w)
  // The routine hands its tick to its first step. Each act knows its step; the played act's acts
  // name it. An emote that is not there plays nothing.
  expect([w.act, ...w.queue].map(a => [a?.kind, a?.step, a?.via ?? ''])).toEqual([
    ['emote', 1, ''],
    ['hop', 2, 'inner'],
    ['wave', 2, 'inner'],
    ['sparks', 4, ''],
  ])
  let wore = -1
  for (let i = 0; i < 20 * 3 && wore < 0; i++) {
    step(w)
    if (w.wearing) wore = w.t
  }
  // No show-off: the routine goes straight on, and the look stays for the step's 20 s.
  expect(w.queue.map(a => a.kind)).toEqual(['hop', 'wave', 'sparks'])
  expect(Math.round(w.wornUntil - wore)).toBe(20)
  for (let i = 0; i < 20 * 5 && (w.act?.routine === 'outer' || w.queue.some(a => a.routine === 'outer')); i++) step(w)
  expect(w.queue.some(a => a.routine === 'outer')).toBe(false)
  expect(w.wearing?.name).toBe('octo')
})

test('a step that takes no time hands its tick to the next one, so a sitting pose holds through a mark', () => {
  const w = createWorld(40, 5, seeded(6))
  w.queue = []
  w.x = 30
  const doze = { do: 'pose', sit: true, eyes: 'closed', dur: 0.5 }
  perform(w, routineFrom({ name: 'doze', title: 'doze', steps: [doze, { do: 'mark', glyph: 'z' }, doze] }) as Routine)
  const seen: string[] = []
  for (let i = 0; i < 20; i++) {
    step(w)
    seen.push(`${w.sitting} ${w.eyes}`)
  }
  expect(seen.filter(s => s !== 'true closed')).toEqual([])
  expect(w.particles.some(p => p.glyph === 'z')).toBe(true)
})

test('the picker asks for a new act and plays it before it exists, Opus writes it, the band shows it, and the trace and debug keep the pick', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/t', CLAUDE_CLAWD_SEED: '7' })
  const blits: string[] = []
  const files = new Map<string, string>()
  const asked: string[] = []
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const logs: string[] = []
  on('ui.log', async ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('ui.blit', async ($, e) => {
    if ('cells' in e) blits.push(e.cells)
    return { value: {} }
  })
  on('process.run', async () => ({
    value: { exitCode: 0, stdout: 'Sat 17:00\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('fs.list', async ($, e) => ({
    value: [...files.keys()]
      .filter(p => p.startsWith(`${e.path}/`))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async ($, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', async ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('session.id', async () => ({ value: 'sess-1' }))
  on('model.complete', async ($, e) => {
    asked.push(e.model)
    const text =
      e.model === 'haiku'
        ? '{"summary": "Tests went green.", "calls": [{"who": "clawd", "play": "victory_lap", "delay": 0}], "why": "green tests", "new": {"name": "victory_lap", "title": "Victory lap after green tests", "for": "clawd"}}'
        : '{"steps": [{"do": "run", "to": 0.9}, {"do": "hop", "n": 2, "sparks": true}, {"do": "wave", "dur": 1}]}'
    return { value: { isAnswered: true as const, text, usage } }
  })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine band') as RenderElement
  })

  await $.session.start({ cwd: '/home/t/proj', surface: 'terminal', isInteractive: true })
  await $.ui.mount({
    plugin: 'clawd',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
    viewport: { columns: 100, rows: 40 },
  })
  await clock.advance(200)
  const run = (args: string) =>
    $.command.run({ command: 'clawd', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect((await run('trace'))?.text).toContain('/home/t/.claude/clawd/picks/sess-1.jsonl')
  const debugOn = (await run('debug'))?.text
  expect(debugOn).toMatch(/^Clawd: debug on\./)
  expect(debugOn).toContain('Autopick is off, so only /clawd autopick now picks')
  await run('autopick now')
  await clock.advance(200)

  expect(asked).toEqual(['haiku', 'opus'])
  const trace = [...files.entries()].find(([p]) => p.includes('/home/t/.claude/clawd/picks/'))?.[1] ?? ''
  const traced = JSON.parse(trace.trim().split('\n').pop() ?? '{}')
  expect(traced.trigger).toBe('asked with /clawd autopick now')
  expect(traced.system).toMatch(/^You direct Clawd/)
  expect(traced.prompt).toContain('<new_since_your_last_pick>')
  expect(traced.outcome).toBe('played nothing; new act victory_lap being written')
  const debug = logs.findIndex(l => l.startsWith('Clawd debug'))
  const shown = logs.slice(debug)
  expect(shown[0]).toBe('Clawd debug · autopick, asked with /clawd autopick now · haiku · 1 tokens in, 0 cache read, 0 cache write, 1 out')
  // The first pick shows the whole request, one row per line.
  expect(shown[1]).toMatch(/^context · all \d+ parts · /)
  expect(shown[2]).toBe(`new  │ system: ${traced.system}`)
  expect(shown.slice(3, -2).map(r => r.slice(7))).toEqual(traced.prompt.split('\n'))
  expect(shown.slice(-2)).toEqual([`reply: ${traced.reply}`, '→ played nothing; new act victory_lap being written'])
  expect((await run('debug'))?.text).toBe('Clawd: debug off.')
  expect((await run('trace'))?.text).toBe('Clawd: autopicks are no longer traced.')
  const path = [...files.keys()].find(p => p === '/home/t/.claude/clawd/acts/victory_lap.json')
  const saved = JSON.parse(files.get(path ?? '') ?? '{}')
  expect(saved.title).toBe('Victory lap after green tests')
  expect(saved.steps.length).toBe(3)
  expect(rows(blits[blits.length - 1] ?? '', 100)[0]).toMatch(/clawd: victory_lap \(new\) "Victory lap after green tests"$/)
  expect((await run(''))?.text).toContain('Last autopick (asked with /clawd autopick now')
})

test('debug shows each part of the request in full once, then leaves it out while it stays the same', async () => {
  const prompt = (summary: string, time: string) =>
    [`<session_summary>${summary}</session_summary>`, '<situation>', 'trigger: timer', `local time: ${time}`, '</situation>', '<acts>', 'wave: waves', '</acts>', '', 'Return {"calls": []}.'].join('\n')
  const parts = contextParts('You direct Clawd.', prompt('Tests ran.', 'Thu 10:00'))
  expect(parts.map(p => p.name)).toEqual(['system', 'session_summary', 'situation', 'acts', 'instructions'])
  const shown = new Map<string, string>()
  expect(contextRows(parts, shown)).toEqual([
    "context · all 5 parts · the CLI's identity block sent before the system prompt is not visible to a mod",
    'new  │ system: You direct Clawd.',
    'new  │ <session_summary>Tests ran.</session_summary>',
    'new  │ <situation>',
    'new  │ trigger: timer',
    'new  │ local time: Thu 10:00',
    'new  │ </situation>',
    'new  │ <acts>',
    'new  │ wave: waves',
    'new  │ </acts>',
    'new  │ ',
    'new  │ Return {"calls": []}.',
  ])
  // A minute later only the time changed: the situation is shown, its other lines marked same.
  expect(contextRows(contextParts('You direct Clawd.', prompt('Tests ran.', 'Thu 10:01')), shown)).toEqual([
    'context · shown: situation · left out, as shown before: system, session_summary, acts, instructions (110 chars)',
    'same │ <situation>',
    'same │ trigger: timer',
    'new  │ local time: Thu 10:01',
    'same │ </situation>',
  ])
  // A summary with a line break stays one part; a second run of loose lines gets a number.
  const odd = contextParts('', '<session_summary>a\nb</session_summary>\nloose\n<acts>\n</acts>\nend')
  expect(odd.map(p => [p.name, p.text])).toEqual([
    ['system', ''],
    ['session_summary', '<session_summary>a\nb</session_summary>'],
    ['instructions', 'loose'],
    ['acts', '<acts>\n</acts>'],
    ['instructions 2', 'end'],
  ])
})

test('a mini Clawd comes for a subagent, takes parallel calls with a delay, and leaves when it is done', async () => {
  const w = createWorld(100, 4, seeded(4))
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 20); i++) step(w)
  }
  run(2)
  const mini = spawnMini(w, 'agent-x', 'Find auth code', 'Explore')
  expect(mini?.id).toBe('a1')
  run(4) // it runs in and looks alert
  expect(mini?.x).toBeGreaterThan(0)

  // Its subagent's tool calls fetch bricks; Clawd's idle clock does not move.
  const before = w.lastEventAt
  onTool(w, false, 'agent-x')
  expect(mini?.queue.some(a => a.kind === 'carry')).toBe(true)
  expect(w.lastEventAt).toBe(before)
  run(10)
  expect(w.pile).toBe(1)

  // Clawd now and a1 a second later, like parallel tool calls with a delay.
  callActs(w, [{ who: 'clawd', what: 'wave', delay: 0 }, { who: 'a1', what: 'hop', delay: 1 }])
  step(w)
  expect(w.act?.kind).toBe('wave')
  const t0 = w.t
  let hopAt = -1
  for (let i = 0; i < 40 && hopAt < 0; i++) {
    step(w)
    if (mini?.act?.kind === 'hop') hopAt = w.t - t0
  }
  expect(hopAt).toBeGreaterThan(0.9)
  expect(hopAt).toBeLessThan(1.2)

  // 'all' reaches both; once its subagent is done the mini takes no calls and leaves.
  run(3)
  expect(callActs(w, [{ who: 'all', what: 'think', delay: 0 }])).toEqual(['clawd', 'a1'])
  endMini(w, 'agent-x', 'answer')
  expect(callActs(w, [{ who: 'a1', what: 'hop', delay: 0 }])).toEqual([])
  run(12)
  expect(w.minis.length).toBe(0)
})

test('a mini stops beside Clawd, not behind it, and is drawn in front of Clawd', async () => {
  const w = createWorld(100, 4, seeded(4))
  w.x = 100
  const reach = 6 + MINI_GAP // half of Clawd's 12 sub-pixels, plus the gap
  expect(besideClawd(w, 40)).toBe(40)
  expect(besideClawd(w, 95)).toBe(100 - reach)
  expect(besideClawd(w, 105)).toBe(100 + reach)
  w.x = 12 // no room on the left: the right side
  expect(besideClawd(w, 10)).toBe(12 + reach)

  // Every mini that runs in for a subagent stops clear of Clawd.
  for (let seed = 1; seed <= 20; seed++) {
    const v = createWorld(60, 4, seeded(seed))
    v.x = 50 // in mid-band, where the minis run to; a new world has Clawd walk in from the left
    const mini = spawnMini(v, 'agent-x', 'Find auth code', 'Explore')
    expect(Math.abs((mini?.queue[0]?.to ?? 0) - v.x)).toBeGreaterThanOrEqual(reach)
  }

  // Standing on Clawd's spot, a mini still shows.
  const u = createWorld(60, 4, seeded(4))
  const mini = spawnMini(u, 'agent-x', 'Find auth code', 'Explore')
  if (!mini) throw new Error('no mini')
  mini.queue = []
  u.x = 40
  mini.x = 40
  expect(colors(frameCells(u)).has(mini.color)).toBe(true)
})

test('a subagent gets a mini Clawd, and the picker calls Clawd and the mini in one pick, the mini a second later', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/t', CLAUDE_CLAWD_SEED: '9' })
  const blits: string[] = []
  const prompts: string[] = []
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('ui.log', async () => ({ value: undefined }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('ui.blit', async ($, e) => {
    if ('cells' in e) blits.push(e.cells)
    return { value: {} }
  })
  on('process.run', async () => ({
    value: { exitCode: 0, stdout: 'Sat 17:00\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('agent.spawn', async () => ({ model: 'haiku', agentId: 'agent-7' }))
  on('model.complete', async ($, e) => {
    prompts.push(e.prompt)
    const text =
      '{"summary": "A subagent searches.", "calls": [{"who": "clawd", "play": "wave", "delay": 0}, ' +
      '{"who": "a1", "play": "hop", "delay": 1}], "why": "greeting the helper", "new": null}'
    return { value: { isAnswered: true as const, text, usage } }
  })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine band') as RenderElement
  })

  await $.session.start({ cwd: '/home/t/proj', surface: 'terminal', isInteractive: true })
  await $.ui.mount({
    plugin: 'clawd',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
    viewport: { columns: 100, rows: 40 },
  })
  await clock.advance(200)
  const run = (args: string) =>
    $.command.run({ command: 'clawd', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  await run('autopick on')
  await $.agent.spawn({
    tool_use_id: 'toolu_1',
    prompt: 'Find the auth code.',
    description: 'Find auth code',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'opus',
    background: false,
    fork: false,
  })
  await clock.advance(300)

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('a1: a mini Clawd for the subagent "Find auth code" (Explore)')
  expect(rows(blits[blits.length - 1] ?? '', 100)[0]).toMatch(/clawd: wave · a1: hop$/)
  expect((await run(''))?.text).toContain('Minis: a1 "Find auth code" (Explore')
  expect((await run('a1 jump'))?.text).toBe('a1: jump.')
})

test('the band above the prompt holds Clawd, animated by blits, a row taller for a jump, and /clawd off removes it', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/t', CLAUDE_CLAWD_SEED: '7' })
  const blits: string[] = []
  const logs: string[] = []
  on('ui.log', async ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('tool.register', async ($, e) => ({ value: { tool: `mcp__clawd__${e.name}` } }))
  on('ui.blit', async ($, e) => {
    if ('cells' in e) blits.push(e.cells)
    return { value: {} }
  })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine band') as RenderElement
  })

  await $.session.start({ cwd: '/home/t/proj', surface: 'terminal', isInteractive: true })
  // Nothing here answers agent.register, so makes would run the rounds; that line goes to the debug log.
  expect(logs.filter(l => !l.startsWith('clawd: the maker agent was not registered'))).toEqual([
    'Clawd is on · /clawd help explains it · /clawd off hides it (remembered) · remove the mod: claude plugin disable clawd',
  ])
  const props = {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  }
  const band = await $.ui.mount({
    plugin: 'clawd',
    surface: 'terminal',
    component: 'AbovePrompt',
    props,
    viewport: { columns: 100, rows: 40 },
  })
  const raster = await band.find({ type: 'Raster', key: 'clawd' })
  expect(raster?.props.columns).toBe(100)
  expect(raster?.props.rows).toBe(4)
  expect(await band.find({ type: 'Text', text: 'engine band' })).toBeDefined()

  await clock.advance(2000) // Clawd walks in from the left
  expect(blits.length).toBeGreaterThan(5)
  expect(rows(blits[blits.length - 1] ?? '', 100).join('')).toContain('█')

  // A big jump makes the band a row taller, and it shrinks back after landing.
  const run = (args: string) =>
    $.command.run({ command: 'clawd', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  const mountRows = async () => {
    const m = await $.ui.mount({
      plugin: 'clawd',
      surface: 'terminal',
      component: 'AbovePrompt',
      props,
      viewport: { columns: 100, rows: 40 },
    })
    return (await m.find({ type: 'Raster', key: 'clawd' }))?.props.rows
  }
  await run('jump')
  await clock.advance(200)
  expect(await mountRows()).toBe(5)
  await clock.advance(3000)
  expect(await mountRows()).toBe(4)

  expect((await run('jump 9'))?.text).toBe('Clawd: jump ×5.')

  // However little room the engine gives, the band shows, cut off.
  const small = await $.ui.mount({
    plugin: 'clawd',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...props, maxRows: 2, bodyColumns: 8 },
    viewport: { columns: 8, rows: 40 },
  })
  const tiny = await small.find({ type: 'Raster', key: 'clawd' })
  expect([tiny?.props.columns, tiny?.props.rows]).toEqual([8, 2])
  const drawn = blits.length
  await clock.advance(2000)
  expect(blits.length).toBeGreaterThan(drawn)

  await run('off')
  const off = await $.ui.mount({
    plugin: 'clawd',
    surface: 'terminal',
    component: 'AbovePrompt',
    props,
    viewport: { columns: 100, rows: 40 },
  })
  expect(await off.find({ type: 'Raster', key: 'clawd' })).toBeUndefined()
})

test('a refused blit does not freeze Clawd: the band is drawn again and the blits go on', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/t', CLAUDE_CLAWD_SEED: '7' })
  // The band keeps one requestId, so a frame sent at the old height that
  // arrives after the band grew or shrank is refused under the current id.
  const blits: string[] = []
  let refuse = 0
  on('ui.log', async () => ({ value: undefined }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('ui.blit', async ($, e) => {
    if (refuse > 0) {
      refuse--
      return { value: { deny: 'another size' } }
    }
    if ('cells' in e) blits.push(e.cells)
    return { value: {} }
  })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine band') as RenderElement
  })

  await $.session.start({ cwd: '/home/t/proj', surface: 'terminal', isInteractive: true })
  await $.ui.mount({
    plugin: 'clawd',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
    viewport: { columns: 100, rows: 40 },
  })
  await clock.advance(300) // Clawd walks in from the left
  refuse = 1
  await clock.advance(100)
  expect(refuse).toBe(0)
  const before = blits.length
  await clock.advance(1500)
  expect(blits.length).toBeGreaterThan(before + 5)
})

// A small octopus, in the format of emotes/*.json.
const OCTOPUS = {
  name: 'octo',
  title: 'a blue octopus',
  color: '#649feb',
  shapes: { normal: ['..######..', '.#oo##oo#.', '##########'], squash: ['..########..', '############'] },
  legs: [1, 4, 8],
  legLength: 2,
  wiggle: true,
  armRow: 2,
  arms: { out: [[1, 1], [2, 1]] },
  tall: true,
  dur: 4,
}

// The foreground colours of the band's cells.
function colors(cells: string): Set<number> {
  const bytes = (Uint8Array as unknown as { fromBase64(s: string): Uint8Array }).fromBase64(cells)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Set<number>()
  for (let i = 0; i < bytes.byteLength / 12; i++) out.add(view.getUint32(i * 12 + 4, true))
  return out
}

test('an emote is checked, Clawd turns into it with a puff, keeps the tall band while in it, and turns back', async () => {
  expect(emoteFrom({ ...OCTOPUS, name: 'jump' })).toBe('jump is a built-in act')
  expect(emoteFrom({ ...OCTOPUS, color: 'blue' })).toBe('bad color "blue", want #rrggbb')
  expect(emoteFrom({ ...OCTOPUS, tall: false, legLength: 3, shapes: { normal: ['##', '##', '##', '##'] } })).toBe(
    'normal is 7 high with its legs, at most 6 (8 with "tall": true)',
  )
  const look = emoteFrom(OCTOPUS) as Emote
  expect(look.body?.shapes.stretch).toEqual(OCTOPUS.shapes.normal)
  expect(look.body?.armPoses.out).toEqual([[1, 1], [2, 1]])
  expect(look.body?.armPoses.up).toEqual([[1, -1], [2, -2]])
  // A forked pose, such as a pickaxe in the claw, keeps Clawd's.
  expect((emoteFrom({ ...OCTOPUS, arms: { out: [[1, 0], [2, 0], [2, -1], [2, 1]] } }) as Emote).body?.armPoses.out).toEqual([[1, 0], [2, 0]])

  const w = createWorld(40, 5, seeded(6))
  w.queue = []
  w.x = 30
  w.act = { kind: 'idle', t0: 0, stage: 0, dur: 99, next: 99, look: 0 }
  perform(w, look)
  let wore = -1
  for (let i = 0; i < 20 * 3 && wore < 0; i++) {
    step(w)
    if (w.wearing) wore = w.t
  }
  expect(wore).toBeGreaterThan(0)
  expect(w.particles.some(p => p.glyph === 'o')).toBe(true)
  expect(colors(frameCells(w)).has(0x649feb)).toBe(true)
  expect(colors(frameCells(w)).has(0xd77757)).toBe(false)
  // It shows itself off: a look around, a wave, two hops.
  expect(w.queue.map(a => a.kind)).toEqual(['idle', 'wave', 'hop'])
  for (let i = 0; i < 20 * 3; i++) step(w)
  expect(w.wearing?.name).toBe('octo')
  expect(w.tallUntil).toBeGreaterThan(w.t)
  for (let i = 0; i < 20 * 3 && w.wearing; i++) step(w)
  expect(w.wearing).toBe(null)
  step(w)
  expect(colors(frameCells(w)).has(0xd77757)).toBe(true)
})

test('a skin is Clawd\'s body from the start without a puff, an emote takes over for its time and the skin comes back, and a change of skin puffs', async () => {
  const skin = skinFrom(OCTOPUS) as Skin
  const frog = emoteFrom({ ...OCTOPUS, name: 'frog', color: '#40c060', dur: 2 }) as Emote
  const w = createWorld(40, 5, seeded(6))
  w.queue = []
  w.x = 30
  setSkin(w, skin, true)
  step(w)
  expect(w.wearing).toBe(null)
  expect(colors(frameCells(w)).has(0x649feb)).toBe(true)
  expect(colors(frameCells(w)).has(0xd77757)).toBe(false)
  expect(w.particles.some(p => p.glyph === 'o')).toBe(false)
  w.act = { kind: 'idle', t0: 0, stage: 0, dur: 99, next: 99, look: 0 }
  perform(w, frog)
  for (let i = 0; i < 20 * 3 && w.wearing?.name !== 'frog'; i++) step(w)
  expect(w.wearing?.name).toBe('frog')
  expect(colors(frameCells(w)).has(0x40c060)).toBe(true)
  expect(colors(frameCells(w)).has(0x649feb)).toBe(false)
  for (let i = 0; i < 20 * 10 && w.wearing; i++) step(w)
  expect(w.wearing).toBe(null)
  step(w)
  expect(colors(frameCells(w)).has(0x649feb)).toBe(true)
  expect(w.tallUntil).toBeGreaterThan(w.t)
  // The same skin read again from its file changes nothing; another skin, or none, puffs.
  w.particles = []
  setSkin(w, skinFrom(OCTOPUS) as Skin)
  expect(w.particles.length).toBe(0)
  setSkin(w, null)
  expect(w.particles.some(p => p.glyph === 'o')).toBe(true)
  step(w)
  expect(colors(frameCells(w)).has(0xd77757)).toBe(true)
  // An act's emote step may name a skin: Clawd wears it for a while.
  const glide = linkRoutine(routineFrom({ name: 'glide', title: 'glides', steps: [{ do: 'emote', name: 'octo' }, { do: 'hop' }] }) as Routine, n =>
    n === 'octo' ? skinAsEmote(skin) : undefined,
  )
  expect(glide.steps[0]?.worn?.name).toBe('octo')
  // A tall skin does not fit a 4-row band: the band asks to grow, and the skin
  // shows with its head cut off until it has (for good in a terminal too short
  // for it); Clawd's own body never shows.
  const low = createWorld(40, 4, seeded(6))
  low.queue = []
  low.x = 30
  setSkin(low, skin, true)
  step(low)
  expect(colors(frameCells(low)).has(0x649feb)).toBe(true)
  expect(colors(frameCells(low)).has(0xd77757)).toBe(false)
  expect(wantsTall(low)).toBe(true)
  expect(bandRows(low)).toBe(5)
  resize(low, 40, 5)
  step(low)
  expect(colors(frameCells(low)).has(0x649feb)).toBe(true)
})

test('without a clawd.json skin, the built-in folder rule gives Clawd the MatSci octopus skin in a matsci folder of any case, moving the root takes it off and puts it back, and /clawd skin chooses for the session', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/t', CLAUDE_CLAWD_SEED: '7' })
  const files = new Map([['/home/t/.claude/clawd/skins/matsci_octopus.json', JSON.stringify({ ...OCTOPUS, name: 'matsci_octopus' })]])
  on('fs.list', async ($, e) => ({
    value: [...files.keys()]
      .filter(p => p.startsWith(`${e.path}/`) && !p.slice(e.path.length + 1).includes('/'))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async ($, e) => ({ value: files.get(e.path) ?? '' }))
  let root = '/home/t/repos/MatSci/project'
  on('session.root', async () => ({ value: root }))
  const blits: string[] = []
  on('ui.log', async () => ({ value: undefined }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('ui.blit', async ($, e) => {
    if ('cells' in e) blits.push(e.cells)
    return { value: {} }
  })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine band') as RenderElement
  })
  const octopus = (from: number) => blits.slice(from).filter(c => colors(c).has(0x649feb)).length

  await $.session.start({ cwd: root, surface: 'terminal', isInteractive: true })
  await $.ui.mount({
    plugin: 'clawd',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
    viewport: { columns: 100, rows: 40 },
  })
  await clock.advance(2000)
  expect(octopus(0)).toBeGreaterThan(5)

  root = '/home/t/proj' // /cd out of MatSci: the octopus puffs back into Clawd
  await clock.advance(3000)
  const out = blits.length
  await clock.advance(2000)
  expect(blits.length).toBeGreaterThan(out)
  expect(octopus(out)).toBe(0)

  root = '/home/t/notes/matsci'
  await clock.advance(3000)
  expect(octopus(out)).toBeGreaterThan(5)

  // /clawd skin none keeps Clawd's own body for the session, also when the root moves; auto goes back.
  const run = (args: string) =>
    $.command.run({ command: 'clawd', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect((await run('skin'))?.text).toMatch(/^Skin: matsci_octopus \("a blue octopus"\); the project folder matches "matsci" \(flags "i", built in\)\./)
  expect((await run('skin none'))?.text).toBe("Clawd: Skin: none, Clawd's own body; chosen with /clawd skin for this session. /clawd skin auto goes back.")
  root = '/home/t/notes/matsci/sub'
  await clock.advance(3000)
  const none = blits.length
  await clock.advance(2000)
  expect(octopus(none)).toBe(0)
  expect((await run('skin auto'))?.text).toMatch(/^Clawd: Skin: matsci_octopus/)
  await clock.advance(3000)
  expect(octopus(none)).toBeGreaterThan(5)
  expect((await run('list skins'))?.text).toContain('matsci_octopus  a blue octopus')
  expect((await run('emote matsci_octopus'))?.text).toMatch(/^Clawd: nothing is called "matsci_octopus"/)
})

test('folder-skins.json rules come before the built-in one, a rule that is no regular expression is skipped, "none" keeps Clawd, and a hidden skin is worn but never listed', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/t', CLAUDE_CLAWD_SEED: '7' })
  const files = new Map([
    ['/home/t/.claude/clawd/skins/matsci_octopus.json', JSON.stringify({ ...OCTOPUS, name: 'matsci_octopus', hidden: true })],
    ['/home/t/.claude/clawd/skins/reef.json', JSON.stringify({ ...OCTOPUS, name: 'reef', title: 'a reef octopus' })],
    [
      '/home/t/.claude/clawd/folder-skins.json',
      JSON.stringify([
        { match: '(', skin: 'reef' },
        { match: '/ocean/', skin: 'reef' },
        { match: 'MatSci/quiet', skin: 'none' },
      ]),
    ],
  ])
  on('fs.list', async ($, e) => ({
    value: [...files.keys()]
      .filter(p => p.startsWith(`${e.path}/`) && !p.slice(e.path.length + 1).includes('/'))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async ($, e) => ({ value: files.get(e.path) ?? '' }))
  let root = '/home/t/ocean/proj'
  on('session.root', async () => ({ value: root }))
  const logs: string[] = []
  on('ui.log', async ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  const run = (args: string) =>
    $.command.run({ command: 'clawd', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

  await $.session.start({ cwd: root, surface: 'terminal', isInteractive: true })
  expect((await run('skin'))?.text).toMatch(/^Skin: reef \("a reef octopus"\); the project folder matches "\/ocean\/" \(folder-skins\.json\)\./)
  expect(logs.some(l => l.includes('"(" is not a regular expression'))).toBe(true)

  root = '/home/t/MatSci/quiet'
  await clock.advance(2000)
  expect((await run('skin'))?.text).toMatch(/^Skin: none, Clawd's own body; the project folder matches "MatSci\/quiet" \(folder-skins\.json\)\./)

  root = '/home/t/MATSCI/loud'
  await clock.advance(2000)
  expect((await run('skin'))?.text).toMatch(/^Skin: matsci_octopus \("a blue octopus"\); the project folder matches "matsci" \(flags "i", built in\)\./)
  const listed = (await run('list skins'))?.text ?? ''
  expect(listed).toContain('reef  a reef octopus')
  expect(listed).not.toContain('matsci_octopus')
  expect((await run('skin matsci_octopus'))?.text).toBe('Clawd: nothing is called "matsci_octopus". /clawd list skins shows what there is.')

  // An edit of the file waits for the next root move or /clawd skin auto, so /clawd skin names the skin worn.
  files.set('/home/t/.claude/clawd/folder-skins.json', JSON.stringify([{ match: 'MatSci', skin: 'none' }, { match: 'matsci/', flags: 'i', skin: 'reef' }]))
  expect((await run('skin'))?.text).toMatch(/^Skin: matsci_octopus \("a blue octopus"\); the project folder matches "matsci" \(flags "i", built in\)\./)
  expect((await run('skin auto'))?.text).toMatch(/^Clawd: Skin: reef \("a reef octopus"\); the project folder matches "matsci\/" \(flags "i", folder-skins\.json\)\./)
})

test("with a clawd.json skin Clawd has no body of its own: the tall skin shows from the first frame in a band too short for it, and /clawd skin has no none", async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/t', CLAUDE_CLAWD_SEED: '7' })
  const files = new Map([['/home/t/.claude/clawd/skins/matsci_octopus.json', JSON.stringify({ ...OCTOPUS, name: 'matsci_octopus' })]])
  on('fs.list', async ($, e) => ({
    value: [...files.keys()]
      .filter(p => p.startsWith(`${e.path}/`) && !p.slice(e.path.length + 1).includes('/'))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async ($, e) => ({ value: e.path.endsWith('/clawd.json') ? JSON.stringify({ skin: 'matsci_octopus' }) : (files.get(e.path) ?? '') }))
  on('session.root', async () => ({ value: '/home/t/proj' }))
  const blits: string[] = []
  on('ui.log', async () => ({ value: undefined }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('ui.blit', async ($, e) => {
    if ('cells' in e) blits.push(e.cells)
    return { value: {} }
  })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine band') as RenderElement
  })

  await $.session.start({ cwd: '/home/t/proj', surface: 'terminal', isInteractive: true })
  await $.ui.mount({
    plugin: 'clawd',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} },
    viewport: { columns: 100, rows: 40 },
  })
  await clock.advance(2000)
  expect(blits.filter(c => colors(c).has(0x649feb)).length).toBeGreaterThan(5)
  expect(blits.filter(c => colors(c).has(0xd77757)).length).toBe(0)

  const run = (args: string) =>
    $.command.run({ command: 'clawd', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect((await run('skin'))?.text).toBe(
    `Skin: matsci_octopus ("a blue octopus"); named in the mod's clawd.json. /clawd skin <skin> wears another for this session, auto the one clawd.json names; /clawd list skins names them.`,
  )
  expect((await run('skin none'))?.text).toMatch(/^Clawd: nothing is called "none"/)
  expect((await run('help'))?.text).not.toContain('/clawd skin none')
})

test('the autopicker calls no model until /clawd autopick switches it on, picks on its timer once on, and stops when switched off', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/t', CLAUDE_CLAWD_SEED: '7' })
  const triggers: string[] = []
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('ui.log', async () => ({ value: undefined }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('ui.blit', async () => ({ value: {} }))
  on('process.run', async () => ({
    value: { exitCode: 0, stdout: 'Sat 17:00\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('model.complete', async ($, e) => {
    triggers.push(/trigger: ([^\n]*)/.exec(e.prompt)?.[1] ?? e.prompt.slice(0, 40))
    const text = '{"summary": "", "calls": [{"who": "clawd", "play": "wave"}], "why": "", "new": null}'
    return { value: { isAnswered: true as const, text, usage } }
  })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine band') as RenderElement
  })

  await $.session.start({ cwd: '/home/t/proj', surface: 'terminal', isInteractive: true })
  const run = (args: string) =>
    $.command.run({ command: 'clawd', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  // 61 s: a pick comes within PICK_MAX_S. Each 50 ms band tick costs about a
  // millisecond, so the minutes here run past the default 5 s on a loaded
  // machine; the band, which a pick needs, is mounted from the second phase on.
  await clock.advance(61_000)
  expect(triggers).toEqual([])
  expect((await run(''))?.text).toContain('The autopicker is off, so Clawd plays random acts')
  expect((await run('autopick o'))?.text).toBe('Clawd: /clawd autopick takes now, on, off, haiku, sonnet, opus or nothing.')

  await $.ui.mount({
    plugin: 'clawd',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 40, scroll: { offset: 0, bodyRows: 20 }, view: {} },
    viewport: { columns: 100, rows: 40 },
  })
  expect((await run('autopick'))?.text).toContain('the autopicker is on (remembered)')
  await clock.advance(61_000)
  expect(triggers.length).toBeGreaterThan(0)
  expect((await run('autopick'))?.text).toContain('the autopicker is off (remembered)')
  expect((await run('autopick of'))?.text).toContain('the autopicker is off (remembered)')
  const picked = triggers.length
  await clock.advance(61_000)
  expect(triggers.length).toBe(picked)
  // Asked for, it picks once while off.
  await run('autopick now')
  await clock.advance(200)
  expect(triggers.length).toBe(picked + 1)
})

test('the autopicker asks haiku until /clawd autopick sonnet or opus switches the model, which leaves it off', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/t', CLAUDE_CLAWD_SEED: '7' })
  const models: string[] = []
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('ui.log', async () => ({ value: undefined }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('ui.blit', async () => ({ value: {} }))
  on('process.run', async () => ({
    value: { exitCode: 0, stdout: 'Sat 17:00\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('model.complete', async ($, e) => {
    models.push(e.model)
    const text = '{"summary": "", "calls": [{"who": "clawd", "play": "wave"}], "why": "", "new": null}'
    return { value: { isAnswered: true as const, text, usage } }
  })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine band') as RenderElement
  })

  await $.session.start({ cwd: '/home/t/proj', surface: 'terminal', isInteractive: true })
  await $.ui.mount({
    plugin: 'clawd',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 40, scroll: { offset: 0, bodyRows: 20 }, view: {} },
    viewport: { columns: 100, rows: 40 },
  })
  await clock.advance(200)
  const run = (args: string) =>
    $.command.run({ command: 'clawd', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  const pickOnce = async () => {
    await run('autopick now')
    await clock.advance(200)
  }
  expect((await run(''))?.text).toContain('Picker model: haiku.')
  await pickOnce()
  expect(models).toEqual(['haiku'])
  expect((await run('autopick sonnet'))?.text).toBe(
    'Clawd: the autopicker uses sonnet (remembered). Each pick costs more of your Claude usage than with haiku. The autopicker is off; /clawd autopick turns it on.',
  )
  await pickOnce()
  expect((await run('autopick op'))?.text).toMatch(/^Clawd: the autopicker uses opus \(remembered\)\./)
  await pickOnce()
  expect(models).toEqual(['haiku', 'sonnet', 'opus'])
  expect((await run('autopick on'))?.text).toContain('opus picks what plays')
  expect((await run('autopick haiku'))?.text).toBe('Clawd: the autopicker uses haiku (remembered).')
  expect((await run(''))?.text).toContain('Picker model: haiku.')
})

test('an emote preview is a PNG of the band in every pose, and a drafts sheet has a numbered line per draft', async () => {
  const png = emotePreview(emoteFrom(OCTOPUS) as Emote)
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  // 18 panels, 6 per line, each 14 cells of 10 x 20 pixels and 5 rows, 4 pixels apart.
  expect([view.getUint32(16), view.getUint32(20)]).toEqual([6 * 144 + 4, 3 * 104 + 4])
  // Three drafts in 5 poses each, after a margin of 20 pixels for the numbers.
  const sheet = emoteSheet([OCTOPUS, { ...OCTOPUS, color: '#40c060' }, { ...OCTOPUS, wiggle: false }].map(o => emoteFrom(o) as Emote))
  const head = new DataView(sheet.buffer, sheet.byteOffset, sheet.byteLength)
  expect([head.getUint32(16), head.getUint32(20)]).toEqual([20 + 5 * 144 + 4, 3 * 104 + 4])
  // A look with a prop gets a fourth line, the prop along its path.
  const withProp = emotePreview(emoteFrom(ROCKET) as Emote)
  const propHead = new DataView(withProp.buffer, withProp.byteOffset, withProp.byteLength)
  expect([propHead.getUint32(16), propHead.getUint32(20)]).toEqual([6 * 144 + 4, 4 * 104 + 4])

  // A look that keeps the body, on a skin: its 3 lines on the skin, then 3 on Clawd's own body.
  // An 18-wide skin, as wide as the MatSci octopus, with a 6-wide pointer needs 16 cells a
  // panel: 11 sub-pixels back, 11 + 2 + 6 forward, plus one cell.
  const size = (png: Uint8Array) => {
    const v = new DataView(png.buffer, png.byteOffset, png.byteLength)
    return [v.getUint32(16), v.getUint32(20)]
  }
  const pointer = emoteFrom({ name: 'pointer', title: 'taps a chart', tool: { rows: ['######'], color: '#8b5a2b' } }) as Emote
  const octopus = skinFrom({ ...OCTOPUS, shapes: { normal: ['#'.repeat(18), `##o${'#'.repeat(12)}o##`, '#'.repeat(18)] }, legs: [1, 8, 16] }) as Skin
  expect(size(emotePreview(pointer, octopus))).toEqual([6 * 164 + 4, 6 * 104 + 4])
  expect(size(emotePreview(pointer))).toEqual([6 * 144 + 4, 3 * 104 + 4])
  // A look with a body shows once, on its own body.
  expect(size(emotePreview(emoteFrom(OCTOPUS) as Emote, octopus))).toEqual([6 * 144 + 4, 3 * 104 + 4])
  // In a drafts sheet, a draft that keeps the body gets its poses on Clawd's own body to the right.
  expect(size(emoteSheet([pointer, emoteFrom(OCTOPUS) as Emote], octopus))).toEqual([20 + 10 * 164 + 4, 2 * 104 + 4])
  expect(size(emoteSheet([pointer]))).toEqual([20 + 5 * 144 + 4, 104 + 4])
  // With a clawd.json skin Clawd has no body of its own: the look shows on the skin only.
  expect(size(emotePreview(pointer, octopus, true))).toEqual([6 * 164 + 4, 3 * 104 + 4])
  expect(size(emoteSheet([pointer, emoteFrom(OCTOPUS) as Emote], octopus, true))).toEqual([20 + 5 * 164 + 4, 2 * 104 + 4])
})

test('a wiggly look crawls in a ripple, one tip lifted at a time and the body level, walking and running', async () => {
  const look = emoteFrom(OCTOPUS) as Emote
  const frame = (vx: number, strides: number): string[] => {
    const w = createWorld(14, 5, seeded(1))
    w.queue = []
    Object.assign(w, { x: 14, t: 5, blinkAt: 999, wearing: look, wornAt: 5, wornUntil: Infinity, vx, strides })
    return rows(frameCells(w), 14)
  }
  const top = (band: string[]) => band.findIndex(line => line.trim() !== '')
  // Each third of a stride lifts another of the three legs, then it repeats.
  const thirds = [0, 1 / 3, 2 / 3].map(d => frame(WALK, d).join('\n'))
  expect(new Set(thirds).size).toBe(3)
  expect(frame(WALK, 1).join('\n')).toBe(thirds[0])
  // The body does not bob: it stands where it stands still.
  for (const d of [0, 0.25, 0.5, 0.75]) expect(top(frame(WALK, d))).toBe(top(frame(0, 0)))
  // Running, it ripples the same way.
  const running = [0, 1 / 3, 2 / 3].map(d => frame(WALK * 3, d).join('\n'))
  expect(new Set(running).size).toBe(3)
  expect(frame(WALK * 3, 1).join('\n')).toBe(running[0])
  // A stride is 8 sub-pixels walking and 16 running.
  for (const [act, length] of [['wander', 8], ['run', 16]] as const) {
    const w = createWorld(80, 5, seeded(1))
    w.x = 10
    perform(w, act)
    for (let i = 0; i < 20; i++) step(w)
    expect(Math.round(w.walked / w.strides)).toBe(length)
  }
})

// The octopus beside a rocket that lifts off at 2 s and leaves the band by 3 s.
const ROCKET = {
  ...OCTOPUS,
  tall: false,
  dur: 5,
  prop: { rows: ['.##.', '####', '#..#'], color: '#123456', x: -10, path: [{ t: 0, y: 0 }, { t: 2, y: 0 }, { t: 3, y: 20 }], trail: true },
}

// The cells, as `column,row`, that show a colour in front or behind.
function cellsWith(cells: string, columns: number, color: number): string[] {
  const bytes = (Uint8Array as unknown as { fromBase64(s: string): Uint8Array }).fromBase64(cells)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: string[] = []
  for (let i = 0; i < bytes.byteLength / 12; i++) {
    if (view.getUint32(i * 12 + 4, true) === color || view.getUint32(i * 12 + 8, true) === color) out.push(`${i % columns},${Math.floor(i / columns)}`)
  }
  return out
}

test("an emote's prop is checked and written back", async () => {
  const look = emoteFrom(ROCKET) as Emote
  expect(look.prop).toEqual({
    rows: ['.##.', '####', '#..#'],
    color: 0x123456,
    x: -10,
    path: [{ t: 0, x: 0, y: 0 }, { t: 2, x: 0, y: 0 }, { t: 3, x: 0, y: 20 }],
    hasTrail: true,
  })
  expect(emoteJson(look).prop).toEqual({ ...ROCKET.prop, path: look.prop?.path })
  expect(emoteFrom(emoteJson(look))).toEqual(look)
  expect((emoteFrom(OCTOPUS) as Emote).prop).toBe(null)
  expect(emoteFrom({ ...ROCKET, prop: { ...ROCKET.prop, rows: Array(7).fill('##') } })).toBe('prop: rows are 7 high, at most 6')
  expect(emoteFrom({ ...ROCKET, prop: { ...ROCKET.prop, path: [{ t: 2, y: 0 }, { t: 1, y: 5 }] } })).toBe('prop: path keys are not in time order')
  expect(emoteFrom({ ...ROCKET, prop: { ...ROCKET.prop, path: [{ t: 0, y: 0 }, { t: 6, y: 5 }] } })).toBe('prop: path t 6 is outside 0 to dur (5)')
})

test('a prop starts behind Clawd, stays put while Clawd turns and moves, flies off the band, and on the floor breaks apart with the look', async () => {
  const w = createWorld(40, 4, seeded(6))
  w.queue = []
  w.x = 40
  w.act = { kind: 'idle', t0: 0, stage: 0, dur: 99, next: 99, look: 0 }
  perform(w, emoteFrom(ROCKET) as Emote)
  for (let i = 0; i < 20 * 3 && !w.wearing; i++) step(w)
  const at = cellsWith(frameCells(w), 40, 0x123456)
  expect(at.length).toBeGreaterThan(0)
  // Facing right, behind is left of Clawd's cells.
  expect(at.every(cell => Number(cell.split(',')[0]) < w.x / 2 - 3)).toBe(true)
  w.facing = -1
  w.x += 10
  expect(cellsWith(frameCells(w), 40, 0x123456)).toEqual(at)
  // Past its last key the prop is above the band, while Clawd still wears the look.
  for (let i = 0; i < 20 * 4 && w.t - w.wornAt < 3.1; i++) step(w)
  expect(w.wearing?.name).toBe('octo')
  expect(colors(frameCells(w)).has(0x123456)).toBe(false)

  // A prop that never leaves the floor breaks into its own pixels with the look, accent ones included.
  const v = createWorld(40, 4, seeded(6))
  v.queue = []
  v.x = 40
  v.act = { kind: 'idle', t0: 0, stage: 0, dur: 99, next: 99, look: 0 }
  perform(v, emoteFrom({ ...ROCKET, accent: '#abcdef', prop: { ...ROCKET.prop, rows: ['.++.', '####', '#..#'], path: [{ t: 0, y: 0 }] } }) as Emote)
  for (let i = 0; i < 20 * 3 && !v.wearing; i++) step(v)
  expect(colors(frameCells(v)).has(0x123456)).toBe(true)
  for (let i = 0; i < 20 * 8 && v.wearing; i++) step(v)
  expect(v.wearing).toBe(null)
  const pieces = v.particles.filter(p => p.color === 0x123456 || p.color === 0xabcdef)
  expect(new Set(pieces.map(p => p.color))).toEqual(new Set([0x123456, 0xabcdef]))
  expect(pieces.every(p => '▘▝▖▗'.includes(p.glyph))).toBe(true)
  for (let i = 0; i < 20; i++) step(v)
  expect(cellsWith(frameCells(v), 40, 0x123456)).toEqual([])
})

test("an emote's tool is checked, written back, held past the front hand as Clawd faces, and put away to read", async () => {
  const POINTER = { ...OCTOPUS, tall: false, dur: 5, tool: { rows: ['...+', '###.'], color: '#8b5a2b' } }
  const look = emoteFrom(POINTER) as Emote
  expect(look.tool).toEqual({ rows: ['...+', '###.'], color: 0x8b5a2b })
  expect(emoteJson(look).tool).toEqual(POINTER.tool)
  expect(emoteFrom(emoteJson(look))).toEqual(look)
  expect((emoteFrom(OCTOPUS) as Emote).tool).toBe(null)
  expect(emoteFrom({ ...POINTER, tool: { rows: Array(5).fill('#') } })).toBe('tool: rows are 5 high, at most 4')
  expect(emoteFrom({ ...POINTER, tool: { rows: ['#'], color: 'brown' } })).toBe('tool: bad color "brown", want #rrggbb')

  const w = createWorld(40, 4, seeded(6))
  w.queue = []
  w.x = 40
  w.act = { kind: 'idle', t0: 0, stage: 0, dur: 99, next: 99, look: 0 }
  perform(w, look)
  for (let i = 0; i < 20 * 3 && !w.wearing; i++) step(w)
  Object.assign(w, { vx: 0, blinkAt: 999 })
  const columns = (cells: string[]) => cells.map(cell => Number(cell.split(',')[0]))
  const ahead = columns(cellsWith(frameCells(w), 40, 0x8b5a2b))
  expect(ahead.length).toBeGreaterThan(0)
  expect(ahead.every(col => col > w.x / 2)).toBe(true)
  w.facing = -1
  expect(columns(cellsWith(frameCells(w), 40, 0x8b5a2b)).every(col => col < w.x / 2)).toBe(true)
  w.reading = true
  expect(cellsWith(frameCells(w), 40, 0x8b5a2b)).toEqual([])
})

test('an emote without shapes keeps the body Clawd has, its own or its skin, and adds its tool and prop; a pick that calls more for Clawd skips the show-off', async () => {
  const POINTER = {
    name: 'pointer',
    title: 'taps a chart with a pointer',
    dur: 5,
    tool: { rows: ['...+', '###.'], color: '#8b5a2b' },
    prop: { rows: ['####', '#..#', '####'], color: '#3a7bd5', x: 12, path: [{ t: 0, y: 0 }] },
  }
  expect(emoteFrom({ name: 'nothing', title: 'nothing at all', dur: 4 })).toBe('no shapes, prop or tool: an emote changes the body, adds a thing, or both')
  const look = emoteFrom(POINTER) as Emote
  expect(look.body).toBe(null)
  expect(emoteFrom(emoteJson(look))).toEqual(look)
  const columns = (cells: string[]) => cells.map(cell => Number(cell.split(',')[0]))
  const idle = { kind: 'idle' as const, t0: 0, stage: 0, dur: 99, next: 99, look: 0 as const }

  // On Clawd's own body: it stays orange and holds the pointer past its front hand.
  const w = createWorld(40, 4, seeded(6))
  w.queue = []
  w.x = 40
  w.act = { ...idle }
  perform(w, look)
  for (let i = 0; i < 20 * 3 && !w.wearing; i++) step(w)
  for (let i = 0; i < 10; i++) step(w) // out of the squash it puts the look on in
  // The puff takes the tool's colour; it goes before the pixels are read.
  Object.assign(w, { vx: 0, blinkAt: 999, particles: [] })
  const own = colors(frameCells(w))
  expect([own.has(0xd77757), own.has(0x8b5a2b), own.has(0x3a7bd5)]).toEqual([true, true, true])
  const ahead = columns(cellsWith(frameCells(w), 40, 0x8b5a2b))
  expect(ahead.length).toBeGreaterThan(0)
  expect(ahead.every(col => col > w.x / 2 + 2)).toBe(true)

  // On the octopus skin: the body stays the blue octopus, with the pointer and the chart.
  const o = createWorld(40, 5, seeded(6))
  o.queue = []
  o.x = 40
  setSkin(o, skinFrom(OCTOPUS) as Skin, true)
  o.act = { ...idle }
  perform(o, look)
  for (let i = 0; i < 20 * 3 && !o.wearing; i++) step(o)
  for (let i = 0; i < 10; i++) step(o)
  Object.assign(o, { vx: 0, blinkAt: 999, particles: [] })
  const skinned = colors(frameCells(o))
  expect([skinned.has(0x649feb), skinned.has(0xd77757), skinned.has(0x8b5a2b), skinned.has(0x3a7bd5)]).toEqual([true, false, true, true])

  // A skin without arms holds the pointer against its front edge.
  const a = createWorld(40, 5, seeded(6))
  a.queue = []
  a.x = 40
  setSkin(a, skinFrom({ ...OCTOPUS, armRow: null }) as Skin, true)
  a.act = { ...idle }
  perform(a, look)
  for (let i = 0; i < 20 * 3 && !a.wearing; i++) step(a)
  for (let i = 0; i < 10; i++) step(a)
  Object.assign(a, { vx: 0, blinkAt: 999, particles: [] })
  expect(colors(frameCells(a)).has(0x8b5a2b)).toBe(true)

  // Called alone it shows itself off; with a run after it in the same pick, the run plays in it at once.
  const p = createWorld(40, 4, seeded(6))
  p.queue = []
  p.x = 20
  callActs(p, [{ who: 'clawd', what: look, delay: 0 }, { who: 'clawd', what: 'run', delay: 0 }])
  for (let i = 0; i < 20 * 3 && !p.wearing; i++) step(p)
  expect(p.wearing?.name).toBe('pointer')
  expect(p.queue.map(a => a.kind)).toEqual(['run'])
  const q = createWorld(40, 4, seeded(6))
  q.queue = []
  q.x = 20
  callActs(q, [{ who: 'clawd', what: look, delay: 0 }])
  for (let i = 0; i < 20 * 3 && !q.wearing; i++) step(q)
  expect(q.queue.map(a => a.kind)).toEqual(['idle', 'wave', 'hop'])
})

// Haiku naming the words after create: the first word and the rest, as it does for
// "frog a green frog"; a cat in a hat gets a name of its own, and a mystery none.
function naming(prompt: string): string {
  const said = /then these words: (.*)/.exec(prompt)?.[1] ?? ''
  if (said === 'a cat in a hat') return '{"name": "cat_in_a_hat", "title": "a cat in a hat"}'
  if (said === 'mystery blob thing') return 'no idea'
  const [name, ...rest] = said.split(' ')
  return JSON.stringify({ name, title: rest.join(' ') })
}

test('/clawd emote create has a model draw three drafts after a local image, pick one from their sheet, check its preview, and it plays', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/t', CLAUDE_CLAWD_SEED: '7' })
  const files = new Map<string, string>()
  const pngs: string[] = []
  const rounds: { argv: readonly string[]; stdin: string }[] = []
  const named: string[] = []
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('model.complete', async ($, e) => {
    named.push(e.prompt)
    return { value: { isAnswered: true as const, text: naming(e.prompt), usage } }
  })
  on('ui.log', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('ui.blit', async () => ({ value: {} }))
  on('process.run', async ($, e) => {
    const done = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'python3') {
      pngs.push(e.argv[3] ?? '')
      return done('')
    }
    if (e.argv[0] === 'mv') {
      const [, , from = '', to = ''] = e.argv
      files.set(to, files.get(from) ?? '')
      files.delete(from)
      return done('')
    }
    if (e.argv[0] !== 'claude') return done('Sat 17:00\n')
    rounds.push({ argv: e.argv, stdin: e.init?.stdin ?? '' })
    // Round one draws three drafts, one unusable. Round two picks the first and
    // says done, which does not count before it has seen the pick's preview;
    // round three keeps it. A change (rounds four and five) makes it blue. A
    // redraw (rounds six and seven) draws one draft and keeps it.
    const drafts = [{ ...OCTOPUS, name: 'whatever' }, { ...OCTOPUS, color: '#40c060' }, { ...OCTOPUS, color: 'blue' }]
    if (rounds.length === 1) return done(`Here they are: ${JSON.stringify({ drafts })}`)
    if (rounds.length === 2) return done(JSON.stringify({ ...OCTOPUS, pick: 1, done: true }))
    if (rounds.length === 4) return done(JSON.stringify({ ...OCTOPUS, color: '#3060ff' }))
    if (rounds.length === 5) return done(JSON.stringify({ ...OCTOPUS, color: '#3060ff', done: true }))
    return done(JSON.stringify({ ...OCTOPUS, done: true }))
  })
  on('fs.stat', async ($, e) => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('fs.list', async ($, e) => ({
    value: [...files.keys()]
      .filter(p => p.startsWith(`${e.path}/`) && !p.slice(e.path.length + 1).includes('/'))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async ($, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', async ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine band') as RenderElement
  })

  await $.session.start({ cwd: '/home/t/proj', surface: 'terminal', isInteractive: true })
  await $.ui.mount({
    plugin: 'clawd',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
    viewport: { columns: 100, rows: 40 },
  })
  await clock.advance(200)
  const run = (args: string) =>
    $.command.run({ command: 'clawd', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  // An emote made before, which the drafts of a new one are told about.
  files.set('/home/t/.claude/clawd/emotes/yak.json', JSON.stringify({ ...OCTOPUS, name: 'yak', title: 'a shaggy yak' }))
  expect((await run('emote create jump a frog'))?.text).toContain('jump is taken')
  expect((await run('emote create'))?.text).toContain('Usage: /clawd emote create <name> [image path] [what it looks like]')
  expect((await run('create frog a frog'))?.text).toBe('Clawd: create what? /clawd act create, /clawd emote create or /clawd skin create.')
  expect((await run('emote create octo ~/pics/octo.png a blue octopus'))?.text).toContain('draws octo after /home/t/pics/octo.png')
  await clock.advance(200)

  expect(rounds.length).toBe(3)
  // Without a data/ folder beside the plugin, the files go to clawd/ in the Claude config folder.
  const data = '/home/t/.claude/clawd'
  expect(pngs[0]).toBe(`${data}/emotes/previews/octo.drafts.png`)
  // Each round may read the image and the newest preview, and nothing else.
  expect(rounds[0]?.argv).toContain('Read(//home/t/pics/octo.png)')
  expect(rounds[0]?.argv.filter(a => a.startsWith('Read('))).toHaveLength(1)
  expect(rounds[0]?.argv).toContain('dontAsk')
  expect(rounds[0]?.stdin).toContain('{"drafts": [draft 1, draft 2, draft 3]}')
  expect(rounds[0]?.stdin).toContain('Clawd has these other emotes. Draw the new one so that it cannot be taken for any of them:\n- yak: Clawd turns into a shaggy yak\n')
  // Round two sees the two usable drafts on one sheet and picks one.
  expect(rounds[1]?.argv.filter(a => a.startsWith('Read('))).toHaveLength(2)
  expect(rounds[1]?.stdin).toContain(`Their sheet is ${data}/emotes/previews/octo.drafts.png`)
  expect(rounds[1]?.stdin).toContain('2. {"name":"octo","title":"a blue octopus","color":"#40c060"')
  expect(rounds[1]?.stdin).not.toContain('3. {"name"')
  expect(rounds[2]?.stdin).toContain(`Its preview is ${data}/emotes/previews/octo.draft2.png`)
  expect(pngs).toContain(`${data}/emotes/previews/octo.png`)
  const saved = JSON.parse(files.get(`${data}/emotes/octo.json`) ?? '{}')
  expect([saved.name, saved.title, saved.image]).toEqual(['octo', 'a blue octopus', '/home/t/pics/octo.png'])

  expect((await run('list emotes'))?.text).toMatch(/^  octo  a blue octopus$/m)
  expect((await run('emote oc'))?.text).toBe('Clawd: octo.')
  expect((await run('octo'))?.text).toBe('Clawd: octo.')
  expect((await run('emote preview octo'))?.text).toContain(`${data}/emotes/previews/octo.png`)

  // /clawd emote change (or edit, or modify): the model starts from the look as it is, and the old file is kept.
  const octoFile = `${data}/emotes/octo.json`
  const before = files.get(octoFile)
  expect((await run('emote change oc blue'))?.text).toBe("Clawd: type the emote's full name: /clawd emote change octo.")
  expect((await run('emote edit octo make it blue'))?.text).toContain('a model changes octo: "make it blue"')
  await clock.advance(200)
  expect(rounds.length).toBe(5)
  expect(rounds[3]?.stdin).toContain('The change asked for now: "make it blue"')
  expect(rounds[3]?.stdin).toContain(`The look as it is now: {"name":"octo"`)
  expect(rounds[3]?.stdin).toContain(`${data}/emotes/previews/octo.before.png`)
  expect(rounds[3]?.stdin).not.toContain('"drafts"')
  expect(rounds[3]?.argv).toContain('Read(//home/t/pics/octo.png)')
  const changed = JSON.parse(files.get(octoFile) ?? '{}')
  expect([changed.color, changed.change, changed.image]).toEqual(['#3060ff', 'make it blue', '/home/t/pics/octo.png'])
  const kept = [...files.keys()].filter(p => p.startsWith(`${data}/emotes/old/octo.`))
  expect(kept).toHaveLength(1)
  expect(files.get(kept[0] ?? '')).toBe(before)

  // /clawd emote change with nothing to change draws the emote again from scratch, into the same file.
  const blue = files.get(octoFile)
  expect((await run('emote edit octo'))?.text).toContain('a model draws octo again from scratch after "a blue octopus"')
  await clock.advance(200)
  expect(rounds.length).toBe(7)
  expect(rounds[5]?.stdin).toContain('"drafts"')
  expect(rounds[5]?.stdin).toContain('- yak: ')
  expect(rounds[5]?.stdin).not.toContain('- octo: ')
  expect(rounds[5]?.stdin).not.toContain('The look as it is now')
  expect(rounds[5]?.argv).toContain('Read(//home/t/pics/octo.png)')
  const redrawn = JSON.parse(files.get(octoFile) ?? '{}')
  expect([redrawn.color, redrawn.change, redrawn.image]).toEqual([OCTOPUS.color, undefined, '/home/t/pics/octo.png'])
  const keptNow = [...files.keys()].filter(p => p.startsWith(`${data}/emotes/old/octo.`))
  expect(keptNow).toHaveLength(2)
  expect(keptNow.map(p => files.get(p))).toContain(blue)

  // /clawd emote delete moves the file to data/emotes/old/, and the emote is gone.
  expect((await run('emote dele octo'))?.text).toBe('Clawd: type delete in full; it removes an emote.')
  expect((await run('emote delete octo'))?.text).toMatch(/^Clawd: octo is deleted\. Its file is now \/home\/t\/\.claude\/clawd\/emotes\/old\/octo\.[-0-9TZ]+\.json; move it back to undo\.$/)
  expect(files.has(octoFile)).toBe(false)
  expect((await run('list emotes'))?.text).not.toContain('octo')

  // The name alone is enough: the model draws from it in words, and capitals become snake_case.
  expect((await run('emote create ClaudeWithGlasses'))?.text).toBe('Clawd: a model draws claude_with_glasses, in a few minutes; it plays when done.')
  await clock.advance(200)
  expect(rounds[7]?.stdin).toContain('The look: claude_with_glasses, "claude with glasses".')
  expect(rounds[7]?.stdin).toContain('There is no reference image; draw it from the title.')
  expect(files.has(`${data}/emotes/claude_with_glasses.json`)).toBe(true)
  // An image path in place of the name gives the name from its file.
  expect((await run('emote create ~/pics/round-glasses.png'))?.text).toContain('a model draws round_glasses after /home/t/pics/round-glasses.png')
  await clock.advance(200)
  expect(rounds[9]?.stdin).toContain('The look: round_glasses, "round glasses".')
  expect(rounds[9]?.argv).toContain('Read(//home/t/pics/round-glasses.png)')

  // A sentence gets its name from Haiku, told the kind and the names already taken.
  expect((await run('emote create a cat in a hat'))?.text).toBe(
    'Clawd: a model draws cat_in_a_hat (named by haiku), in a few minutes; it plays when done.',
  )
  const asked = named[named.length - 1] ?? ''
  expect(asked).toContain('The person typed /clawd emote create, then these words: a cat in a hat\nAn emote is a look Clawd takes for a while.')
  expect(asked).toMatch(/Names already taken, which the new one may not have: .*\bjump\b.*\bclaude_with_glasses\b/)
  await clock.advance(200)
  expect(rounds[11]?.stdin).toContain('The look: cat_in_a_hat, "a cat in a hat".')
  // Without a usable name from Haiku, the first word is the name.
  expect((await run('emote create mystery blob thing'))?.text).toContain('a model draws mystery,')
  await clock.advance(200)
  expect(rounds[13]?.stdin).toContain('The look: mystery, "blob thing".')
})

test('/clawd act create, change, delete and preview work as the emote commands do: Opus writes the act, the old file is kept, a preview is a PNG', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/t', CLAUDE_CLAWD_SEED: '7' })
  const files = new Map<string, string>()
  const pngs: string[] = []
  const prompts: string[] = []
  const toasts: string[] = []
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('ui.log', async () => ({ value: undefined }))
  on('ui.toast', async ($, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('ui.blit', async () => ({ value: {} }))
  on('process.run', async ($, e) => {
    const done = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'python3') {
      pngs.push(e.argv[3] ?? '')
      return done('')
    }
    if (e.argv[0] === 'mv') {
      const [, , from = '', to = ''] = e.argv
      files.set(to, files.get(from) ?? '')
      files.delete(from)
      return done('')
    }
    return done('Sat 17:00\n')
  })
  on('fs.stat', async ($, e) => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('fs.list', async ($, e) => ({
    value: [...files.keys()]
      .filter(p => p.startsWith(`${e.path}/`) && !p.slice(e.path.length + 1).includes('/'))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async ($, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', async ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  // Opus writes three steps for a new act or a rewrite, and two for a change; the
  // first write waits for the gate. Haiku asks for the act being written.
  let open = () => {}
  const gate = new Promise<void>(resolve => (open = resolve))
  on('session.id', async () => ({ value: 'sess-1' }))
  on('model.complete', async ($, e) => {
    if (e.model === 'haiku' && e.prompt.startsWith('The person typed')) return { value: { isAnswered: true as const, text: naming(e.prompt), usage } }
    if (e.model === 'haiku') {
      const ask = '{"summary": "", "calls": [{"who": "clawd", "play": "wave"}], "why": "", "new": {"name": "cartwheel", "title": "a cartwheel", "for": "clawd"}}'
      return { value: { isAnswered: true as const, text: ask, usage } }
    }
    if (prompts.length === 0) await gate
    prompts.push(e.prompt)
    const text = e.prompt.startsWith('Change')
      ? '{"steps": [{"do": "run", "to": 0.9, "arms": "wave"}, {"do": "sparks", "n": 4}]}'
      : '{"steps": [{"do": "run", "to": 0.9}, {"do": "hop", "n": 2}, {"do": "wave", "dur": 1}]}'
    return { value: { isAnswered: true as const, text, usage } }
  })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine band') as RenderElement
  })

  await $.session.start({ cwd: '/home/t/proj', surface: 'terminal', isInteractive: true })
  await $.ui.mount({
    plugin: 'clawd',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
    viewport: { columns: 100, rows: 40 },
  })
  await clock.advance(200)
  const run = (args: string) =>
    $.command.run({ command: 'clawd', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  const data = '/home/t/.claude/clawd'
  const file = `${data}/acts/cartwheel.json`

  expect((await run('act create jump a big jump'))?.text).toBe('Clawd: jump is taken; pick another name.')
  expect((await run('act create list lists things'))?.text).toBe('Clawd: list is taken; pick another name.')
  expect((await run('act create'))?.text).toContain('Usage: /clawd act create <name> [what it does]')
  expect((await run('act create cartwheel turns a cartwheel across the band'))?.text).toBe('Clawd: opus writes cartwheel, in a minute or two; it plays when done.')
  // One model makes one thing at a time, an act, an emote or a skin.
  expect((await run('act create flip does a flip'))?.text).toBe('Clawd: cartwheel is still being made; one at a time.')
  expect((await run('emote create frog a green frog'))?.text).toBe('Clawd: cartwheel is still being made; one at a time.')
  // The picker may not ask for the act being written either.
  await run('trace')
  await clock.advance(10)
  await run('autopick now')
  await clock.advance(10)
  const picked = JSON.parse(files.get(`${data}/picks/sess-1.jsonl`)?.trim().split('\n').pop() ?? '{}')
  expect(picked.outcome).toBe('played clawd: wave; new act cartwheel asked, but cartwheel is still being made')
  open()
  await clock.advance(200)
  expect(prompts[0]).toMatch(/^Write the steps for a new act\.\nname: cartwheel\ntitle: turns a cartwheel across the band\n/)
  const saved = JSON.parse(files.get(file) ?? '{}')
  expect([saved.title, saved.why, saved.steps.length, saved.change]).toEqual(['turns a cartwheel across the band', 'asked for with /clawd act create', 3, undefined])
  expect(toasts.some(t => t.includes('Clawd has a new act: cartwheel'))).toBe(true)
  expect((await run('list made'))?.text).toContain('cartwheel')

  // A preview runs the act and draws the band every half second, one frame per line.
  const shown = (await run('act preview cartw'))?.text ?? ''
  expect(shown).toMatch(/^Clawd: cartwheel in \d+ frames, the band every 0\.5 s from top to bottom, is in \/home\/t\/\.claude\/clawd\/acts\/previews\/cartwheel\.png\.$/)
  expect(pngs).toContain(`${data}/acts/previews/cartwheel.png`)
  expect((await run('act preview jump'))?.text).toContain(`${data}/acts/previews/jump.png`)
  expect((await run('act preview frog'))?.text).toBe('Clawd: no act frog. /clawd list acts and /clawd list made name them.')

  // A change starts from the steps as they are, and the old file is kept.
  const before = files.get(file)
  expect((await run('act edit cartwheel "faster, with sparks"'))?.text).toBe(
    `Clawd: opus changes cartwheel: "faster, with sparks", in a minute or two; it plays when done. The old act goes to ${data}/acts/old/ once the new one is saved.`,
  )
  await clock.advance(200)
  expect(prompts[1]).toMatch(/^Change the steps of an act\.\nname: cartwheel\n/)
  expect(prompts[1]).toContain('The act as it is now: {"steps":[{"do":"run","to":0.9},{"do":"hop","n":2},{"do":"wave","dur":1}]}')
  expect(prompts[1]).toContain('The change asked for now: "faster, with sparks". Make that change and keep what it does not touch.')
  const changed = JSON.parse(files.get(file) ?? '{}')
  expect([changed.title, changed.change, changed.steps.length]).toEqual(['turns a cartwheel across the band', 'faster, with sparks', 2])
  const kept = [...files.keys()].filter(p => p.startsWith(`${data}/acts/old/cartwheel.`))
  expect(kept).toHaveLength(1)
  expect(files.get(kept[0] ?? '')).toBe(before)
  expect(toasts.some(t => t.includes("Clawd's act cartwheel is changed"))).toBe(true)

  // A change with no words writes the act again from scratch, from its title.
  expect((await run('act change cartwheel'))?.text).toContain('opus writes cartwheel again from scratch after "turns a cartwheel across the band"')
  await clock.advance(200)
  expect(prompts[2]).toMatch(/^Write the steps for a new act\.\nname: cartwheel\n/)
  expect(prompts[2]).not.toContain('The act as it is now')
  expect(prompts[2]).toContain('Made acts: none yet.')
  const rewritten = JSON.parse(files.get(file) ?? '{}')
  expect([rewritten.change, rewritten.steps.length]).toEqual([undefined, 3])
  expect([...files.keys()].filter(p => p.startsWith(`${data}/acts/old/cartwheel.`))).toHaveLength(2)

  // Only a made act can be deleted; its file goes to acts/old/.
  expect((await run('act delete jump'))?.text).toBe('Clawd: jump is built in; only made acts can be deleted. /clawd list made shows them.')
  expect((await run('act dele cartwheel'))?.text).toBe('Clawd: type delete in full; it removes an act.')
  expect((await run('act delete cartwheel'))?.text).toMatch(/^Clawd: cartwheel is deleted\. Its file is now \/home\/t\/\.claude\/clawd\/acts\/old\/cartwheel\.[-0-9TZ]+\.json; move it back to undo\.$/)
  expect(files.has(file)).toBe(false)
  expect((await run('list made'))?.text).not.toContain('cartwheel')

  // The name alone is enough, and hyphens become snake_case.
  expect((await run('act create Back-Flip'))?.text).toBe('Clawd: opus writes back_flip, in a minute or two; it plays when done.')
  await clock.advance(200)
  expect(prompts[3]).toMatch(/^Write the steps for a new act\.\nname: back_flip\ntitle: back flip\n/)
  expect(JSON.parse(files.get(`${data}/acts/back_flip.json`) ?? '{}').title).toBe('back flip')
  // A sentence gets its name from Haiku, as for a look.
  expect((await run('act create a cat in a hat'))?.text).toBe('Clawd: opus writes cat_in_a_hat (named by haiku), in a minute or two; it plays when done.')
  await clock.advance(200)
  expect(prompts[4]).toMatch(/^Write the steps for a new act\.\nname: cat_in_a_hat\ntitle: a cat in a hat\n/)
})

test('the picker may have a new skin drawn or call one that exists, and Clawd wears it for the session, unless the person chose a skin with /clawd skin', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/t', CLAUDE_CLAWD_SEED: '7' })
  const data = '/home/t/.claude/clawd'
  // A skin made an hour ago, which counts towards the new ones of the last 24 hours.
  const files = new Map([[`${data}/skins/pirate.json`, JSON.stringify({ ...OCTOPUS, name: 'pirate', title: 'a pirate octopus', made: '2023-11-14T21:00:00.000Z' })]])
  const rounds: string[] = []
  const prompts: string[] = []
  const replies: string[] = []
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('ui.log', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('ui.blit', async () => ({ value: {} }))
  on('process.run', async ($, e) => {
    const done = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] !== 'claude') return done(e.argv[0] === 'python3' ? '' : 'Sat 17:00\n')
    rounds.push(e.init?.stdin ?? '')
    // Three drafts, the first picked, then kept once its preview is seen.
    if (rounds.length === 1) return done(JSON.stringify({ drafts: [OCTOPUS, { ...OCTOPUS, color: '#808080' }, { ...OCTOPUS, color: '#c0c0c0' }] }))
    return done(JSON.stringify({ ...OCTOPUS, pick: 1, done: true }))
  })
  on('fs.stat', async ($, e) => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('fs.list', async ($, e) => ({
    value: [...files.keys()]
      .filter(p => p.startsWith(`${e.path}/`) && !p.slice(e.path.length + 1).includes('/'))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async ($, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', async ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('session.id', async () => ({ value: 'sess-1' }))
  on('model.complete', async ($, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true as const, text: replies.shift() ?? '{"calls": [{"who": "clawd", "play": "wave"}], "new": null}', usage } }
  })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine band') as RenderElement
  })

  await $.session.start({ cwd: '/home/t/proj', surface: 'terminal', isInteractive: true })
  await $.ui.mount({
    plugin: 'clawd',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
    viewport: { columns: 100, rows: 40 },
  })
  await clock.advance(200)
  const run = (args: string) =>
    $.command.run({ command: 'clawd', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  const outcome = () => JSON.parse(files.get(`${data}/picks/sess-1.jsonl`)?.trim().split('\n').pop() ?? '{}').outcome
  const autopick = async (reply: string) => {
    replies.push(reply)
    await run('autopick now')
    await clock.advance(200)
    return prompts[prompts.length - 1] ?? ''
  }
  await run('trace')

  // Asked to stay a cat, the picker has a skin drawn, as an emote is drawn, and Clawd wears it.
  const first = await autopick(
    '{"summary": "", "calls": [{"who": "clawd", "play": "wave"}], "why": "asked", "new": {"name": "cat", "title": "a grey cat", "for": "clawd", "look": "skin"}}',
  )
  expect(first).toContain("pirate: a skin, clawd only, for the rest of the session: Clawd's body becomes a pirate octopus")
  expect(first).toContain('Add "look": "skin" instead when they ask Clawd to stay that thing from now on')
  expect(first).toContain('1 of at most 5 new acts, emotes and skins were made in the last 24 hours.')
  expect(outcome()).toBe('played clawd: wave; new skin cat being drawn')
  expect(rounds.length).toBe(3)
  expect(rounds[0]).toContain('{"drafts": [draft 1, draft 2, draft 3]}')
  expect(JSON.parse(files.get(`${data}/skins/cat.json`) ?? '{}').name).toBe('cat')
  expect((await run('skin'))?.text).toMatch(/^Skin: cat \("a blue octopus"\); picked by the autopicker for this session; \/clawd skin auto goes back\./)

  // A skin that exists is called like an act.
  const second = await autopick('{"summary": "", "calls": [{"who": "clawd", "play": "pirate"}], "why": "asked", "new": null}')
  expect(second).toContain('2 of at most 5 new acts, emotes and skins were made in the last 24 hours.')
  expect(second).not.toContain('cat: a skin')
  expect(outcome()).toBe('played clawd: pirate; no new act')
  expect((await run('skin'))?.text).toMatch(/^Skin: pirate \("a pirate octopus"\); picked by the autopicker/)

  // auto drops the picker's skin.
  expect((await run('skin auto'))?.text).toBe("Clawd: Skin: none, Clawd's own body.")

  // After the person chose a skin, even Clawd's own body, the picker sees no skins and may not make one.
  await run('skin none')
  const third = await autopick(
    '{"summary": "", "calls": [{"who": "clawd", "play": "pirate"}], "why": "asked", "new": {"name": "dog", "title": "a dog", "for": "clawd", "look": "skin"}}',
  )
  expect(third).not.toContain('a skin, clawd only')
  expect(third).not.toContain('"look": "skin"')
  expect(outcome()).toBe('played nothing; new skin dog refused: the person chose a skin with /clawd skin')
  expect(files.has(`${data}/skins/dog.json`)).toBe(false)
  expect((await run('skin'))?.text).toMatch(/^Skin: none, Clawd's own body; chosen with \/clawd skin for this session\./)
})

const NAMES: Names = {
  minis: { a1: 'the mini for "Find auth code"' },
  emotes: { moon_jelly: 'a moon jellyfish' },
  skins: { matsci_octopus: 'the MatSci octopus' },
  made: { octopus_wiggle: 'turns into an octopus', build: 'builds something' },
  acts: { jump: 'a big jump sideways', hop: 'a small hop', celebrate: 'two hops', chase: 'chases a sparkle', wave: 'waves' },
}

test('/clawd words may be cut short while they fit one name, and say what is wrong otherwise', () => {
  expect(orderOf([], NAMES)).toEqual({ kind: 'status' })
  expect(orderOf(['moon'], NAMES)).toMatchObject({ kind: 'play', who: 'clawd', fit: { kind: 'emote', name: 'moon_jelly' }, count: 1 })
  expect(orderOf(['emote', 'moo'], NAMES)).toMatchObject({ kind: 'play', who: 'clawd', fit: { kind: 'emote', name: 'moon_jelly' } })
  expect(orderOf(['wiggle'], NAMES)).toMatchObject({ kind: 'play', fit: { name: 'octopus_wiggle' } })
  expect(orderOf(['ju', '9'], NAMES)).toMatchObject({ kind: 'play', fit: { name: 'jump' }, count: 5 })
  expect(orderOf(['act', 'ju', '2'], NAMES)).toMatchObject({ kind: 'play', who: 'clawd', fit: { name: 'jump' }, count: 2 })
  expect(orderOf(['a1', 'cel', '2'], NAMES)).toMatchObject({ kind: 'play', who: 'a1', fit: { name: 'celebrate' }, count: 2 })
  expect(orderOf(['help'], NAMES)).toEqual({ kind: 'command', name: 'help', rest: [] })
  expect(orderOf(['?'], NAMES)).toEqual({ kind: 'command', name: 'help', rest: [] })
  expect(orderOf(['help', 'uml'], NAMES)).toEqual({ kind: 'command', name: 'help', rest: ['uml'] })
  expect(orderOf(['list', 'emote'], NAMES)).toEqual({ kind: 'list', of: 'emotes' })
  expect(orderOf(['list'], NAMES)).toEqual({ kind: 'unclear', text: 'Clawd: list what? /clawd list acts | made | emotes | skins | minis.' })
  expect(orderOf(['list', 'sk'], NAMES)).toEqual({ kind: 'list', of: 'skins' })
  expect(orderOf(['pick'], NAMES)).toEqual({ kind: 'command', name: 'autopick', rest: [] })
  expect(orderOf(['of'], NAMES)).toEqual({ kind: 'command', name: 'off', rest: [] })
  expect(orderOf(['emote', 'cre', 'frog', 'a', 'frog'], NAMES)).toEqual({ kind: 'unclear', text: 'Clawd: type create in full; it starts a model run.' })
  expect(orderOf(['emote', 'create', 'frog', 'a', 'frog'], NAMES)).toEqual({ kind: 'command', name: 'emote', rest: ['create', 'frog', 'a', 'frog'] })
  expect(orderOf(['emote', 'delete', 'moon_jelly'], NAMES)).toEqual({ kind: 'command', name: 'emote', rest: ['delete', 'moon_jelly'] })
  expect(orderOf(['emote', 'delete', 'moo'], NAMES)).toEqual({ kind: 'unclear', text: "Clawd: type the emote's full name: /clawd emote delete moon_jelly." })
  expect(orderOf(['emote', 'delete', 'frog'], NAMES)).toEqual({ kind: 'unclear', text: 'Clawd: there is no emote frog. /clawd list emotes shows them.' })
  expect(orderOf(['emote', 'change'], NAMES)).toEqual({ kind: 'unclear', text: 'Clawd: which emote? /clawd emote change <emote> [what to change].' })
  expect(orderOf(['emote', 'chan', 'moon_jelly', 'blue'], NAMES)).toEqual({ kind: 'unclear', text: 'Clawd: type change in full; it starts a model run.' })
  expect(orderOf(['emote', 'modify', 'moon_jelly', 'blue'], NAMES)).toEqual({ kind: 'command', name: 'emote', rest: ['change', 'moon_jelly', 'blue'] })
  expect(orderOf(['emote', 'prev', 'moon_jelly'], NAMES)).toEqual({ kind: 'command', name: 'emote', rest: ['preview', 'moon_jelly'] })
  expect(orderOf(['delete', 'moon_jelly'], NAMES)).toEqual({ kind: 'unclear', text: 'Clawd: delete what? /clawd act delete, /clawd emote delete or /clawd skin delete.' })
  expect(orderOf(['edit', 'moon_jelly'], NAMES)).toEqual({ kind: 'unclear', text: 'Clawd: change what? /clawd act change, /clawd emote change or /clawd skin change.' })
  // Acts take the same commands as emotes and skins; change and delete take a made act only.
  expect(orderOf(['act'], NAMES)).toEqual({
    kind: 'unclear',
    text: 'Clawd: which act? /clawd act <act> plays one; act create, change, delete and preview work on them. /clawd list acts shows them.',
  })
  expect(orderOf(['act', 'create', 'cartwheel', 'turns', 'a', 'cartwheel'], NAMES)).toEqual({ kind: 'command', name: 'act', rest: ['create', 'cartwheel', 'turns', 'a', 'cartwheel'] })
  expect(orderOf(['act', 'cre', 'cartwheel', 'turns'], NAMES)).toEqual({ kind: 'unclear', text: 'Clawd: type create in full; it starts a model run.' })
  expect(orderOf(['act', 'delete', 'build'], NAMES)).toEqual({ kind: 'command', name: 'act', rest: ['delete', 'build'] })
  expect(orderOf(['act', 'dele', 'build'], NAMES)).toEqual({ kind: 'unclear', text: 'Clawd: type delete in full; it removes an act.' })
  expect(orderOf(['act', 'delete', 'jump'], NAMES)).toEqual({ kind: 'unclear', text: 'Clawd: jump is built in; only made acts can be deleted. /clawd list made shows them.' })
  expect(orderOf(['act', 'change', 'oct'], NAMES)).toEqual({ kind: 'unclear', text: "Clawd: type the act's full name: /clawd act change octopus_wiggle." })
  expect(orderOf(['act', 'change', 'frog'], NAMES)).toEqual({ kind: 'unclear', text: 'Clawd: there is no act frog. /clawd list made shows them.' })
  expect(orderOf(['act', 'edit', 'build', 'faster'], NAMES)).toEqual({ kind: 'command', name: 'act', rest: ['change', 'build', 'faster'] })
  expect(orderOf(['act', 'prev', 'ju'], NAMES)).toEqual({ kind: 'command', name: 'act', rest: ['preview', 'ju'] })
  expect(orderOf(['a1', 'create'], NAMES)).toEqual({ kind: 'unclear', text: 'Clawd: nothing is called "create". /clawd list acts shows what there is.' })
  expect(orderOf(['xyz'], NAMES)).toEqual({ kind: 'unclear', text: 'Clawd: nothing is called "xyz". /clawd help shows what there is.' })
  expect(orderOf(['o'], NAMES)).toEqual({ kind: 'unclear', text: 'Clawd: "o" fits 3 names: on, off, octopus_wiggle. Type more of it.' })
  expect(orderOf(['act', 'moon'], NAMES)).toEqual({ kind: 'unclear', text: 'Clawd: moon_jelly is an emote; /clawd emote moon_jelly plays it.' })
  expect(orderOf(['a1', 'moon'], NAMES)).toEqual({ kind: 'unclear', text: 'Clawd: emotes are for Clawd only, not for a1.' })
  // A skin is worn all session: it takes /clawd skin, and is no act or emote.
  expect(orderOf(['skin'], NAMES)).toEqual({ kind: 'command', name: 'skin', rest: [] })
  expect(orderOf(['skin', 'mats'], NAMES)).toEqual({ kind: 'command', name: 'skin', rest: ['matsci_octopus'] })
  expect(orderOf(['skin', 'au'], NAMES)).toEqual({ kind: 'command', name: 'skin', rest: ['auto'] })
  expect(orderOf(['skin', 'none'], NAMES)).toEqual({ kind: 'command', name: 'skin', rest: ['none'] })
  expect(orderOf(['skin', 'prev', 'mats'], NAMES)).toEqual({ kind: 'command', name: 'skin', rest: ['preview', 'mats'] })
  expect(orderOf(['skin', 'edit', 'matsci_octopus', 'rounder'], NAMES)).toEqual({ kind: 'command', name: 'skin', rest: ['change', 'matsci_octopus', 'rounder'] })
  expect(orderOf(['skin', 'dele', 'matsci_octopus'], NAMES)).toEqual({ kind: 'unclear', text: 'Clawd: type delete in full; it removes a skin.' })
  expect(orderOf(['skin', 'delete', 'mats'], NAMES)).toEqual({ kind: 'unclear', text: "Clawd: type the skin's full name: /clawd skin delete matsci_octopus." })
  expect(orderOf(['skin', 'frog'], NAMES)).toEqual({ kind: 'unclear', text: 'Clawd: nothing is called "frog". /clawd list skins shows what there is.' })
  expect(orderOf(['matsci'], NAMES)).toEqual({ kind: 'unclear', text: 'Clawd: matsci_octopus is a skin; /clawd skin matsci_octopus puts it on for this session.' })
  expect(orderOf(['emote', 'matsci_octopus'], NAMES).kind).toBe('unclear')
})

test('while /clawd is typed, a framed list shows what the word fits, a space writes it out, and the words are marked', () => {
  const menu = (draft: string) => menuFor(draft, draft.length, NAMES)
  const names = (draft: string) => menu(draft)?.rows.map(r => r.name)
  expect(menu('hello')).toBeUndefined()
  expect(menu('/clawd')).toBeUndefined()
  // Nothing typed yet: the commands and minis; acts and emotes come by typing.
  expect(menu('/clawd ')).toMatchObject({ title: '/clawd', note: 'type to narrow, space writes a single fit out', isOne: false, count: '' })
  const top = menu('/clawd ')
  expect(top && menuLayout(top, 7)).toEqual({
    rows: ['help', 'act', 'emote', 'skin', 'list', 'on', 'off'].map(name => ({ name, what: COMMANDS[name], from: 0, to: 0 })),
    foot: '+4 more: autopick trace debug a1',
  })
  expect(menu('/clawd a1 c')).toEqual({
    title: '/clawd a1',
    note: 'acts that fit "c"',
    rows: [
      { name: 'celebrate', what: 'two hops', from: 0, to: 1 },
      { name: 'chase', what: 'chases a sparkle', from: 0, to: 1 },
    ],
    isOne: false,
    count: '2 of 7 fit',
    next: 'then [1-5] times in a row',
  })
  // After act come its commands, as after emote and skin, then the acts.
  expect(menu('/clawd act c')).toMatchObject({ title: '/clawd act', note: 'names that fit "c"', count: '4 of 11 fit', next: '' })
  expect(names('/clawd act c')).toEqual(['create', 'change', 'celebrate', 'chase'])
  expect(menu('/clawd act wav')).toEqual({
    title: '/clawd act',
    note: 'space writes it out',
    rows: [{ name: 'wave', what: 'waves', from: 0, to: 3 }],
    isOne: true,
    count: '',
    next: 'then [1-5] times in a row',
  })
  expect(menu('/clawd wave')).toMatchObject({ note: '', isOne: true, rows: [{ name: 'wave', what: 'act: waves' }] })
  // At the top the kinds mix, so each row says its kind, and no next step is shared.
  expect(menu('/clawd o')).toMatchObject({ count: '3 of 19 fit', next: '' })
  expect(menu('/clawd o')?.rows[2]).toEqual({ name: 'octopus_wiggle', what: 'made act: turns into an octopus', from: 0, to: 1 })
  expect(menu('/clawd wig')?.rows).toEqual([{ name: 'octopus_wiggle', what: 'made act: turns into an octopus', from: 8, to: 11 }])
  const o = menu('/clawd o')
  expect(o && menuLayout(o, 2).foot).toBe('3 of 19 fit · +1 more: octopus_wiggle')
  expect(menu('/clawd act ')).toMatchObject({ title: '/clawd act', note: '11 names' })
  expect(names('/clawd act ')).toEqual(['create', 'change', 'delete', 'preview', 'octopus_wiggle', 'build', 'jump', 'hop', 'celebrate', 'chase', 'wave'])
  expect(names('/clawd a1 ')).toEqual(['octopus_wiggle', 'build', 'jump', 'hop', 'celebrate', 'chase', 'wave'])
  expect(names('/clawd emote ')).toEqual(['create', 'change', 'delete', 'preview', 'moon_jelly'])
  expect(names('/clawd skin ')).toEqual(['auto', 'none', 'create', 'change', 'delete', 'preview', 'matsci_octopus'])
  expect(names('/clawd emote edit ')).toEqual(['moon_jelly'])
  expect(menu('/clawd act change ')).toMatchObject({ title: '/clawd act change', note: '2 made acts' })
  expect(names('/clawd act delete ')).toEqual(['octopus_wiggle', 'build'])
  expect(names('/clawd act preview ')).toEqual(['octopus_wiggle', 'build', 'jump', 'hop', 'celebrate', 'chase', 'wave'])
  expect(menu('/clawd act create ')).toMatchObject({ title: '/clawd act create', note: '<new_name> in snake_case', rows: [] })
  expect(menu('/clawd act create cartwheel tu')).toMatchObject({ note: '[what it does; else the name says it]' })
  expect(menu('/clawd skin create claude_with_glasses ')).toMatchObject({ note: '[image path] [what it looks like; else the name says it]' })
  expect(menu('/clawd act change build ')).toMatchObject({ note: '[what to change; nothing writes it again]' })
  expect(names('/clawd list ')).toEqual(['acts', 'made', 'emotes', 'skins', 'minis'])
  expect(names('/clawd help ')).toEqual(['uml'])
  expect(menu('/clawd moo')).toMatchObject({ note: 'space writes it out', isOne: true, next: '' })
  expect(menu('/clawd jump ')).toMatchObject({ title: '/clawd jump', note: '[1-5] times in a row', rows: [] })
  expect(menu('/clawd act jump ')).toMatchObject({ title: '/clawd act jump', note: '[1-5] times in a row' })
  expect(menu('/clawd jump 3 ')).toBeUndefined()
  expect(menu('/clawd on ')).toBeUndefined()
  expect(menu('/clawd emote create ')).toMatchObject({ title: '/clawd emote create', note: '<new_name> in snake_case', rows: [] })
  expect(menu('/clawd emote create frog a fr')).toMatchObject({ title: '/clawd emote create', note: '[image path] [what it looks like; else the name says it]' })
  expect(menu('/clawd emote change moon_jelly ')).toMatchObject({ title: '/clawd emote change', note: '[image path] [what to change; nothing draws it again]' })
  expect(menu('/clawd emote moon_jelly ')).toBeUndefined()
  expect(menu('/clawd zz')).toMatchObject({ note: 'nothing is called "zz"', rows: [], next: '/clawd help shows what there is' })

  expect(writeOut('/clawd moo ', 11, NAMES)).toEqual({ text: '/clawd moon_jelly ', cursor: 18 })
  expect(writeOut('/clawd emote m ', 15, NAMES)).toEqual({ text: '/clawd emote moon_jelly ', cursor: 24 })
  expect(writeOut('/clawd list e ', 14, NAMES)).toEqual({ text: '/clawd list emotes ', cursor: 19 })
  expect(writeOut('/clawd a1 ce ', 13, NAMES)).toEqual({ text: '/clawd a1 celebrate ', cursor: 20 })
  expect(writeOut('/clawd o ', 9, NAMES)).toBeUndefined()
  expect(writeOut('/clawd jump ', 12, NAMES)).toBeUndefined()
  expect(writeOut('/clawd emote create fr ', 23, NAMES)).toBeUndefined()
  expect(writeOut('/clawd emote delete m ', 22, NAMES)).toEqual({ text: '/clawd emote delete moon_jelly ', cursor: 31 })
  expect(writeOut('/clawd act delete b ', 20, NAMES)).toEqual({ text: '/clawd act delete build ', cursor: 24 })

  expect(marksFor('/clawd ju 3', NAMES)).toEqual([{ start: 7, end: 9, isFit: true }])
  expect(marksFor('/clawd a1 zz', NAMES)).toEqual([
    { start: 7, end: 9, isFit: true },
    { start: 10, end: 12, isFit: false },
  ])
})

test('the menu draws below Clawd in the band, one row per fit, framed to the band width, and on its own with Clawd off', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/t', CLAUDE_CLAWD_SEED: '7' })
  on('ui.log', async () => ({ value: undefined }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  // prompt.edit cannot be raised from a test, so the test answers the menu's state itself.
  let menu = menuFor('/clawd a1 c', 11, NAMES) ?? null
  on('state.get', async ($, e, next) => (e.plugin === 'clawd' && e.key === 'clawdMenu' ? { value: { value: menu, version: 1 } } : next(e)))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine band') as RenderElement
  })
  await $.session.start({ cwd: '/home/t/proj', surface: 'terminal', isInteractive: true })
  const mount = (maxRows: number) =>
    $.ui.mount({
      plugin: 'clawd',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows, bodyColumns: 60, scroll: { offset: 0, bodyRows: 20 }, view: {} },
      viewport: { columns: 60, rows: 40 },
    })
  const band = await mount(20)
  expect(await band.find({ type: 'Raster', key: 'clawd' })).toBeDefined()
  expect((await band.find({ key: 'menu-0' }))?.text).toBe(`│   celebrate  two hops${' '.repeat(36)}│`)
  expect((await band.find({ key: 'menu-1' }))?.text).toMatch(/^│ {3}chase {6}chases a sparkle +│$/)
  expect((await band.find({ key: 'menu-bottom' }))?.text).toMatch(/^╰─ 2 of 7 fit · then \[1-5\] times in a row ─+╯$/)
  for (const key of ['menu-0', 'menu-1', 'menu-bottom']) expect((await band.find({ key }))?.text).toHaveLength(60)
  // With Clawd off, the menu draws its own top edge.
  await $.command.run({ command: 'clawd', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 60 } })
  const off = await mount(20)
  expect(await off.find({ type: 'Raster', key: 'clawd' })).toBeUndefined()
  expect((await off.find({ key: 'menu-top' }))?.text).toMatch(/^╭─ \/clawd a1 · acts that fit "c" ─+╮$/)
  expect(await off.find({ key: 'menu-1' })).toBeDefined()
  menu = null
  expect(await (await mount(20)).find({ key: 'menu-bottom' })).toBeUndefined()
})

test('/clawd help uml draws the three diagrams with the numbers it is given, none wider than UML_WIDTH', () => {
  for (const pickModel of ['haiku', 'sonnet']) {
    const lines = clawdUml({
      sleepAfterS: 180,
      readHoldS: 1.2,
      miniStaleS: 900,
      maxMinis: 6,
      pickMinS: 10,
      pickMaxS: 60,
      maxDelayS: 5,
      newPerDay: 5,
      maxSteps: 12,
      emoteDrafts: 3,
      emoteRounds: 3,
      pickModel,
      makeModel: 'opus',
    })
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(UML_WIDTH)
    const text = lines.join('\n')
    expect(text).toContain('1. Clawd (UML state machine)')
    expect(text).toContain('2. A mini Clawd (UML state machine): one per running subagent, at most 6.')
    expect(text).toContain('3. A new act, emote or skin (UML activity diagram)')
    expect(text).toContain('after 180 s')
    expect(text).toContain('15 min without an event / trip')
    expect(text).toContain(`${pickModel} reads what happened and every`)
    expect(text).toContain('opus writes 1 to 12 steps')
  }
})

test('/clawd help uml draws in colour, each run by what it is, and other /clawd rows stay the engine\'s', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/t', CLAUDE_CLAWD_SEED: '7' })
  on('ui.log', async () => ({ value: undefined }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine row') as RenderElement
  })
  await $.session.start({ cwd: '/home/t/proj', surface: 'terminal', isInteractive: true })
  const run = (args: string) =>
    $.command.run({ command: 'clawd', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  const text = (await run('help uml'))?.text ?? ''
  const lines = text.split('\n')
  expect(lines[0]).toBe(UML_LEGEND)

  const runs = umlKinds(lines)
  runs.forEach((line, i) => expect(line.map(r => r.text).join('')).toBe(lines[i]))
  const kindOf = (text: string | RegExp) => runs.flat().find(r => (typeof text === 'string' ? r.text === text : text.test(r.text)))?.kind
  expect(kindOf('╭╮')).toBe('state')
  expect(kindOf(/^╭─+╮$/)).toBe('state')
  expect(kindOf(/^├─+┤$/)).toBe('state')
  expect(kindOf(/^ Idle +$/)).toBe('name')
  expect(kindOf(/^┌─+┐$/)).toBe('note')
  expect(kindOf('1. Clawd (UML state machine)')).toBe('heading')
  expect(kindOf('●')).toBe('end')
  expect(kindOf('◉')).toBe('end')
  expect(kindOf('◇')).toBe('guard')
  expect(kindOf('[new.look: become, hold or skin]')).toBe('guard')
  expect(kindOf('[1]')).toBe('footnote')
  expect(kindOf(/^─+┘$/)).toBe('flow')
  expect(kindOf(/^─+▶$/)).toBe('flow')
  expect(kindOf(/^ +do \/ sleep +$/)).toBe('text')

  const row = await $.ui.mount({
    plugin: 'clawd',
    surface: 'terminal',
    component: 'CommandOutput',
    props: { command: 'clawd', args: 'help uml', text, isErrored: false },
    viewport: { columns: 100, rows: 40 },
  })
  for (const [i, line] of lines.entries()) expect((await row.find({ key: `uml-${i}` }))?.text).toBe(line || ' ')
  expect((await row.find({ type: 'Text', text: /^╭─+╮$/ }))?.props.color).toBe('#d77757')
  expect((await row.find({ type: 'Text', text: /^ Idle +$/ }))?.props.bold).toBe(true)
  expect((await row.find({ type: 'Text', text: /^\[new\.look: become, hold or skin\]$/ }))?.props.color).toBe('#e0b84a')
  const status = await $.ui.mount({
    plugin: 'clawd',
    surface: 'terminal',
    component: 'CommandOutput',
    props: { command: 'clawd', args: 'on', text: 'Clawd on.', isErrored: false },
    viewport: { columns: 100, rows: 40 },
  })
  expect(await status.find({ text: 'engine row' })).toBeDefined()
  expect(await status.find({ key: 'uml-0' })).toBeUndefined()
})

test('while Remote Control is on, Clawd wears a gray antenna on the back edge of its head, leaning back with a green tip, on its own look and on an emote', async () => {
  const idle = { kind: 'idle' as const, t0: 0, stage: 0, dur: 99, next: 99, look: 0 }
  // The tip needs the band's second row of headroom, so the band stays 5 rows high.
  const w = createWorld(20, 4, seeded(1))
  w.queue = []
  w.x = 9
  w.act = { ...idle }
  w.blinkAt = 999
  step(w)
  expect(bandRows(w)).toBe(4)
  expect(rows(frameCells(w), 20)[0]).toBe('')
  w.antenna = true
  step(w)
  expect(bandRows(w)).toBe(5)
  // A terminal with room for 4 rows only shows the stalk.
  expect(rows(frameCells(w), 20)).toEqual([' ▚', ' ▐▛███▜▌', '▝▜█████▛▘', `──▘▘─▝▝${'─'.repeat(13)}`])
  expect(cellsWith(frameCells(w), 20, 0x5fd47a)).toEqual([])

  resize(w, 20, 5)
  expect(rows(frameCells(w), 20)).toEqual(['▗', ' ▚', ' ▐▛███▜▌', '▝▜█████▛▘', `──▘▘─▝▝${'─'.repeat(13)}`])
  expect(cellsWith(frameCells(w), 20, 0xa8a8a8)).toEqual(['1,1'])
  expect(cellsWith(frameCells(w), 20, 0x5fd47a)).toEqual(['0,0'])
  // It stands on the back edge and leans away from where Clawd faces.
  w.facing = -1
  expect(rows(frameCells(w), 20).slice(0, 2)).toEqual(['        ▖', '       ▞'])
  // Sitting, the head's top row is the lower half of a cell: the stalk is a pixel longer and the tip keeps its cell.
  w.facing = 1
  w.sitting = true
  expect(cellsWith(frameCells(w), 20, 0x5fd47a)).toEqual(['0,0'])
  expect(cellsWith(frameCells(w), 20, 0xa8a8a8)).toEqual(['0,1', '1,1'])
  w.sitting = false
  // The tip blinks: dim for 0.2 s every 1.6 s.
  w.t = 1.5
  expect(cellsWith(frameCells(w), 20, 0x5fd47a)).toEqual([])
  expect(cellsWith(frameCells(w), 20, 0x2f6b3d)).toEqual(['0,0'])

  const wearing = (look: object) => {
    const v = createWorld(30, 4, seeded(6))
    v.queue = []
    v.x = 20
    v.act = { ...idle }
    v.blinkAt = 999
    v.antenna = true
    v.wearing = emoteFrom(look) as Emote
    v.wornUntil = 99
    step(v)
    return v
  }
  // On a round head as tall as the MatSci octopus, the band grows to 6 rows and
  // the antenna stands on the head's top back edge, not on a tentacle.
  const HEAD = {
    name: 'head',
    title: 'a round head with tentacles',
    color: '#649feb',
    shapes: { normal: ['......######......', '....##########....', '...############...', '...###oo##oo###...', '...###oo##oo###...', '....##########....', '.###.###..###.###.'] },
    legs: [1, 6, 11, 16],
    legLength: 1,
    wiggle: true,
    armRow: 6,
    arms: { out: [[1, 0]] },
    tall: true,
    dur: 99,
  }
  const v = wearing(HEAD)
  expect(bandRows(v)).toBe(6)
  v.antenna = false
  expect(bandRows(v)).toBe(5)
  v.antenna = true
  resize(v, 30, 6)
  expect(rows(frameCells(v), 30).slice(0, 2)).toEqual(['      ▗', '       ▚▗▄▄▖'])
  expect(cellsWith(frameCells(v), 30, 0xa8a8a8)).toEqual(['7,1'])
  expect(cellsWith(frameCells(v), 30, 0x5fd47a)).toEqual(['6,0'])
  // On a look with a mark beside the head, it stands on the part with the eyes.
  const HUH = {
    name: 'huh',
    title: 'huh?',
    color: '#e8a33d',
    shapes: { normal: ['..............##.', '.............#..#', '................#', '############...#.', '##o######o##.....', '############...#.', '############.....'] },
    legs: [1, 3, 8, 10],
    legLength: 1,
    armRow: 4,
    tall: true,
    dur: 99,
  }
  const u = wearing(HUH)
  resize(u, 30, bandRows(u))
  expect(rows(frameCells(u), 30).slice(1, 3)).toEqual(['     ▖       ▄', '     ▝▖     ▝ ▌'])
  expect(cellsWith(frameCells(u), 30, 0x5fd47a)).toEqual(['5,1'])
  // A mini wears none.
  spawnMini(v, 'agent-1', 'a task', 'general-purpose')
  v.antenna = false
  expect(cellsWith(frameCells(v), 30, 0xa8a8a8)).toEqual([])
})

test('the mod reads Remote Control from the environment every second and puts the antenna on and takes it off', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  mock.store(on)
  const env: Record<string, string | undefined> = { HOME: '/home/t', CLAUDE_CLAWD_SEED: '7' }
  on('env.get', async ($, e) => ({ value: env[e.name] }))
  const blits: string[] = []
  on('ui.log', async () => ({ value: undefined }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('ui.blit', async ($, e) => {
    if ('cells' in e) blits.push(e.cells)
    return { value: {} }
  })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine band') as RenderElement
  })
  const tips = (from: number) => blits.slice(from).filter(c => cellsWith(c, 100, 0xa8a8a8).length > 0)
  const props = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} }
  const mountRows = async () => {
    const m = await $.ui.mount({ plugin: 'clawd', surface: 'terminal', component: 'AbovePrompt', props, viewport: { columns: 100, rows: 40 } })
    return (await m.find({ type: 'Raster', key: 'clawd' }))?.props.rows
  }
  const run = (args: string) =>
    $.command.run({ command: 'clawd', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

  await $.session.start({ cwd: '/home/t/proj', surface: 'terminal', isInteractive: true })
  await $.ui.mount({
    plugin: 'clawd',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
    viewport: { columns: 100, rows: 40 },
  })
  await clock.advance(2000) // Clawd walks in from the left
  expect(tips(0)).toEqual([])
  expect((await run(''))?.text).not.toContain('Remote Control')

  env.CLAUDE_CODE_BRIDGE_SESSION_ID = 'session_01abc'
  await clock.advance(2000)
  expect(tips(0).length).toBeGreaterThan(5)
  expect(await mountRows()).toBe(5)
  expect((await run(''))?.text).toContain('Remote Control is on, so it wears an antenna.')

  delete env.CLAUDE_CODE_BRIDGE_SESSION_ID
  await clock.advance(1100)
  const off = blits.length
  await clock.advance(1000)
  expect(blits.length).toBeGreaterThan(off)
  expect(tips(off)).toEqual([])
  expect(await mountRows()).toBe(4)
})

test('while Remote Control is on, the autopicker pauses and its setting stays on; it picks again when Remote Control ends', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  mock.store(on, { isAutopickOn: true })
  const env: Record<string, string | undefined> = { HOME: '/home/t', CLAUDE_CLAWD_SEED: '7', CLAUDE_CODE_BRIDGE_SESSION_ID: 'session_01abc' }
  on('env.get', async ($, e) => ({ value: env[e.name] }))
  const triggers: string[] = []
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('ui.log', async () => ({ value: undefined }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('ui.blit', async () => ({ value: {} }))
  on('process.run', async () => ({
    value: { exitCode: 0, stdout: 'Sat 17:00\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('model.complete', async ($, e) => {
    triggers.push(/trigger: ([^\n]*)/.exec(e.prompt)?.[1] ?? e.prompt.slice(0, 40))
    const text = '{"summary": "", "calls": [{"who": "clawd", "play": "wave"}], "why": "", "new": null}'
    return { value: { isAnswered: true as const, text, usage } }
  })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine band') as RenderElement
  })
  const run = (args: string) =>
    $.command.run({ command: 'clawd', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

  await $.session.start({ cwd: '/home/t/proj', surface: 'terminal', isInteractive: true })
  await $.ui.mount({
    plugin: 'clawd',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 40, scroll: { offset: 0, bodyRows: 20 }, view: {} },
    viewport: { columns: 100, rows: 40 },
  })
  await clock.advance(61_000)
  expect(triggers).toEqual([])
  expect((await run(''))?.text).toContain('The autopicker is paused while Remote Control is on')
  expect((await run('autopick on'))?.text).toContain('It is paused while Remote Control is on')
  await clock.advance(61_000)
  expect(triggers).toEqual([])
  // Asked for, it picks once while paused.
  await run('autopick now')
  await clock.advance(200)
  expect(triggers).toEqual(['asked with /clawd autopick now'])

  // Clawd falls asleep 180 s after the last session event and then skips timer
  // picks; a wave keeps it awake for the next wait.
  await run('wave')
  delete env.CLAUDE_CODE_BRIDGE_SESSION_ID
  await clock.advance(70_000) // a 1 s poll, then a pick within 10 to 60 s
  expect(triggers.length).toBeGreaterThan(1)
  expect((await run(''))?.text).not.toContain('paused')
})

test("the session's model runs /clawd commands through the clawd tool behind ToolSearch; its calls stack no brick, and a create it starts waits for the daily limit", async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/t', CLAUDE_CLAWD_SEED: '7' })
  const data = '/home/t/.claude/clawd'
  const files = new Map<string, string>()
  const registered: { name: string; isDeferred?: unknown; inputSchema?: unknown }[] = []
  const prompts: string[] = []
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('ui.log', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('tool.register', async ($, e) => {
    registered.push(e)
    return { value: { tool: `mcp__clawd__${e.name}` } }
  })
  let verdict: 'allow' | 'ask' | 'deny' = 'allow'
  // $.ui.ask is a call of AskUserQuestion, which runs.
  on('tool.check', async ($, e) => (e.tool === 'AskUserQuestion' ? { decision: 'allow' as const } : { decision: verdict, reason: 'plan mode' }))
  const asked: string[] = []
  let answer = 'Refuse'
  on('tool.call', async ($, e) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'edited' }
    const question = e.questions[0]?.question ?? ''
    asked.push(question)
    return { result: { questions: e.questions, answers: { [question]: answer } } as never }
  })
  on('ui.blit', async () => ({ value: {} }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: 'Sat 17:00\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.stat', async ($, e) => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('fs.list', async ($, e) => ({
    value: [...files.keys()]
      .filter(p => p.startsWith(`${e.path}/`) && !p.slice(e.path.length + 1).includes('/'))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async ($, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', async ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('session.id', async () => ({ value: 'sess-1' }))
  on('model.complete', async ($, e) => {
    prompts.push(e.prompt)
    const text = e.model === 'haiku' ? '{"summary": "", "calls": [], "why": "", "new": null}' : '{"steps": [{"do": "hop", "n": 2}]}'
    return { value: { isAnswered: true as const, text, usage } }
  })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine band') as RenderElement
  })

  await $.session.start({ cwd: '/home/t/proj', surface: 'terminal', isInteractive: true })
  await $.ui.mount({
    plugin: 'clawd',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
    viewport: { columns: 100, rows: 40 },
  })
  await clock.advance(200)
  const run = (args: string) =>
    $.command.run({ command: 'clawd', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  // The tool is not in the engine's list of tool names until the mod has loaded once, hence the cast.
  const tool = async (command: string) => {
    const r = await $.tool.call({ tool: 'mcp__clawd__clawd', command } as never)
    return 'result' in r ? r.result : r
  }

  // One tool, its schema loaded when a model asks for it (the engine's default), and the maker's render tool behind ToolSearch.
  expect(registered.map(t => [t.name, t.isDeferred])).toEqual([['clawd', undefined], ['render', true]])
  expect(registered[0]?.inputSchema).toMatchObject({ required: ['command'] })

  // It answers as /clawd does, with or without the leading /clawd.
  expect(await tool('act jump 2')).toBe('Clawd: jump ×2.')
  expect(await tool('/clawd wave')).toBe('Clawd: wave.')
  expect(await tool('list minis')).toBe(((await run('list minis'))?.text ?? '') as string)
  expect(await tool('frog')).toBe('Clawd: nothing is called "frog". /clawd help shows what there is.')
  await clock.advance(100)
  expect(await tool('')).toContain('Clawd on: wave')
  expect(await tool('help uml')).not.toContain('lines wrap')

  // Its own calls are no work: the picker reads the other tool's call and not the clawd tool's.
  await $.tool.call({ tool: 'Write', file_path: '/home/t/proj/a.txt', content: 'x' } as never)
  await run('autopick now')
  await clock.advance(10)
  expect(prompts.at(-1)).toContain('tool Write ok: /home/t/proj/a.txt')
  expect(prompts.at(-1)).not.toContain('mcp__clawd__clawd')

  // A create or change the model starts waits for the daily limit; the person's typed one does not.
  const made = new Date(1_700_000_000_000 - 3600_000).toISOString()
  for (const name of ['spin_one', 'spin_two', 'spin_three', 'spin_four', 'spin_five']) {
    files.set(`${data}/acts/${name}.json`, JSON.stringify({ name, title: name, steps: [{ do: 'hop' }], made, project: 'proj', why: '' }))
  }
  const refused = 'Clawd: 5 acts, emotes and skins were made in the last 24 hours, and a model may start a create or change only below 5.'
  expect(await tool('act create cartwheel')).toBe(`${refused} The person can still type /clawd act create.`)
  expect(await tool('skin create frog')).toBe(`${refused} The person can still type /clawd skin create.`)
  expect(await tool('act change spin_one faster')).toBe(`${refused} The person can still type /clawd act change.`)
  expect(await tool('act spin_one')).toBe('Clawd: spin_one.')
  expect((await run('act create cartwheel'))?.text).toBe('Clawd: opus writes cartwheel, in a minute or two; it plays when done.')

  // A command that changes something asks the engine's permission check first, as the
  // tool's own answer comes before it; on an ask the person decides. Plays need no check.
  verdict = 'deny'
  expect(await tool('off')).toBe('Clawd: /clawd off is not allowed here: plan mode')
  expect(await tool('act wave')).toBe('Clawd: wave.')
  verdict = 'ask'
  expect(await tool('act delete spin_one')).toBe('Clawd: the person refused /clawd act delete spin_one.')
  answer = 'Allow'
  expect(await tool('trace')).toContain('each autopick now goes to')
  expect(asked).toEqual(['A model wants to run /clawd act delete spin_one. Allow it?', 'A model wants to run /clawd trace. Allow it?'])
})

test('a make runs one maker agent: it renders drafts, may Read only what it was given, and the last draft it rendered alone is kept', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/t', CLAUDE_CLAWD_SEED: '7' })
  const data = '/home/t/.claude/clawd'
  const files = new Map<string, string>()
  const pngs: string[] = []
  const claudeRuns: string[] = []
  const spawned: { prompt: string; subagentType?: string }[] = []
  on('ui.log', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('tool.register', async ($, e) => ({ value: { tool: `mcp__clawd__${e.name}` } }))
  on('agent.register', async ($, e) => ({ value: { agent: `clawd:${e.name}` } }))
  on('agent.list', async () => ({ value: [] }))
  // The test engine raises the mod's spawn with the Agent tool's input and reads the
  // agent id from the Agent tool's result, hence the casts.
  on('agent.spawn', async ($, e) => {
    const input = e as unknown as { subagent_type?: string; description: string }
    spawned.push({ prompt: e.prompt, subagentType: input.subagent_type })
    const agentId = `maker-${spawned.length}`
    return { model: 'opus', agentId, result: { status: 'async_launched', agentId, description: input.description } } as never
  })
  on('tool.call', async () => ({ result: 'read it' }))
  on('tool.check', async () => ({ decision: 'allow' as const }))
  on('turn.complete', async () => ({ text: '' }))
  on('ui.blit', async () => ({ value: {} }))
  on('process.run', async ($, e) => {
    if (e.argv[0] === 'python3') pngs.push(e.argv[3] ?? '')
    if (e.argv[0] === 'claude') claudeRuns.push(e.init?.stdin ?? '')
    return { value: { exitCode: 0, stdout: 'Sat 17:00\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.stat', async ($, e) => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('fs.list', async ($, e) => ({
    value: [...files.keys()]
      .filter(p => p.startsWith(`${e.path}/`) && !p.slice(e.path.length + 1).includes('/'))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async ($, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', async ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine band') as RenderElement
  })

  await $.session.start({ cwd: '/home/t/proj', surface: 'terminal', isInteractive: true })
  await $.ui.mount({
    plugin: 'clawd',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
    viewport: { columns: 100, rows: 40 },
  })
  await clock.advance(200)
  const run = (args: string) =>
    $.command.run({ command: 'clawd', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  // The render tool and the maker's agent id are not in the engine's lists until the mod has loaded once, hence the casts.
  const call = async (input: Record<string, unknown>) => {
    const r = await $.tool.call(input as never)
    return { text: 'result' in r ? String(r.result) : String(r.text ?? ''), isError: 'isError' in r && r.isError === true }
  }

  // The maker is never offered to a model.
  expect(await $.agent.offer({ agent: 'clawd:maker', description: '', source: 'plugin', provider: { plugin: 'clawd', tier: 'user' } })).toEqual({ isOffered: false })

  // A new skin: the band's render starts one maker, which is told how to render and look.
  await run('skin create frog a green frog')
  await clock.advance(100)
  expect(spawned.map(s => s.subagentType)).toEqual(['clawd:maker'])
  expect(spawned[0]?.prompt).toContain('hand it a draft\nas {"draft": {...}}')
  expect(spawned[0]?.prompt).toContain('Start with 3 drafts side by side')
  const maker = 'maker-1'

  // It may Read nothing it was not given, and nobody else may render.
  expect((await call({ tool: 'Read', file_path: '/etc/hostname', agentId: maker })).isError).toBe(true)
  expect((await call({ tool: 'mcp__clawd__render', draft: OCTOPUS })).isError).toBe(true)
  // A refused draft says why and draws nothing.
  const bad = await call({ tool: 'mcp__clawd__render', draft: { color: '#40c060' }, agentId: maker })
  expect(bad.text).toContain('Draft 1 was refused')
  expect(pngs.filter(p => p.includes('/frog.r'))).toEqual([])
  // Drafts side by side go on one sheet; the one rendered alone after that is the one kept.
  const sheet = await call({ tool: 'mcp__clawd__render', drafts: [OCTOPUS, { ...OCTOPUS, color: '#40c060' }], agentId: maker })
  expect(sheet.text).toBe(`Rendered 2 drafts to ${data}/skins/previews/frog.r1.png. Read it.`)
  const alone = await call({ tool: 'mcp__clawd__render', draft: { ...OCTOPUS, color: '#40c060' }, agentId: maker })
  expect(alone.text).toBe(`Rendered the draft to ${data}/skins/previews/frog.r2.png. Read it.`)
  expect((await call({ tool: 'Read', file_path: `${data}/skins/previews/frog.r2.png`, agentId: maker })).text).toBe('read it')
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', agentId: maker, reason: 'answer' })
  await clock.advance(100)
  const saved = JSON.parse(files.get(`${data}/skins/frog.json`) ?? '{}')
  expect([saved.name, saved.title, saved.color]).toEqual(['frog', 'a blue octopus', '#40c060'])
  expect(claudeRuns).toEqual([])

  // A maker that renders nothing in its time is refused from then on, and nothing is saved.
  await run('act create cartwheel')
  await clock.advance(100)
  expect(spawned[1]?.prompt).toContain('{"draft": {"steps": [...]}}')
  for (let i = 0; i < 31; i++) await clock.advance(30_000)
  const late = await call({ tool: 'mcp__clawd__render', draft: { steps: [{ do: 'hop' }] }, agentId: 'maker-2' })
  expect([late.isError, late.text]).toEqual([true, expect.stringContaining('the time for this make is up')])
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't2', agentId: 'maker-2', reason: 'answer' })
  await clock.advance(100)
  expect(files.has(`${data}/acts/cartwheel.json`)).toBe(false)
  expect((await run(''))?.text).toContain('cartwheel: the maker rendered no usable draft')

  // A maker that rendered but never answers fails too: its last draft is not saved.
  await run('act create spin')
  await clock.advance(100)
  expect((await call({ tool: 'mcp__clawd__render', draft: { steps: [{ do: 'hop' }] }, agentId: 'maker-3' })).isError).toBe(false)
  for (let i = 0; i < 45; i++) await clock.advance(30_000)
  expect(files.has(`${data}/acts/spin.json`)).toBe(false)
  expect((await run(''))?.text).toContain('spin: the maker did not answer in time for spin')
})
