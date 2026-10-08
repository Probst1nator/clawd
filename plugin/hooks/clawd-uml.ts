// `/clawd help uml` (user, 2026-10-06: "a uml diagram which can be displayed
// via /clawd help which shows the way clawd behaves and new movements are
// created and registered"). A command's answer is transcript text, so the
// diagrams are box-drawing characters, at most UML_WIDTH columns wide. A
// CommandOutput render hook in register.tsx colours them by umlKinds (user,
// 2026-10-06: "can you make the clawd uml colored?"); the stored row stays
// plain text. Pure, no `$`: register.tsx passes the numbers in, so a changed
// constant shows here too.

/** The numbers and model names the diagrams name. */
export type UmlFacts = {
  sleepAfterS: number // idle seconds before Clawd falls asleep
  readHoldS: number // the scroll stays up this long after the last reading call
  miniStaleS: number // a mini whose subagent was silent this long leaves
  maxMinis: number
  pickMinS: number
  pickMaxS: number
  maxDelayS: number // a pick's calls start up to this far apart
  newPerDay: number // new acts and emotes the autopicker may ask for in 24 h
  maxSteps: number // steps in a made act
  emoteDrafts: number
  emoteRounds: number
  pickModel: string
  makeModel: string
}

export const UML_WIDTH = 78

const cells = (s: string) => [...s].length
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - cells(s)))

/** A UML state or action: a rounded box `inner` cells wide; a state's name gets a compartment of its own. */
function node(inner: number, lines: readonly string[], name?: string): string[] {
  const rule = '─'.repeat(inner + 2)
  return [
    `╭${rule}╮`,
    ...(name === undefined ? [] : [`│ ${pad(name, inner)} │`, `├${rule}┤`]),
    ...lines.map(l => `│ ${pad(l, inner)} │`),
    `╰${rule}╯`,
  ]
}

/** A UML note: a square box `inner` cells wide. */
function note(inner: number, lines: readonly string[]): string[] {
  const rule = '─'.repeat(inner + 2)
  return [`┌${rule}┐`, ...lines.map(l => `│ ${pad(l, inner)} │`), `└${rule}┘`]
}

/** Blocks side by side, row by row, each padded to its width. */
function beside(...blocks: [width: number, rows: readonly string[]][]): string[] {
  const height = Math.max(...blocks.map(([, rows]) => rows.length))
  return Array.from({ length: height }, (_, i) => blocks.map(([w, rows]) => pad(rows[i] ?? '', w)).join('').trimEnd())
}

/** One row, each text starting at its column. */
function at(...parts: [col: number, text: string][]): string {
  let row = ''
  for (const [col, text] of parts) row = pad(row, col) + text
  return row
}

/** Clawd itself: idle, work and asleep, and what moves it between them. */
function clawdStates(f: UmlFacts): string[] {
  const up = 59 // the column of the line from Asleep up to Work
  return [
    '1. Clawd (UML state machine)',
    '',
    '   ●  session start / Clawd walks in and waves',
    '   │',
    '   ▼',
    ...beside(
      [26, node(22, ['do / random acts from', '     the idle table', '', '', ''], 'Idle')],
      [22, ['', '  prompt sent', '  / alert, hop,', '    kick [1]', `${'─'.repeat(21)}▶`, '', `◀${'─'.repeat(21)}`, '  turn ends / [4]']],
      [28, node(24, ['do / random acts from', '     the work table', 'read call / scroll [2]', 'other call / carry [3]', ''], 'Work')],
    ),
    at([3, '│'], [17, '▲'], [up, '▲']),
    at([3, '│'], [5, `after ${f.sleepAfterS} s`], [17, '│'], [19, 'failed call / trip,'], [up, '│'], [up + 2, 'prompt sent']),
    at([3, '│'], [5, 'without an'], [17, '│'], [19, '/clawd <act>'], [up, '│'], [up + 2, '/ wake, kick [1]']),
    at([3, '│'], [5, 'event'], [17, '│'], [up, '│']),
    at([3, '▼'], [17, '│'], [up, '│']),
    ...beside([26, node(22, ['do / sleep'], 'Asleep')], [up - 26 + 1, ['', '', '', `${'─'.repeat(up - 26)}┘`, '']]).map((row, i) =>
      i < 3 ? at([0, row], [up, '│']) : row,
    ),
    '',
    ...note(72, [
      'In every state',
      'failed tool call / trip',
      '/clawd <act> / the act plays at once and cuts in on anything',
      `autopick / ${f.pickModel} calls acts for Clawd and the minis, up to ${f.maxDelayS} s apart.`,
      `   After /clawd autopick on, it picks every ${f.pickMinS} to ${f.pickMaxS} s and right after a`,
      '   prompt, a turn end and a subagent starting or ending. A call cuts in',
      '   on a random act and waits while Clawd reacts to a session event.',
      '   Asleep with no mini, the timer picks nothing; a pick that does play',
      '   ends in sleep again.',
    ]),
    '[1] kick: only while bricks lie on the pile; Clawd kicks it over.',
    `[2] scroll: held up until ${f.readHoldS} s after the last call that only reads (Read, or`,
    '    a Bash call the engine judges read-only). It cuts a random act short.',
    '[3] carry: Clawd fetches a brick for the pile, until the pile is full.',
    '    The turn end drops the bricks still waiting.',
    '[4] celebrate; trip after an error; look and think when you stopped it.',
  ]
}

