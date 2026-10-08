// `/clawd` as typed (user, 2026-10-04: "make this easier to use", then
// "autocomplete and stuff"). A word may be cut short while it fits one name
// (`/clawd cel` plays celebrate). While the person types, a framed list
// above the prompt shows the names the word at the cursor fits (`menuFor`;
// user, 2026-10-05: a dropdown list in a box, Clawd standing on its top edge),
// the words are painted green (fits one name) or red (fits none), and a space
// after a word that fits one name writes it out. Tab never reaches a plugin, so
// the space does its job. Pure, no `$`: register.tsx passes the names in and
// draws what comes back.

export const MAX_REPEAT = 5 // `/clawd jump 3`: at most this many in a row

/** The words `/clawd` takes besides acts, emotes and minis, with what each does. */
export const COMMANDS: Readonly<Record<string, string>> = {
  help: 'what Clawd plays and every command; help uml draws it',
  act: 'Clawd plays an act: a move such as jump or wave',
  emote: "Clawd takes an emote's look for a while; emote create, change, delete, preview",
  skin: "Clawd's body for this session: a skin, auto or none; skin create, change, delete, preview",
  list: 'the names of one kind: acts, made, emotes, skins or minis',
  on: 'show Clawd (remembered)',
  off: 'hide Clawd (remembered)',
  autopick: 'switch the model picker on or off; now picks once; haiku (default), sonnet or opus sets its model',
  trace: 'switch writing each autopick to a file on or off',
  debug: "switch showing each autopick's whole reply here on or off",
}
/**
 * What `/clawd emote` takes besides an emote's name (user, 2026-10-07: all
 * emote work under `/clawd emote`). No emote may take one of these names.
 */
export const EMOTE_COMMANDS: Readonly<Record<string, string>> = {
  create: 'a model draws a new emote (uses your Claude usage)',
  change: "a model changes an emote's look (uses your Claude usage); edit and modify work too",
  delete: 'remove an emote; the file goes to emotes/old/',
  preview: 'a PNG of an emote in every pose',
}
/**
 * What `/clawd skin` takes besides a skin's name (user, 2026-10-08: skins
 * apart from emotes). No skin may take one of these names.
 */
export const SKIN_COMMANDS: Readonly<Record<string, string>> = {
  auto: 'the skin clawd.json or the project folder gives; the default',
  none: "Clawd's own body for this session",
  create: 'a model draws a new skin (uses your Claude usage)',
  change: "a model changes a skin's look (uses your Claude usage); edit and modify work too",
  delete: 'remove a skin; the file goes to skins/old/',
  preview: 'a PNG of a skin in every pose',
}
/** What `/clawd list` takes. */
export const LIST_KINDS = {
  acts: 'the built-in acts',
  made: 'acts a model wrote',
  emotes: 'looks Clawd takes for a while',
  skins: 'bodies Clawd wears all the time instead of its own',
  minis: 'small Clawds, one per running subagent',
} as const
export type ListKind = keyof typeof LIST_KINDS
/** Other words for commands, taken only in full and never offered. */
export const ALIASES: Readonly<Record<string, string>> = { '?': 'help', ls: 'list', edit: 'change', modify: 'change' }
const WHAT: Readonly<Record<string, string>> = { ...COMMANDS, ...EMOTE_COMMANDS }
/** Commands that start a model run or remove something run only when typed in full, with why. */
const IN_FULL: Readonly<Record<string, string>> = {
  create: 'it starts a model run',
  change: 'it starts a model run',
  delete: 'it removes an emote',
}
/** Commands whose emote or skin must be named in full. */
const WHOLE_EMOTE = ['change', 'delete']

export type Kind = 'command' | 'mini' | 'emote' | 'skin' | 'made' | 'act'
/** The names a word may take now, each with a short description, in the order offered. */
export type Names = {
  minis: Readonly<Record<string, string>>
  emotes: Readonly<Record<string, string>>
  skins: Readonly<Record<string, string>>
  made: Readonly<Record<string, string>>
  acts: Readonly<Record<string, string>>
}
export type Fit = { kind: Kind; name: string; what: string }