/** A mini Clawd, from its subagent's start until it has run off. */
function miniStates(f: UmlFacts): string[] {
  const back = 60 // the column of the line from Mini round to Leaving
  const leaving = node(13, ['do / run off', '     the band'], 'Leaving')
  return [
    `2. A mini Clawd (UML state machine): one per running subagent, at most ${f.maxMinis}.`,
    '',
    '   ●  subagent starts / a mini runs in from an edge, alert',
    '   │',
    '   ▼',
    ...beside(
      [28, node(24, ['do / random acts from', '     the mini table', 'its read call / scroll', 'its other call / carry', 'its failed call / trip'], 'Mini (a1, a2, ...)')],
      [24, ['', '  subagent ends', '  / celebrate, or trip', '  without an answer', `${'─'.repeat(23)}▶`]],
      [26, [...leaving.map((row, i) => (i === 4 ? `${row} ──▶ ◉` : row)), at([back - 52, '▲']), at([back - 52, '│']), at([back - 52, '│'])]],
    ),
    at([3, '│'], [5, `${Math.round(f.miniStaleS / 60)} min without an event / trip`], [back, '│']),
    at([3, `└${'─'.repeat(back - 4)}┘`]),
  ]
}

/** Two blocks of the activity diagram side by side, the shorter one's flow line drawn on to the same height. */
function pair(left: readonly string[], right: readonly string[]): string[] {
  const height = Math.max(left.length, right.length)
  const fill = (rows: readonly string[]) => [...rows, ...Array<string>(height - rows.length).fill('   │')]
  return beside([40, fill(left)], [37, fill(right)])
}

/** How a new act or emote comes about, and how Clawd finds it afterwards. */
function making(f: UmlFacts): string[] {
  const right = 43 // the column of the emote flow
  return [
    '3. A new act or emote (UML activity diagram)',
    '',
    at([3, '●  autopick'], [right, '●  /clawd emote create or change']),
    at([3, '▼'], [right, '│']),
    ...beside(
      [right, node(36, [`${f.pickModel} reads what happened and every`, 'name; it answers with calls, why and', 'new: an act or a look it wants'])],
      [1, ['│', '│', '│', '│', '│']],
    ),
    at([3, '│ plays the calls'], [right, '│']),
    at([3, `◇──[no new, or ${f.newPerDay} made in 24 h]──▶ ◉`], [right, '│']),
    at([3, '◇──[the name exists]──▶ play it ──▶ ◉'], [right, '│']),
    at([3, `◇──[new.look]${'─'.repeat(right - 16)}┤`]),
    at([3, '│ [a move]'], [right, '│ [no emote being drawn]']),
    at([3, '▼'], [right, '▼']),
    ...pair(
      node(34, [`${f.makeModel} writes 1 to ${f.maxSteps} steps from the`, 'pickable acts and pose, mark and', 'sparks (makeAct)']),
      node(33, [
        `${f.makeModel} draws it in up to ${f.emoteRounds} rounds:`,
        `${f.emoteDrafts} drafts on one sheet; it picks`,
        'one and fixes it, then checks its',
        'preview. A change starts from the',
        'emote as it is.',
        '(drawEmote; claude -p per round)',
      ]),
    ),
    at([3, '◇──[routineFrom refuses]──▶ ◉'], [right, '◇──[no usable draft]──▶ ◉']),
    at([3, '▼'], [right, '▼']),
    ...pair(
      node(34, ['write acts/<name>.json in the', 'data folder']),
      node(33, ['write emotes/<name>.json and a', 'preview PNG in the data folder; a', 'change moves the old file to', 'emotes/old/ there']),
    ),
    at([3, '▼'], [right, '▼']),
    ...pair(node(34, ['play it on new.for, or on Clawd']), node(33, ['Clawd plays it'])),
    at([3, '▼'], [right, '▼']),
    at([3, '◉'], [right, '◉']),
    '',
    ...note(72, [
      'Registered: there is no list to add a name to. Each autopick, each',
      '/clawd and the menu while you type read acts/ and emotes/ in the data',
      "folder and the plugin's emotes/ afresh. The next pick offers the new",
      `name to ${f.pickModel}, and /clawd <name> and /clawd list take it at once,`,
      'without a reload. A file that fails the check is skipped. A hand-drawn',
      "emote in the plugin wins over a model's of the same name. /clawd emote",
      'delete moves an emote to old/. The data folder is clawd/ in the Claude',
      'config folder (~/.claude), or data/ beside the plugin in a checkout.',
      'Skins are drawn the same way by /clawd skin create or change, into',
      'skins/; Clawd wears a new one for the session instead of playing it.',
    ]),
    'A built-in act is code: its name in ACTS and a case in runAct (clawd-sim.ts),',
    'a line in PICKABLE so models and made acts may use it, a weight in a random',
    'table if it should play by itself, then /reload-plugins.',
  ]
}