const TABLES = { mini: 'minis', emote: 'emotes', skin: 'skins', made: 'made', act: 'acts' } as const
/** What a menu row says before the description when names of several kinds are listed. */
const KIND_WORD: Record<Kind, string> = { command: '', mini: '', emote: 'emote', skin: 'skin', made: 'made act', act: 'act' }
const FIRST: Kind[] = ['command', 'mini', 'emote', 'made', 'act']
const PLAYS: Kind[] = ['act', 'made']
const LIST_ROWS: Fit[] = Object.entries(LIST_KINDS).map(([name, what]) => ({ kind: 'command', name, what }))
const EMOTE_ROWS: Fit[] = Object.entries(EMOTE_COMMANDS).map(([name, what]) => ({ kind: 'command', name, what }))
const SKIN_ROWS: Fit[] = Object.entries(SKIN_COMMANDS).map(([name, what]) => ({ kind: 'command', name, what }))
const TRACE_ROWS: Fit[] = [
  { kind: 'command', name: 'on', what: 'write each autopick to a file' },
  { kind: 'command', name: 'off', what: 'stop writing the autopicks' },
]
const DEBUG_ROWS: Fit[] = [
  { kind: 'command', name: 'on', what: "each autopick's reply, tokens and outcome in the transcript, not sent to the model" },
  { kind: 'command', name: 'off', what: 'stop showing them' },
]
const AUTOPICK_ROWS: Fit[] = [
  { kind: 'command', name: 'now', what: 'a model chooses what plays next, once (uses your Claude usage)' },
  { kind: 'command', name: 'on', what: 'a model chooses every 10 to 60 s (remembered; uses your Claude usage)' },
  { kind: 'command', name: 'off', what: 'random acts only, no model calls (remembered)' },
  { kind: 'command', name: 'haiku', what: 'Haiku picks: the default and the cheapest (remembered)' },
  { kind: 'command', name: 'sonnet', what: 'Sonnet picks: more of your Claude usage per pick (remembered)' },
  { kind: 'command', name: 'opus', what: 'Opus picks: the most of your Claude usage per pick (remembered)' },
]
const HELP_ROWS: Fit[] = [{ kind: 'command', name: 'uml', what: 'how Clawd behaves and how new acts are made, as UML' }]

function table(kinds: readonly Kind[], names: Names): Fit[] {
  const out: Fit[] = []
  for (const kind of kinds) {
    const rows = kind === 'command' ? COMMANDS : names[TABLES[kind]]
    for (const [name, what] of Object.entries(rows)) if (!out.some(f => f.name === name)) out.push({ kind, name, what })
  }
  return out
}

/** The names a typed word fits: the name itself, else the names it starts, else those it is part of. */
export function fitsOf(word: string, rows: readonly Fit[]): Fit[] {
  const w = word.toLowerCase()
  const alias = ALIASES[w]
  if (alias && rows.some(f => f.kind === 'command' && f.name === alias)) return [{ kind: 'command', name: w, what: WHAT[alias] ?? '' }]
  const exact = rows.filter(f => f.name === w)
  if (exact.length > 0) return exact
  const starts = rows.filter(f => f.name.startsWith(w))
  return starts.length > 0 ? starts : rows.filter(f => f.name.includes(w))
}

/** The names of these kinds a typed word fits. */
export function namesFit(word: string, kinds: readonly Kind[], names: Names): Fit[] {
  return fitsOf(word, table(kinds, names))
}

/** After `/clawd emote`: its commands, then the emotes. */
function emoteRows(names: Names): Fit[] {
  return [...EMOTE_ROWS, ...table(['emote'], names)]
}

/** After `/clawd skin`: auto, none and its commands, then the skins. */
function skinRows(names: Names): Fit[] {
  return [...SKIN_ROWS, ...table(['skin'], names)]
}

function onlyFit(word: string, rows: readonly Fit[]): Fit | undefined {
  const fits = fitsOf(word, rows)
  return fits.length === 1 ? fits[0] : undefined
}