/** The first line of the diagrams; the render hook finds the answer by it. */
export const UML_LEGEND = 'Read as UML: ╭╮ a state or an action, ● start, ◉ end, ◇ a decision, [a guard],'

/** The three diagrams, one line per row. */
export function clawdUml(f: UmlFacts): string[] {
  return [
    UML_LEGEND,
    'event / what Clawd does.',
    '',
    ...clawdStates(f),
    '',
    ...miniStates(f),
    '',
    ...making(f),
  ]
}

/** What a run of cells in the diagrams is; register.tsx gives each kind its colour. */
export type UmlKind = 'text' | 'heading' | 'state' | 'name' | 'note' | 'flow' | 'end' | 'guard' | 'footnote'

const BOXES = [
  { kind: 'state', corners: '╭╮╰╯' },
  { kind: 'note', corners: '┌┐└┘' },
] as const
const FLOW = new Set([...'─│┤├┘└┐┌▶◀▲▼'])

/**
 * Each line cut into runs of one kind. A box's frame is found by walking its
 * edges from the top left corner, and the row above a `├` divider is the
 * state's name. The rest goes by character, brackets and the heading's number.
 */
export function umlKinds(lines: readonly string[]): { text: string; kind: UmlKind }[][] {
  const grid = lines.map(l => [...l])
  const ch = (r: number, c: number) => grid[r]?.[c] ?? ''
  const kinds = grid.map(row => row.map((): UmlKind | undefined => undefined))
  const mark = (r: number, c: number, kind: UmlKind) => {
    const row = kinds[r]
    if (row && c < row.length) row[c] = kind
  }
  grid.forEach((row, r) =>
    row.forEach((corner, c) => {
      for (const { kind, corners } of BOXES) {
        if (corner !== corners[0]) continue
        let right = c + 1
        while (ch(r, right) === '─') right++
        let bottom = r + 1
        while (ch(bottom, c) === '│' || ch(bottom, c) === '├') bottom++
        if (right === c + 1 || ch(r, right) !== corners[1] || ch(bottom, c) !== corners[2] || ch(bottom, right) !== corners[3]) continue
        for (let y = r; y <= bottom; y++) {
          const isRule = y === r || y === bottom || ch(y, c) === '├'
          for (let x = c; x <= right; x++) if (isRule || x === c || x === right) mark(y, x, kind)
          if (ch(y, c) === '├') for (let x = c + 1; x < right; x++) mark(y - 1, x, 'name')
        }
      }
    }),
  )
  return grid.map((row, r) => {
    const line = lines[r] ?? ''
    const marks = kinds[r] ?? []
    for (const m of line.matchAll(/\[[^\]]+\]/g)) {
      const from = cells(line.slice(0, m.index))
      for (let x = from; x < from + cells(m[0]); x++) marks[x] ??= /^\[\d\]$/.test(m[0]) ? 'footnote' : 'guard'
    }
    const runs: { text: string; kind: UmlKind }[] = []
    row.forEach((cell, c) => {
      const kind =
        marks[c] ??
        ('●◉'.includes(cell) ? 'end' : cell === '◇' ? 'guard' : '╭╮╰╯'.includes(cell) ? 'state' : FLOW.has(cell) ? 'flow' : /^\d\. /.test(line) ? 'heading' : 'text')
      const last = runs[runs.length - 1]
      if (last?.kind === kind) last.text += cell
      else runs.push({ text: cell, kind })
    })
    return runs
  })
}