/** What the next word may be, after the words before it; `of` names the rows' kind. */
type Place = { rows: Fit[]; of: string } | { free: string } | { count: true } | { end: true }
const END: Place = { end: true }
const COUNT: Place = { count: true }

function placeAfter(before: readonly string[], names: Names): Place {
  const [first, ...rest] = before
  if (first === undefined) return { rows: table(FIRST, names), of: 'names' }
  const fit = onlyFit(first, table(FIRST, names))
  if (!fit) return END
  const name = ALIASES[fit.name] ?? fit.name
  // After a mini or `act`: an act, then how many times.
  if (fit.kind === 'mini' || (fit.kind === 'command' && name === 'act')) {
    const [act] = rest
    if (act === undefined) return { rows: table(PLAYS, names), of: 'acts' }
    return rest.length === 1 && onlyFit(act, table(PLAYS, names)) ? COUNT : END
  }
  if (fit.kind === 'act' || fit.kind === 'made') return rest.length === 0 ? COUNT : END
  if (fit.kind !== 'command') return END
  if (name === 'emote') return emotePlace(rest, names)
  if (name === 'skin') return skinPlace(rest, names)
  if (rest.length > 0) return END
  if (name === 'list') return { rows: LIST_ROWS, of: 'kinds' }
  if (name === 'trace') return { rows: TRACE_ROWS, of: 'words' }
  if (name === 'debug') return { rows: DEBUG_ROWS, of: 'words' }
  if (name === 'autopick') return { rows: AUTOPICK_ROWS, of: 'words' }
  if (name === 'help') return { rows: HELP_ROWS, of: 'words' }
  return END
}

/** What comes after `/clawd emote` and these words: a command or an emote, then the command's words. */
function emotePlace(rest: readonly string[], names: Names): Place {
  const [first, ...more] = rest
  if (first === undefined) return { rows: emoteRows(names), of: 'names' }
  const fit = onlyFit(first, emoteRows(names))
  if (!fit || fit.kind !== 'command') return END
  const verb = ALIASES[fit.name] ?? fit.name
  if (verb === 'create') return more.length === 0 ? { free: '<new_name> in snake_case' } : { free: '[image path] <what it looks like>' }
  if (more.length === 0) return { rows: table(['emote'], names), of: 'emotes' }
  return verb === 'change' ? { free: '[image path] <what to change>' } : END
}

/** What comes after `/clawd skin` and these words: auto, none, a command or a skin, then the command's words. */
function skinPlace(rest: readonly string[], names: Names): Place {
  const [first, ...more] = rest
  if (first === undefined) return { rows: skinRows(names), of: 'names' }
  const fit = onlyFit(first, skinRows(names))
  if (!fit || fit.kind !== 'command') return END
  const verb = ALIASES[fit.name] ?? fit.name
  if (verb === 'auto' || verb === 'none') return END
  if (verb === 'create') return more.length === 0 ? { free: '<new_name> in snake_case' } : { free: '[image path] <what it looks like>' }
  if (more.length === 0) return { rows: table(['skin'], names), of: 'skins' }
  return verb === 'change' ? { free: '[image path] <what to change>' } : END
}

type Word = { text: string; start: number; end: number }

/** The words after `/clawd `, with their offsets; undefined for any other draft. */
function wordsOf(draft: string): Word[] | undefined {
  const head = /^\s*\/clawd(?=\s)/.exec(draft)
  if (!head) return undefined
  const out: Word[] = []
  const re = /\S+/g
  re.lastIndex = head[0].length
  for (let m = re.exec(draft); m; m = re.exec(draft)) out.push({ text: m[0], start: m.index, end: m.index + m[0].length })
  return out
}

/** True for a draft that is a `/clawd` command with arguments to come. */
export function isClawdDraft(draft: string): boolean {
  return wordsOf(draft) !== undefined
}

/** A row of the `/clawd` menu: a name, what it is, and the part of the name the typed word matches (from = to: none). */
export type MenuRow = { name: string; what: string; from: number; to: number }

/** The framed list above the prompt while `/clawd` is typed. */
export type Menu = {
  title: string // `/clawd` and the words before the one at the cursor: `/clawd act`
  note: string // after the title: how to use the list, or what goes here
  rows: MenuRow[] // every name the word at the cursor fits, in the order offered
  isOne: boolean // the typed word fits one name; its row is marked
  count: string // `2 of 22 fit` while the typed word fits several names
  next: string // what follows the fitting names: `then [1-5] times in a row`
}

const rank = (f: Fit): number => FIRST.indexOf(f.kind)

/** What comes after these words, when it is short to say: a count or a free text. */
function nextAfter(before: readonly string[], names: Names): string {
  const place = placeAfter(before, names)
  if ('count' in place) return `then [1-${MAX_REPEAT}] times in a row`
  if ('free' in place) return `then ${place.free}`
  return ''
}

/** The menu for the word at the cursor; undefined for any other draft, or when nothing goes there. */
export function menuFor(draft: string, cursor: number, names: Names): Menu | undefined {
  const before = draft.slice(0, cursor)
  const words = wordsOf(before)
  if (!words) return undefined
  const typing = /\s$/.test(before) ? '' : (words.pop()?.text ?? '')
  const done = words.map(w => w.text)
  const place = placeAfter(done, names)
  if ('end' in place) return undefined
  // At most two words: an emote's name and create's or change's description stay out.
  const menu: Menu = { title: ['/clawd', ...done.slice(0, 2)].join(' '), note: '', rows: [], isOne: false, count: '', next: '' }
  if ('free' in place) return { ...menu, note: place.free }
  if ('count' in place) return { ...menu, note: `[1-${MAX_REPEAT}] times in a row` }
  const isTop = done.length === 0
  if (!typing) {
    // At the top, the commands and minis; acts and emotes come by typing, or after act and emote.
    const all = isTop ? place.rows.filter(f => f.kind === 'command' || f.kind === 'mini') : place.rows
    const rows = [...all].sort((a, b) => rank(a) - rank(b)).map(f => ({ name: f.name, what: f.what, from: 0, to: 0 }))
    return { ...menu, note: isTop ? 'type to narrow, space writes a single fit out' : `${rows.length} ${place.of}`, rows }
  }
  const fits = [...fitsOf(typing, place.rows)].sort((a, b) => rank(a) - rank(b))
  const [only] = fits
  if (!only) return { ...menu, note: `nothing is called "${typing}"`, next: '/clawd help shows what there is' }
  const typed = typing.toLowerCase()
  const rows = fits.map(f => {
    const at = f.name.indexOf(typed)
    const kind = isTop ? KIND_WORD[f.kind] : ''
    return { name: f.name, what: kind ? `${kind}: ${f.what}` : f.what, from: Math.max(0, at), to: at < 0 ? 0 : at + typed.length }
  })
  const nexts = [...new Set(fits.map(f => nextAfter([...done, f.name], names)))]
  const next = nexts.length === 1 ? (nexts[0] ?? '') : ''
  if (fits.length === 1) return { ...menu, note: typing === only.name ? '' : 'space writes it out', rows, isOne: true, next }
  return { ...menu, note: `${place.of} that fit "${typing}"`, rows, count: `${fits.length} of ${place.rows.length} fit`, next }
}

/** The rows that fit in `room` rows, and the bottom edge's text: the count, what comes next, the names left out. */
export function menuLayout(menu: Menu, room: number): { rows: MenuRow[]; foot: string } {
  const rows = menu.rows.slice(0, Math.max(0, room))
  const left = menu.rows.slice(rows.length).map(r => r.name)
  const more = left.length > 0 ? `+${left.length} more: ${left.join(' ')}` : ''
  return { rows, foot: [menu.count, menu.next, more].filter(Boolean).join(' · ') }
}

/** Each word that can be checked, and whether it fits one name (true) or none (false). */
export function marksFor(draft: string, names: Names): { start: number; end: number; isFit: boolean }[] {
  const words = wordsOf(draft) ?? []
  const marks: { start: number; end: number; isFit: boolean }[] = []
  for (const [i, word] of words.entries()) {
    const place = placeAfter(
      words.slice(0, i).map(w => w.text),
      names,
    )
    if (!('rows' in place)) break
    const n = fitsOf(word.text, place.rows).length
    if (n === 1) marks.push({ start: word.start, end: word.end, isFit: true })
    else if (n === 0) marks.push({ start: word.start, end: word.end, isFit: false })
  }
  return marks
}

/**
 * After a space typed at `cursor`: the draft with the word before that space
 * written out in full, when it fits exactly one name and is short of it.
 */
export function writeOut(draft: string, cursor: number, names: Names): { text: string; cursor: number } | undefined {
  const before = draft.slice(0, cursor - 1)
  const words = wordsOf(before)
  const last = words?.pop()
  if (!words || !last || last.end !== before.length) return undefined
  const place = placeAfter(
    words.map(w => w.text),
    names,
  )
  if (!('rows' in place)) return undefined
  const fits = fitsOf(last.text, place.rows)
  const [fit] = fits
  if (fits.length !== 1 || !fit || fit.name === last.text || ALIASES[last.text]) return undefined
  return { text: draft.slice(0, last.start) + fit.name + draft.slice(last.end), cursor: cursor + fit.name.length - last.text.length }
}

/** What `/clawd <args>` asks for. */
export type Order =
  | { kind: 'status' }
  | { kind: 'command'; name: string; rest: string[] }
  | { kind: 'list'; of: ListKind }
  | { kind: 'play'; who: string; fit: Fit; count: number }
  | { kind: 'unclear'; text: string }

/** The one name a word fits, or why there is none; `where` names the command that lists them. */
function oneFit(word: string, rows: readonly Fit[], where: string): Fit | string {
  const fits = fitsOf(word, rows)
  const [fit] = fits
  if (fits.length === 1 && fit) return fit
  if (!fit) return `Clawd: nothing is called "${word}". ${where} shows what there is.`
  const shown = fits.slice(0, 8).map(f => f.name)
  return `Clawd: "${word}" fits ${fits.length} names: ${shown.join(', ')}${fits.length > shown.length ? ', ...' : ''}. Type more of it.`
}

function countOf(word: string | undefined): number {
  return Math.min(MAX_REPEAT, Math.max(1, Number.parseInt(word ?? '1', 10) || 1))
}

function unclear(text: string): Order {
  return { kind: 'unclear', text }
}

/** `who` plays the act named by rest[0], rest[1] times. */
function actOrder(who: string, rest: readonly string[], names: Names): Order {
  const [act, n] = rest
  const how = who === 'clawd' ? '/clawd act' : `/clawd ${who}`
  if (act === undefined) return unclear(`Clawd: which act? E.g. ${how} wave. /clawd list acts shows them.`)
  const what = oneFit(act, table(PLAYS, names), '/clawd list acts')
  if (typeof what !== 'string') return { kind: 'play', who, fit: what, count: countOf(n) }
  const look = onlyFit(act, table(['emote'], names))
  if (!look) return unclear(what)
  return unclear(
    who === 'clawd'
      ? `Clawd: ${look.name} is an emote; /clawd emote ${look.name} plays it.`
      : `Clawd: emotes are for Clawd only, not for ${who}.`,
  )
}

/** `/clawd emote <emote>` plays it; `/clawd emote <command> ...` creates, changes, deletes or previews one. */
function emoteOrder(rest: readonly string[], names: Names): Order {
  const [first, ...more] = rest
  if (first === undefined) {
    return unclear('Clawd: which emote? /clawd emote <emote> plays one; emote create, change, delete and preview work on them. /clawd list emotes shows them.')
  }
  const fit = oneFit(first, emoteRows(names), '/clawd list emotes')
  if (typeof fit === 'string') return unclear(fit)
  if (fit.kind === 'emote') return { kind: 'play', who: 'clawd', fit, count: 1 }
  const verb = ALIASES[fit.name] ?? fit.name
  const reason = IN_FULL[verb]
  if (reason && first !== fit.name) return unclear(`Clawd: type ${verb} in full; ${reason}.`)
  if (WHOLE_EMOTE.includes(verb)) {
    const [look] = more
    if (look === undefined) return unclear(`Clawd: which emote? /clawd emote ${verb} <emote>${verb === 'change' ? ' <what to change>' : ''}.`)
    if (!(look in names.emotes)) {
      const one = onlyFit(look, table(['emote'], names))
      return unclear(one ? `Clawd: type the emote's full name: /clawd emote ${verb} ${one.name}.` : `Clawd: there is no emote ${look}. /clawd list emotes shows them.`)
    }
  }
  return { kind: 'command', name: verb, rest: more }
}

/**
 * `/clawd skin <skin>|auto|none` chooses Clawd's body for the session; `/clawd
 * skin <command> ...` creates, changes, deletes or previews a skin. The order
 * is the skin command with the skin's or the command's full name first.
 */
function skinOrder(rest: readonly string[], names: Names): Order {
  const [first, ...more] = rest
  if (first === undefined) return { kind: 'command', name: 'skin', rest: [] }
  const fit = oneFit(first, skinRows(names), '/clawd list skins')
  if (typeof fit === 'string') return unclear(fit)
  if (fit.kind === 'skin') return { kind: 'command', name: 'skin', rest: [fit.name] }
  const verb = ALIASES[fit.name] ?? fit.name
  const reason = verb === 'delete' ? 'it removes a skin' : IN_FULL[verb]
  if (reason && first !== fit.name) return unclear(`Clawd: type ${verb} in full; ${reason}.`)
  if (WHOLE_EMOTE.includes(verb)) {
    const [look] = more
    if (look === undefined) return unclear(`Clawd: which skin? /clawd skin ${verb} <skin>${verb === 'change' ? ' <what to change>' : ''}.`)
    if (!(look in names.skins)) {
      const one = onlyFit(look, table(['skin'], names))
      return unclear(one ? `Clawd: type the skin's full name: /clawd skin ${verb} ${one.name}.` : `Clawd: there is no skin ${look}. /clawd list skins shows them.`)
    }
  }
  return { kind: 'command', name: 'skin', rest: [verb, ...more] }
}

/** The words after `/clawd`, read as one order. `clawd` as the first word names Clawd, as a mini id names that mini. */
export function orderOf(args: readonly string[], names: Names): Order {
  const words = args[0] === 'clawd' && args.length > 1 ? args.slice(1) : [...args]
  const [first, ...rest] = words
  if (first === undefined) return { kind: 'status' }
  const fit = oneFit(first, table(FIRST, names), '/clawd help')
  if (typeof fit === 'string') {
    // These were top-level commands until 2026-10-07.
    const verb = ALIASES[first] ?? first
    if (verb in EMOTE_COMMANDS) return unclear(`Clawd: that is /clawd emote ${verb} now.`)
    // A skin is no act: it is worn all session, so it takes the skin command.
    const skin = fitsOf(first, table(FIRST, names)).length === 0 ? onlyFit(first, table(['skin'], names)) : undefined
    return unclear(skin ? `Clawd: ${skin.name} is a skin; /clawd skin ${skin.name} puts it on for this session.` : fit)
  }
  if (fit.kind === 'act' || fit.kind === 'made') return { kind: 'play', who: 'clawd', fit, count: countOf(rest[0]) }
  if (fit.kind === 'emote') return { kind: 'play', who: 'clawd', fit, count: 1 }
  if (fit.kind === 'mini') return actOrder(fit.name, rest, names)
  const name = ALIASES[fit.name] ?? fit.name
  if (name === 'act') return actOrder('clawd', rest, names)
  if (name === 'emote') return emoteOrder(rest, names)
  if (name === 'skin') return skinOrder(rest, names)
  if (name === 'list') {
    const [of] = rest
    if (of === undefined) return unclear('Clawd: list what? /clawd list acts | made | emotes | skins | minis.')
    const what = oneFit(of, LIST_ROWS, '/clawd help')
    return typeof what === 'string' ? unclear(what) : { kind: 'list', of: what.name as ListKind }
  }
  return { kind: 'command', name, rest }
}
