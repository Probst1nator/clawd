import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import {
  ACTS,
  ACT_PREVIEW_EVERY_S,
  BAND_ROWS,
  FLOOR_TEXT,
  MAX_DELAY_S,
  MAX_MINIS,
  MAX_STEPS,
  MINI_STALE_S,
  PICKABLE,
  PREVIEW_PER_LINE,
  PREVIEW_POSES,
  PREVIEW_PROP_POSES,
  READ_HOLD_S,
  SHEET_POSES,
  SLEEP_AFTER_S,
  TICK_MS,
  actPreview,
  bandRows,
  bodyOf,
  callActs,
  callLabel,
  clean,
  createWorld,
  emoteFrom,
  emoteJson,
  emotePreview,
  emoteSheet,
  endMini,
  frameCells,
  isAsleep,
  isClawdCopy,
  linkRoutine,
  onPrompt,
  onTool,
  onTurnEnd,
  perform,
  resize,
  routineFrom,
  seeded,
  setEdge,
  setSkin,
  skinAsEmote,
  skinFrom,
  skinJson,
  skinPreview,
  skinSheet,
  spawnMini,
  step,
} from './clawd-sim'
import type { ActKind, Call, Emote, Playable, Routine, Skin, Step, World } from './clawd-sim'
import { contextParts, contextRows } from './clawd-context'
import { ACT_COMMANDS, ALIASES, COMMANDS, EMOTE_COMMANDS, LIST_KINDS, MAX_REPEAT, SKIN_COMMANDS, isClawdDraft, marksFor, menuFor, menuLayout, namesFit, orderOf, writeOut } from './clawd-words'
import type { ListKind, MadeKind, Menu, Names, Order } from './clawd-words'
import { UML_LEGEND, UML_WIDTH, clawdUml, umlKinds } from './clawd-uml'
import type { UmlKind } from './clawd-uml'

// Clawd, the logo, runs in the band above the prompt: one full-width Raster
// that a timer repaints with $.ui.blit. Session events steer it (the
// behaviours are in clawd-sim.ts). Logo-style
// quadrant blocks, Clawd standing on a floor line at the band's bottom, two
// sub-pixels of headroom above him (BAND_ROWS), and a row more (TALL_ROWS)
// during big jumps; two more (ANTENNA_ROWS) while he wears the Remote Control
// antenna on a tall look. With only 3 rows to spare he bounces in place. The
// band shows at any size the engine gives it, cut off where it is too small.
const MENU_MIN_COLUMNS = 20
const CLAWD_MAX_COLUMNS = 512 // the Raster limit
// While /clawd is typed, a framed list hangs below Clawd's runway, whose floor
// is the frame's top edge. At most this many names show.
const MENU_ROWS = 7
// The picker model picks what Clawd plays next (Haiku, Sonnet
// from 2026-10-06, Haiku again from 2026-10-07; since 2026-10-08 Haiku unless
// `/clawd autopick sonnet` or `opus` chose another): when a prompt is sent, when a turn ends, and
// otherwise after a random 10 to 60 s. It reads the messages and tool calls
// since its last pick, its rolling summary of the session, the situation
// (time, idle time, what Clawd is doing) and the newest act a model made. It
// may ask for a new act, emote or skin; Opus then writes the act's steps or draws the look, kept in data/ for
// every session and host. A skin it calls or has drawn is Clawd's body for the
// rest of the session, below the person's own /clawd skin choice. The top
// right of the band shows the pick and, for a new act, its title.
// Each running subagent gets a mini Clawd, which the
// picker addresses on its own: one pick is a list of calls, like parallel tool
// calls, each naming a body (or all of them), an act and a delay of 0 to 5 s.
// The picker is off until `/clawd autopick on`; the choice is kept in $.store, as
// is the picker model (`pickModel`).
const PICK_MODELS = ['haiku', 'sonnet', 'opus'] as const
type PickModel = (typeof PICK_MODELS)[number]
const DEFAULT_PICK_MODEL: PickModel = 'haiku'
const MAKE_MODEL = 'opus'
const NAME_MODEL = 'haiku' // names what a sentence after create asks for
const PICK_MIN_S = 10
const PICK_MAX_S = 60
const NEW_PER_DAY = 5 // new acts, emotes and skins the picker may ask for in any 24 hours, over all sessions and hosts
const FEED_MAX = 40 // lines kept for the next pick
const DAY_MS = 24 * 3600_000
const TRACE_MAX = 50 // picks kept per session in picks/
// The session's model runs /clawd commands through one tool. The engine lists
// a registered tool behind ToolSearch, so until a model asks for it only the
// name is in the context. It takes all of /clawd; a create or change it starts
// counts against NEW_PER_DAY, which a person's typed one skips.
const CLAWD_TOOL = 'mcp__clawd__clawd'
const TOOL_DESCRIPTION = [
  'Runs a /clawd command for Clawd, the Claude Code logo that runs in the band above the prompt, and its minis',
  '(a1, a2, ...: a small Clawd for each running subagent). `command` is what the person would type after /clawd,',
  'and the answer is the text /clawd shows them. Examples: "list acts", "list made", "list emotes", "list skins",',
  '"list minis"; "act wave 2" plays an act 1 to 5 times; "a1 celebrate" has a mini play one; "emote huh" puts on a',
  'look for a while; "skin <skin>" wears a skin for the session, "skin auto" goes back; "" says what Clawd',
  'is doing; "help"; "on" or "off" (remembered across sessions); "autopick on", "off", "now", "haiku", "sonnet" or',
  '"opus"; "act create <name> [what it does]", "emote create <name> [image path] [what it looks like]", "skin create',
  '..."; "act change <name> [what to change]"; "act delete <name>"; "act preview <name>" writes a PNG and answers',
  'its path. emote and skin take the same create, change, delete and preview. Use full names: a short word plays',
  `the one name it fits. Create and change start a ${MAKE_MODEL} run on the person's Claude usage, refused once`,
  `${NEW_PER_DAY} acts, emotes and skins were made in the last 24 hours. Play acts and emotes when the person asks`,
  'something of Clawd, or to mark a moment they would enjoy. Run create, change, delete, skin, on, off and',
  'autopick only when the person asks for them.',
].join(' ')
// Emotes: looks Clawd takes for a while. emotes/ holds the
// ones drawn by hand, data/emotes/ the ones a model drew. A model draws one in
// a headless `claude -p` run, because $.model.complete takes no image: the run
// may read the reference image and the preview of its draft and nothing else,
// and the mod writes the files. A new emote starts as EMOTE_DRAFTS drafts in
// one reply; the next round sees them side by side and picks one, and each later round sees the preview of its draft.
const EMOTE_ROUNDS = 3
const EMOTE_DRAFTS = 3
const EMOTE_ROUND_MS = 300_000
// Since 2026-10-26 one agent makes an act, an emote or a skin instead of the
// rounds.
// The mod registers it hidden, as clawd:maker. It hands each draft to the mod's
// render tool, which checks it and draws the PNG with the mod's own previews,
// Reads that PNG, and stops when it is satisfied; the mod keeps the last draft
// that rendered. A tool.check hook lets it Read only the images it is given.
// That hook only sees the maker when the spawn ran inside a hook of another
// event (tested 2026-10-26): from a timer, or after the hook returned, every
// hook of the mod is skipped for that agent. So a make is queued and started
// from the band's ui.render hook (`spawnQueued`). When that does not happen
// within MAKER_START_MS, or the spawn is refused, the rounds run as before.
const RENDER_TOOL = 'mcp__clawd__render'
const MAKER_TURNS = 40
const MAKER_MS = 15 * 60_000 // after this the maker's calls are refused, as a subagent cannot be stopped
const MAKER_GRACE_MS = 2 * 60_000 // then it has this long to answer before the make fails
const MAKER_START_MS = 5_000
const NO_ANSWER = 'no answer in time' // the end of a maker that never answered; its last draft is not saved
// Parent modes the maker was tested under; in any other the spawn is refused and the rounds run.
const MAKER_MODES = ['default', 'plan', 'auto', 'dontAsk']
const MAKER_SYSTEM = [
  'You make one thing for Clawd, the Claude Code logo drawn as a small creature in a terminal band above',
  'the prompt: a look it takes, a skin it wears, or an act it plays. You work only with two tools:',
  `${RENDER_TOOL} checks a draft and draws it as a PNG, and Read shows you that PNG.`,
  `${RENDER_TOOL} is read-only: it only draws a preview image for you to look at, so it is allowed in plan mode too.`,
  'Never call SubagentHandback: end with a plain text answer of one line, done or failed: <why>.',
].join(' ')
// How the maker works on an emote or a skin.
const MAKER_LOOP = [
  `How you work: load ${RENDER_TOOL} with ToolSearch (query "select:${RENDER_TOOL}"), then hand it a draft`,
  'as {"draft": {...}}, or up to 3 drafts side by side as {"drafts": [...]}. It answers the path of a PNG, or',
  'why a draft was refused. Read the PNG, look at it, fix the draft and render again, as often as it helps.',
]
const IMAGE = /\.(png|jpe?g|gif|webp)$/i
// `/clawd` words no act, emote or skin may be named
const RESERVED = [
  ...Object.keys(COMMANDS),
  ...Object.keys(ACT_COMMANDS),
  ...Object.keys(EMOTE_COMMANDS),
  ...Object.keys(SKIN_COMMANDS),
  ...Object.keys(LIST_KINDS),
  ...Object.keys(ALIASES),
  'pick',
]
// What the built-in acts look like, for /clawd list and the menu while /clawd is typed.
const ACT_WHAT: Partial<Record<ActKind, string>> = {
  ...PICKABLE,
  sleep: 'sits down and falls asleep',
  wake: 'wakes up',
  carry: 'fetches a brick for the pile',
  kick: 'kicks the brick pile over',
  read: 'holds up a scroll and looks down at it',
}

const isClawdOn = atom({ plugin: 'clawd', key: 'isClawdOn' } as const, true)
const clawdRows = atom({ plugin: 'clawd', key: 'clawdRows' } as const, BAND_ROWS)
const isTracing = atom({ plugin: 'clawd', key: 'isTracing' } as const, false)
const isDebugging = atom({ plugin: 'clawd', key: 'isDebugging' } as const, false)
const clawdMenu = atom({ plugin: 'clawd', key: 'clawdMenu' } as const, null)
const clawdSkin = atom({ plugin: 'clawd', key: 'clawdSkin' } as const, null)
const clawdPickedSkin = atom({ plugin: 'clawd', key: 'clawdPickedSkin' } as const, null)

// Off in headless sessions and with CLAUDE_CLAWD_OFF=1. Tests set
// CLAUDE_CLAWD_SEED so the band's random acts repeat.
// `names` is what a `/clawd` word may name, read once per `/clawd` draft.
// `dataDir` keeps what the mod makes (acts, emotes a model drew, previews,
// traces): data/ beside the plugin where a checkout has one, as tools/clawd
// does, else clawd/ in the Claude config folder, which a plugin update leaves
// alone. `emoteDir` and `skinDir` hold the emotes and skins that ship with
// the mod. `skin` is the skin Clawd wears now, as last read (`skinNow`):
// `/clawd skin` chooses one for the session, else the autopicker picked one
// for the session, else the plugin's clawd.json names one
// (`fileSkin`), else
// a folder rule gives one for the project root (`root`, `folderRule`).
const mod = {
  isOff: false,
  rand: Math.random,
  dataDir: '',
  emoteDir: '',
  skinDir: '',
  fileSkin: '',
  folderRules: [] as FolderSkin[], // the person's folder rules, as applySkin last read them
  root: '',
  skin: null as MadeSkin | null,
  project: '',
  startedAt: 0,
  names: undefined as Names | undefined,
  isRemote: false, // Remote Control is on: Clawd wears an antenna and the autopicker pauses
}

/** An act a model made, as kept in data/acts/<name>.json. */
type MadeAct = Routine & { made: string; project: string; why: string }

/**
 * What the file of a skin or an emote keeps besides the look: when, where and why it was made, its reference image, the file.
 * A skin with `"hidden": true` is left out of the menu, the lists and the models' choices; only a folder rule puts it on.
 */
type Dated = { made: string; project: string; why: string; image: string; file: string; isHidden?: boolean }

/** An emote from emotes/ (`made` empty) or data/emotes/. */
type MadeEmote = Emote & Dated

/** A skin from skins/ (`made` empty) or data/skins/. */
type MadeSkin = Skin & Dated

/** Emotes and skins are drawn, changed, kept and removed the same way, each in its own folders. */
type LookKind = Exclude<MadeKind, 'act'>

/** How a kind of look is read, written and drawn. */
type Kit<T extends { name: string; title: string }> = {
  kind: LookKind
  parse: (raw: unknown) => T | string
  json: (look: T) => Record<string, unknown>
  preview: (look: T) => Uint8Array
  sheet: (looks: T[]) => Uint8Array
  check: (look: T) => string // why a newly drawn look is refused, or ''
  what: (look: T) => string // one line on the look, for the overview a new drawing gets
}
// An emote is previewed on the skin Clawd wears now; with a clawd.json skin, on no other body.
const EMOTE_KIT: Kit<Emote> = {
  kind: 'emote',
  parse: emoteFrom,
  json: emoteJson,
  preview: look => emotePreview(look, mod.skin, mod.fileSkin !== ''),
  sheet: looks => emoteSheet(looks, mod.skin, mod.fileSkin !== ''),
  check: look =>
    isClawdCopy(look) ? "its shapes are Clawd's own body; leave out shapes and the other body fields, so the look keeps the body Clawd has" : '',
  what: emoteWhat,
}
const SKIN_KIT: Kit<Skin> = {
  kind: 'skin',
  parse: skinFrom,
  json: skinJson,
  preview: skinPreview,
  sheet: skinSheet,
  check: () => '',
  what: look => look.title,
}

/** One call as the picker made it, for the label and `/clawd`. */
type Called = { who: string; name: string; delay: number }

type Pick = { trigger: string; calls: Called[]; why: string; at: number; made?: MadeAct }

/** One pick as it went: what the picker read, what it answered, what came of it. */
type Trace = { at: string; trigger: string; system: string; prompt: string; reply: string; outcome: string }

// The picker's working state; a hot reload starts it over.
const brain = {
  feed: [] as { n: number; text: string }[], // what happened since the last pick
  seq: 0, // lines ever fed
  seen: 0, // lines the last pick read
  summary: '',
  recent: [] as string[], // picks, newest first
  last: null as Pick | null,
  timer: null as Timer | null,
  dueAt: 0, // when the timer fires; 0 while none is set
  isPicking: false,
  again: null as string | null, // a trigger that came in during a pick
  making: '', // the act a model writes or the look it draws now, from a /clawd command or a picker's look
  makeError: '', // why the last act, emote or skin a model made failed
  shown: new Map<string, string>(), // each part of the picker's request as /clawd debug last showed it
}

// Clawd's working state; a hot reload starts Clawd over.
const clawd = {
  world: null as World | null,
  requestId: null as string | null,
  last: '',
  rows: null as number | null, // the band's height as last written; null: not yet written this load
}

function clawdTick($: EngineInterface): void {
  const w = clawd.world
  const requestId = clawd.requestId
  if (!w || !requestId) return // paused while the band is not mounted
  step(w)
  const rows = bandRows(w)
  if (rows !== clawd.rows) {
    clawd.rows = rows
    void update($, clawdRows, () => rows) // the band redraws at its new height
  }
  const cells = frameCells(w)
  if (cells === clawd.last) return
  clawd.last = cells
  void $.ui.blit({ requestId, key: 'clawd', cells }).then(r => {
    if (r.deny === undefined || clawd.requestId !== requestId) return
    // Unmounted, or a frame of the old height that reached the band after it
    // grew or shrank (the band keeps one requestId). Nothing else redraws the
    // band until its props change, so ask for the render that mounts it again;
    // a band no longer shown draws no Raster, and the tick stays paused.
    $.ui.log(`clawd: blit refused: ${r.deny}`, { to: 'debug' })
    clawd.requestId = null
    $.ui.invalidate('ui.render')
  })
}

// While Remote Control is on, Clawd wears an antenna. No
// hook event says when it goes on or off, but the engine keeps
// CLAUDE_CODE_BRIDGE_SESSION_ID in its own environment while the session has a
// Remote Control link (2.1.294), so the mod reads it every REMOTE_POLL_MS.
// While it is on, the autopicker pauses and Clawd plays random acts; the stored
// setting is left as it is and applies again when Remote Control ends.
const REMOTE_POLL_MS = 1000

async function pollRemote($: EngineInterface): Promise<void> {
  const isRemote = Boolean(await $.env.get('CLAUDE_CODE_BRIDGE_SESSION_ID'))
  if (isRemote === mod.isRemote) return
  mod.isRemote = isRemote
  if (clawd.world) clawd.world.antenna = isRemote
  if (isRemote) {
    brain.timer?.cancel()
    brain.timer = null
    brain.dueAt = 0
  } else if (await isAutopicking($)) schedulePick($, await $.clock.now())
  $.ui.log(`clawd: Remote Control ${isRemote ? 'on, antenna up, autopicker paused' : 'off, antenna down'}`, { to: 'debug' })
}

// --- the picker ----------------------------------------------------------------

const PICK_SYSTEM =
  'You direct Clawd, the Claude Code logo drawn as a small creature that runs around in a band ' +
  'above the prompt of a Claude Code session, and a mini Clawd for each subagent the session runs. ' +
  'The person sees Clawd while they work and sometimes talks to it or about it. When they give it a ' +
  'name or compare it to something, they want to see it become that thing, which is what new acts, emotes and skins are for. ' +
  'You pick what they play next so it fits what is going on, and you keep a short summary of the ' +
  'session. Reply with one JSON object and nothing else.'

const MAKE_SYSTEM =
  'You write short choreographies for Clawd, the Claude Code logo drawn as a small creature, orange ' +
  "in its own body, in a terminal band 4 rows high and as wide as the terminal. Reply with one JSON object and nothing else."

function oneLine(s: string, n: number, end = false): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return end ? `...${t.slice(-n)}` : `${t.slice(0, n)}...`
}

function feed(text: string): void {
  brain.seq += 1
  brain.feed.push({ n: brain.seq, text })
  if (brain.feed.length > FEED_MAX) brain.feed.shift()
}

/** A subagent's mini id, or 'subagent' when it has none. */
function miniName(agentId: string): string {
  return clawd.world?.minis.find(m => m.agentId === agentId)?.id ?? 'subagent'
}

function toolLine(e: Record<string, unknown>, isError: boolean): string {
  const keys = ['description', 'command', 'file_path', 'pattern', 'url', 'query', 'skill', 'prompt']
  const what = keys.map(k => e[k]).find((v): v is string => typeof v === 'string' && v !== '')
  const who = typeof e.agentId === 'string' ? ` (${miniName(e.agentId)})` : ''
  return `tool ${String(e.tool)}${who} ${isError ? 'failed' : 'ok'}${what ? `: ${oneLine(what, 100)}` : ''}`
}

function callText(c: Called): string {
  return `${c.who}: ${c.name}${c.delay > 0 ? ` +${c.delay} s` : ''}`
}

function parseJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const value: unknown = JSON.parse(match[0])
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`
}

/**
 * The acts models made, newest first, from data/acts/, with their emote and
 * play steps linked to `emotes` (read here when not given) and to each other.
 * An emote step may also name a skin, which Clawd then wears for a while.
 */
async function loadMade($: EngineInterface, emotes?: Emote[]): Promise<MadeAct[]> {
  const dir = `${mod.dataDir}/acts`
  let entries: { name: string; kind: string }[] = []
  try {
    entries = await $.fs.list(dir)
  } catch {
    return [] // no act made yet
  }
  const made: MadeAct[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    try {
      const raw = JSON.parse(await $.fs.read(`${dir}/${entry.name}`)) as Record<string, unknown>
      const routine = routineFrom(raw)
      if (typeof routine === 'string') continue
      const text = (v: unknown) => (typeof v === 'string' ? v : '')
      made.push({ ...routine, made: text(raw.made), project: text(raw.project), why: text(raw.why) })
    } catch {
      // half-written or broken; skip it
    }
  }
  const find = finder(made, emotes ?? (await loadEmotes($)), await loadSkins($))
  return made.sort((a, b) => b.made.localeCompare(a.made)).map(r => linkRoutine(r, find))
}

/** What a name in an act's emote or play step stands for: a made act, an emote, or a skin worn for a while. */
function finder(made: readonly Routine[], emotes: readonly Emote[], skins: readonly Skin[]): (name: string) => Playable | undefined {
  return name => {
    const skin = skins.find(x => x.name === name)
    return made.find(r => r.name === name) ?? emotes.find(x => x.name === name) ?? (skin && skinAsEmote(skin))
  }
}

/**
 * The emotes or skins, read fresh on each use so a new file plays without a
 * reload: the mod's own folder (emotes/, skins/) first, then the data folder's
 * newest first. A model's never replaces a hand-drawn one of the same name.
 */
async function loadLooks<T extends { name: string; title: string }>($: EngineInterface, kit: Kit<T>): Promise<(T & Dated)[]> {
  const found: (T & Dated)[] = []
  for (const dir of [kit.kind === 'emote' ? mod.emoteDir : mod.skinDir, `${mod.dataDir}/${kit.kind}s`]) {
    let entries: { name: string; kind: string }[] = []
    try {
      entries = await $.fs.list(dir)
    } catch {
      continue // none there yet
    }
    const here: typeof found = []
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
      try {
        const raw = JSON.parse(await $.fs.read(`${dir}/${entry.name}`)) as Record<string, unknown>
        const look = kit.parse(raw)
        if (typeof look === 'string' || found.some(e => e.name === look.name)) continue
        const text = (v: unknown) => (typeof v === 'string' ? v : '')
        const file = `${dir}/${entry.name}`
        here.push({ ...look, made: text(raw.made), project: text(raw.project), why: text(raw.why), image: text(raw.image), file, isHidden: raw.hidden === true })
      } catch {
        // half-written or broken; skip it
      }
    }
    found.push(...here.sort((a, b) => b.made.localeCompare(a.made)))
  }
  return found
}

/** The emotes: emotes/, then data/emotes/. */
async function loadEmotes($: EngineInterface): Promise<MadeEmote[]> {
  return loadLooks($, EMOTE_KIT)
}

/** The skins: skins/, then data/skins/. */
async function loadSkins($: EngineInterface): Promise<MadeSkin[]> {
  return loadLooks($, SKIN_KIT)
}

/** data/ beside the plugin where a checkout has one, else clawd/ in the Claude config folder. */
async function dataDirOf($: EngineInterface, root: string): Promise<string> {
  const beside = `${root.replace(/\/[^/]*$/, '')}/data`
  try {
    if ((await $.fs.stat(beside)).kind === 'dir') return beside
  } catch {
    // no such folder
  }
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${(await $.env.get('HOME')) ?? ''}/.claude`
  return `${config}/clawd`
}

/** The skin the plugin's clawd.json names (`skin`, or `look` as until 2026-10-08), or ''. */
async function fileSkinOf($: EngineInterface, root: string): Promise<string> {
  try {
    const raw = JSON.parse(await $.fs.read(`${root}/clawd.json`)) as { skin?: unknown; look?: unknown }
    const name = raw.skin ?? raw.look
    return typeof name === 'string' ? name : ''
  } catch {
    return '' // no clawd.json: Clawd is Clawd
  }
}

// Without a clawd.json skin, a session whose project root matches a folder
// rule wears that rule's skin. The person's
// rules in folder-skins.json in the data folder come first, then FOLDER_SKINS;
// the first that matches wins, and "none" keeps Clawd's own body. The root
// moves with /cd and worktree moves but not with a shell cd, so an agent
// passing through a folder does not switch it.
const FOLDER_SKINS: FolderSkin[] = [{ match: 'MatSci|matsci', skin: 'matsci_octopus' }]
const FOLDER_SKINS_FILE = 'folder-skins.json'
const ROOT_POLL_MS = 1000

/** A folder rule: a project root whose path matches `match`, a regular expression, wears `skin`. */
type FolderSkin = { match: string; skin: string }

/** The person's folder rules from folder-skins.json in the data folder, each `match` a RegExp; [] without the file. */
async function readFolderSkins($: EngineInterface): Promise<FolderSkin[]> {
  let text: string
  try {
    text = await $.fs.read(`${mod.dataDir}/${FOLDER_SKINS_FILE}`)
  } catch {
    return [] // no such file
  }
  if (!text.trim()) return []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    $.ui.log(`clawd: ${FOLDER_SKINS_FILE} is not JSON; its rules are skipped`, { to: 'debug' })
    return []
  }
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is FolderSkin => typeof r?.match === 'string' && typeof r?.skin === 'string')
    .filter(rule => {
      try {
        return new RegExp(rule.match) instanceof RegExp
      } catch {
        $.ui.log(`clawd: ${FOLDER_SKINS_FILE}: "${rule.match}" is not a regular expression; the rule is skipped`, { to: 'debug' })
        return false
      }
    })
}

/** The first folder rule whose `match` fits the project root, the person's before the built-in ones, and where it is written. */
function folderRule(): { rule: FolderSkin; from: string } | undefined {
  const sets: [FolderSkin[], string][] = [[mod.folderRules, FOLDER_SKINS_FILE], [FOLDER_SKINS, 'built in']]
  for (const [rules, from] of sets) {
    const rule = rules.find(r => new RegExp(r.match).test(mod.root))
    if (rule) return { rule, from }
  }
  return undefined
}

/**
 * The skin for now and where it comes from: /clawd skin's choice, the
 * autopicker's, clawd.json's, a folder rule's; '' for Clawd's own body.
 */
async function skinNow($: EngineInterface): Promise<{ name: string; from: string }> {
  const chosen = await read($, clawdSkin)
  if (chosen !== null) return { name: chosen, from: 'chosen with /clawd skin for this session' }
  const picked = await read($, clawdPickedSkin)
  if (picked !== null) return { name: picked, from: 'picked by the autopicker for this session; /clawd skin auto goes back' }
  if (mod.fileSkin) return { name: mod.fileSkin, from: "named in the mod's clawd.json" }
  const found = folderRule()
  if (!found) return { name: '', from: '' }
  return { name: found.rule.skin === 'none' ? '' : found.rule.skin, from: `the project folder matches "${found.rule.match}" (${found.from})` }
}

/** Reads the skin for now and gives it to Clawd: with a puff when it changes and `isChange`, else quietly. */
async function applySkin($: EngineInterface, isChange: boolean): Promise<void> {
  mod.folderRules = await readFolderSkins($) // read here, so /clawd skin names the skin worn, not one an edit asks for
  const { name } = await skinNow($)
  mod.skin = name ? ((await loadSkins($)).find(x => x.name === name) ?? null) : null
  if (clawd.world) setSkin(clawd.world, mod.skin, !isChange)
}

/** Reads the project root every ROOT_POLL_MS and changes the skin when the root asks for another. */
async function pollRoot($: EngineInterface): Promise<void> {
  let root: string
  try {
    root = await $.session.root()
  } catch {
    return
  }
  if (!root || root === mod.root) return
  mod.root = root
  const before = mod.skin?.name ?? ''
  await applySkin($, true)
  const after = mod.skin?.name ?? ''
  if (after !== before) $.ui.log(`clawd: project root ${root}, skin ${after || 'none'}`, { to: 'debug' })
}

/** Whether the autopicker runs by itself (`/clawd autopick on`); off until then. */
async function isAutopicking($: EngineInterface): Promise<boolean> {
  return (await $.store.get('isAutopickOn')) === true
}

/** Whether the autopicker picks by itself now: switched on, and Remote Control off. */
async function isPickingAlone($: EngineInterface): Promise<boolean> {
  return !mod.isRemote && (await isAutopicking($))
}

/** The model the autopicker asks (`/clawd autopick haiku|sonnet|opus`); Haiku until another is chosen. */
async function autopickModel($: EngineInterface): Promise<PickModel> {
  const model = await $.store.get('pickModel')
  return PICK_MODELS.find(m => m === model) ?? DEFAULT_PICK_MODEL
}

/** A local image's real path for an emote's reference, or '' when it is none. */
async function imagePath($: EngineInterface, raw: string): Promise<string> {
  const home = (await $.env.get('HOME')) ?? ''
  const path = raw.startsWith('~/') ? `${home}/${raw.slice(2)}` : raw
  if (!path.startsWith('/') || !IMAGE.test(path)) return ''
  try {
    const stat = await $.fs.stat(path, { resolve: true })
    return stat.kind === 'file' && stat.realPath && IMAGE.test(stat.realPath) ? stat.realPath : ''
  } catch {
    return ''
  }
}

/** Writes bytes to a file; $.fs.write takes text only. */
async function writeBytes($: EngineInterface, path: string, bytes: Uint8Array): Promise<void> {
  const code = 'import base64,os,sys;os.makedirs(os.path.dirname(sys.argv[1]),exist_ok=True);open(sys.argv[1],"wb").write(base64.b64decode(sys.stdin.read()))'
  const base64 = (bytes as Uint8Array & { toBase64(): string }).toBase64()
  const r = await $.process.run(['python3', '-c', code, path], { stdin: base64, timeoutMs: 20_000 })
  if (r.exitCode !== 0) throw new Error(`python3 exited ${r.exitCode}: ${oneLine(r.stderr, 200)}`)
}

/** Draws an emote's or a skin's preview sheet to data/<kind>s/previews/<file>.png; the path. */
async function previewLook<T extends { name: string; title: string }>($: EngineInterface, kit: Kit<T>, look: T, file = look.name): Promise<string> {
  const path = `${mod.dataDir}/${kit.kind}s/previews/${file}.png`
  await writeBytes($, path, kit.preview(look))
  return path
}

// What an emote may have that a skin has not: a time, a prop and a tool.
const EMOTE_EXTRAS = [
  '- dur: seconds Clawd keeps the look, 3 to 20.',
  "- accent (optional): the colour of '+' pixels, and of the prop and the tool where they give none.",
  '- prop (optional): an object beside Clawd that is not part of its body: something that moves on its',
  '  own, such as a rocket that lifts off, or something Clawd works on, such as a block it mines. Draw',
  '  such a thing as a prop, not into the shapes, or it walks along with Clawd.',
  '  {"rows": [...], "color": "#rrggbb", "x": -12, "path": [{"t": 0, "y": 0}, ...], "trail": false}.',
  '  rows: # the prop colour, + the accent, . empty; at most 8 wide and 6 high (8 with',
  '  "tall"); an even width keeps its pixels paired in cells. color: optional, the accent by default.',
  "  x: sub-pixels from Clawd's centre to the prop's centre as the look starts, negative behind Clawd;",
  '  from then on the prop keeps to its path wherever Clawd goes. path: up to 8 keys in time order, t',
  '  seconds since the look started (0 to dur), y the height of its bottom above the floor (0 to 24),',
  '  x an optional sideways shift; straight lines between keys, then the last key holds. Past y 10 the',
  '  prop has left the band. trail: true for sparks below it while it rises, like a flame.',
  '  The path runs on its own clock and does not follow Clawd: after a wave and two hops Clawd goes on',
  '  as always and may walk off, trip or sit down and sleep. Give a moving path only to a thing that',
  '  moves by itself, such as a rocket or a ball rolling away. A thing Clawd works on stays on the',
  '  floor: one key {"t": 0, "y": 0}. When the look ends, a prop on the floor breaks into its pixels.',
  '- tool (optional): a thing Clawd holds in its front hand, such as a pointer or a pickaxe.',
  '  {"rows": [...], "color": "#rrggbb"}. rows: # the tool colour, + the accent, . empty; at most 8 wide',
  "  and 4 high. color: optional, the accent by default. The first pixel of the bottom row sits one",
  "  pixel past the front arm's tip, and the tool moves with that tip from pose to pose without",
  '  turning, so a wave between up and raised moves it too; a body without arms holds it against its',
  "  front edge. Give it a colour other than the body's (Clawd's own orange or its skin's), or it reads",
  '  as part of the arm.',
]

/**
 * What a new emote is asked to be: Clawd becomes the thing ('become'), or
 * keeps its body and holds, uses or sets down the thing ('hold'); '' leaves
 * it to the drawing model.
 */
type Form = 'become' | 'hold' | ''

/**
 * The prompt of one drawing round of an emote or a skin. With `change`, an
 * existing look is changed: `isBefore` marks the first round, whose draft is
 * the look as it is now. `others` lists the other looks of the kind, one line
 * each, for the round that draws the drafts. With `isMaker`, it is the task
 * of the maker agent, which renders and reads its own drafts (MAKER_LOOP).
 */
function emotePrompt(
  kind: LookKind,
  name: string,
  title: string,
  why: string,
  image: string,
  draft: string,
  preview: string,
  refused: string,
  change = '',
  isBefore = false,
  drafts: string[] = [],
  form: Form = '',
  others: string[] = [],
  isMaker = false,
): string {
  const poses = PREVIEW_POSES.map((p, i) => `${i + 1}. ${p}`).join('; ')
  const propPoses = PREVIEW_PROP_POSES.map((p, i) => `${PREVIEW_POSES.length + i + 1}. ${p}`).join('; ')
  const isEmote = kind === 'emote'
  // A skin, and an emote that turns Clawd into the thing, has a body; an emote that holds the thing has none.
  const hasBody = !isEmote || form !== 'hold'
  const mayHold = isEmote && form !== 'become'
  const propLines = isEmote ? [`A look with a prop gets one more line of ${PREVIEW_PROP_POSES.length} panels: ${propPoses}.`] : []
  // A look that keeps the body is drawn on the skin and on Clawd's own body (emotePreview, emoteSheet), unless clawd.json names the skin.
  const isTwice = isEmote && mayHold && mod.skin !== null && !mod.fileSkin
  const twiceLines = isTwice
    ? ["A look that keeps the body is shown on the skin and then, from a new line, in the same panels on Clawd's own body. It must work on both."]
    : []
  // A new look's first round draws several drafts; the next one picks from them.
  const isDrafting = !change && !draft && drafts.length === 0
  const skin = mod.skin ? `the skin ${mod.skin.name} ("${oneLine(mod.skin.title, 60)}", ${String(skinJson(mod.skin).color)})` : 'its own orange body'
  const differ = !hasBody
    ? 'the shape, size and colour of the tool and the prop, and where the prop stands'
    : mayHold
    ? 'which kind it is, silhouette, proportions, eyes, legs, arms, tool or prop'
    : 'silhouette, proportions, eyes, legs or arms'
  return [
    `You ${change ? 'change a' : 'draw a new'} ${isEmote ? 'look' : 'skin'} for Clawd, the Claude Code logo, which runs around as a small creature in a`,
    isEmote
      ? 'terminal band above the prompt. For a while Clawd wears this look, and'
      : 'terminal band above the prompt. As a skin, Clawd is drawn in this look instead of its own body all the time, and',
    'moves as always: it walks, hops, looks around, blinks, trips, waves, and sits down to sleep.',
    `The look: ${name}, "${title}".`,
    `Why it was asked for: ${why || '(no reason given)'}`,
    ...(change ? [`The change asked for now: "${change}". Make that change and keep what it does not touch.`] : []),
    image
      ? `The reference image is ${image}. Read it first and draw the look after it: its silhouette, colour and the features that make it recognisable at this tiny size.`
      : 'There is no reference image; draw it from the title.',
    ...(!isEmote
      ? []
      : !mayHold
      ? ['This look turns Clawd into the thing: it has shapes and the body fields, and Clawd is drawn in them instead of its body.']
      : !hasBody
      ? ['This look keeps the body Clawd has and adds the thing: a tool in its hand, a prop beside it, or both.', 'It has no shapes and none of the body fields.']
      : [
          'A look is one of two kinds. One turns Clawd into the thing: it has shapes and the body fields, and',
          'Clawd is drawn in them instead of its body. The other keeps the body Clawd has and adds the thing: a',
          'tool in its hand, a prop beside it, or both; it has no shapes and none of the body fields. Take the',
          'second when the thing is something Clawd holds, uses, makes or works on, and the first when Clawd',
          'should become it: a creature, a character, a costume.',
        ]),
    ...(mayHold ? [`Clawd's body now is ${skin}. A look that keeps the body is drawn on it, and later on whatever body Clawd has then.`] : []),
    '',
    'How it is drawn: on a grid of sub-pixels, 2 x 2 per terminal cell, with quadrant block characters.',
    'A terminal cell is about twice as high as wide, so a sub-pixel is too. A cell shows at most two',
    'colours, so keep to one body colour: eyes are holes that show the dark terminal background. The',
    'band is 4 rows (8 sub-pixels) high; with "tall": true it grows to 5 rows (10 sub-pixels) while Clawd',
    "wears the look. Clawd's own body is 12 x 4 sub-pixels with four legs of 1 below it.",
    '',
    ...(isDrafting && others.length > 0
      ? [`Clawd has these other ${isEmote ? 'emotes' : 'skins'}. Draw the new one so that it cannot be taken for any of them:`, ...others, '']
      : []),
    ...(isMaker
      ? ['A draft is one JSON object:']
      : isDrafting
      ? [
          `Draw ${EMOTE_DRAFTS} drafts that differ in how they show it: ${differ}. The`,
          'next round sees them side by side and keeps the best. Reply with one JSON object and nothing else,',
          `{"drafts": [${Array.from({ length: EMOTE_DRAFTS }, (_, i) => `draft ${i + 1}`).join(', ')}]}, each draft an object like this:`,
        ]
      : ['Reply with one JSON object and nothing else:']),
    ...(hasBody
      ? [
          ...(mayHold ? ['for a look that turns Clawd into the thing,'] : []),
          `{"name": "${name}", "title": "...", "color": "#rrggbb", "shapes": {...}, "legs": [...], "legLength": 2,`,
          ` "wiggle": false, "armRow": 2, "arms": {...}, "tall": false,${isEmote ? ' "dur": 8,' : ''} "done": false}`,
        ]
      : []),
    ...(mayHold
      ? [
          ...(hasBody ? ['and for one that keeps the body Clawd has,'] : []),
          `{"name": "${name}", "title": "...", "accent": "#rrggbb", "tall": false, "dur": 8, "tool": {...}, "prop": {...}, "done": false}`,
          'with a tool, a prop or both; leave out the one it does not use.',
        ]
      : []),
    ...(hasBody
      ? [
          ...(mayHold ? ['The body fields, for a look that turns Clawd into the thing:'] : []),
          '- color: the body colour; one that stands out on a dark background. "accent": "#rrggbb" is',
          "  optional, for '+' pixels; a '+' only shows where all 8 of its neighbours are body pixels.",
          '- shapes: rows of characters, one string per row, at most 20 wide. # body, o an eye (a hole while',
          '  open; it moves when Clawd looks around), + accent, . empty. normal: standing. squash: landing or',
          '  crouching, wider and lower. stretch: rising in a jump, narrower and higher. flat: lying flat after',
          '  a trip, 1 or 2 rows. Any shape left out is the normal one.',
          '- legs: columns of the normal shape where legs hang below its last row, up to 8. legLength 0 to 3.',
          "  wiggle true: the leg tips sway like tentacles and crawl in a ripple; false: they step like Clawd's.",
          "- armRow: the normal shape's row the arms grow from, or null for none. arms (optional): the arm",
          "  pixels as [dx, dy] from the body's edge on that row, dx outward and dy down, up to 4 per pose",
          "  and within 3. Clawd's are out [[1,0],[2,0]], up [[1,-1],[2,-2]], down [[1,1]], raised [[1,-1],[1,-2]].",
          "  Each pose is one line: the first pixel touches the body's edge, each next one the one before, no",
          "  branches; a pose that is not keeps Clawd's. Draw nothing held into the arms: at this size it reads",
          `  as horns or a tail.${isEmote ? ' A held thing is the tool.' : ''}`,
          '- Height limit: each shape, with legLength for normal and stretch, at most 6 sub-pixels, or 8 with',
          '  "tall": true.',
        ]
      : []),
    ...(isEmote ? [...(hasBody ? ['The fields of every look:'] : []), ...EMOTE_EXTRAS] : []),
    ...(isMaker
      ? [
          '',
          ...MAKER_LOOP,
          `A single draft renders as a sheet of ${PREVIEW_POSES.length} panels, ${PREVIEW_PER_LINE} per line, each the band as the terminal shows`,
          `it with Clawd in your look, in these poses: ${poses}.`,
          ...propLines,
          ...twiceLines,
          `Several drafts render as one sheet: line k shows draft k, its number at the left, in ${SHEET_POSES.length} poses:`,
          `${SHEET_POSES.join('; ')}.`,
          ...(isTwice ? [`A draft that keeps the body shows them on the skin and then the same ${SHEET_POSES.length} on Clawd's own body.`] : []),
          ...(draft
            ? [
                `The look as it is now: ${draft}`,
                ...(preview ? [`Its preview is ${preview}. Read it first.`] : []),
                'Make the change asked for, render it, and check first that the render carries the change.',
              ]
            : [`Start with ${EMOTE_DRAFTS} drafts side by side that differ in ${differ}, and keep the one that is easiest to recognise.`]),
          'Compare each render with the reference image, or with the title when there is none, and fix what makes',
          'it harder to recognise at this size: silhouette, eyes, legs, arms, proportions. Stop when no change',
          'would make it clearly more recognisable. The look that is kept is the last draft you rendered alone,',
          'so render your final draft alone.',
        ]
      : ['- done: true once you have seen the preview of this exact JSON and it looks right.']),
    ...(refused ? ['', `Your last draft was refused: ${refused}. Fix that.`] : []),
    ...(isMaker
      ? []
      : drafts.length > 0 && preview
      ? [
          '',
          `Your ${drafts.length} drafts:`,
          ...drafts.map((d, i) => `${i + 1}. ${d}`),
          `Their sheet is ${preview}. Read it. Line k shows draft k, its number at the left, as the terminal`,
          `shows the band, in ${SHEET_POSES.length} poses: ${SHEET_POSES.join('; ')}.`,
          ...(isTwice
            ? [`A draft that keeps the body shows them on the skin and then the same ${SHEET_POSES.length} on Clawd's own body. It must work on both.`]
            : []),
          'Compare them with the reference image, or with the title when there is none, and pick the one',
          'that is easiest to recognise at this size. Fix what the sheet shows is off in it; a feature of',
          'another draft may be taken over. Reply with the fixed JSON, "pick": its number, and "done": false.',
        ]
      : draft && isBefore
      ? [
          '',
          `The look as it is now: ${draft}`,
          ...(preview
            ? [
                `Its preview is ${preview}. Read it. It is a sheet of ${PREVIEW_POSES.length} panels, ${PREVIEW_PER_LINE} per line, each the`,
                `band as the terminal shows it with Clawd in this look, in these poses: ${poses}.`,
                ...propLines,
                ...twiceLines,
              ]
            : []),
          'Make the change asked for and reply with the changed JSON and "done": false.',
        ]
      : draft && preview
      ? [
          '',
          `Your last draft: ${draft}`,
          `Its preview is ${preview}. Read it. It is a sheet of ${PREVIEW_POSES.length} panels, ${PREVIEW_PER_LINE} per line, each the`,
          `band as the terminal shows it with Clawd in your look, in these poses: ${poses}.`,
          ...propLines,
          ...twiceLines,
          ...(change ? ['Check first that it carries the change asked for.'] : []),
          'Compare it with the reference image, or with the title when there is none, and work out what',
          'makes it harder to recognise at this size: silhouette, eyes, legs, arms, proportions. If any of',
          'that can be fixed within the limits, reply with the corrected JSON and "done": false. Reply with',
          'the same JSON and "done": true only when no change would make it clearly more recognisable.',
        ]
      : []),
  ].join('\n')
}

/** A look a model drew, under the name asked for, with its own title or else the one asked for. */
function lookFrom<T extends { name: string; title: string }>(kit: Kit<T>, raw: unknown, name: string, title: string): T | string {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const look = kit.parse({ ...r, name, title: typeof r.title === 'string' && r.title.trim() ? r.title : title })
  return typeof look === 'string' ? look : kit.check(look) || look
}

/** An emote or a skin to change, and the change asked for (/clawd emote change, /clawd skin change). */
type Change<T> = { look: T & Dated; text: string }

/**
 * A model draws a new emote or skin: EMOTE_DRAFTS drafts, then a round in
 * which it sees them side by side, picks one and fixes it, then a round in
 * which it sees the pick's preview and corrects it. With `start`, the first
 * draft is the look as it is now, and the model makes the change asked for.
 * With `replace`, the look is drawn again from scratch and goes into that
 * look's file. The look, or why there is none.
 */
async function makeEmote<T extends { name: string; title: string }>(
  $: EngineInterface,
  kit: Kit<T>,
  name: string,
  title: string,
  why: string,
  image: string,
  start?: Change<T>,
  form: Form = '',
  replace?: T & Dated,
): Promise<(T & Dated) | string> {
  // The drafts are told the other looks of the kind; the one drawn again is left out.
  const others = start ? [] : (await loadLooks($, kit)).filter(l => l.name !== name).map(l => `- ${l.name}: ${oneLine(kit.what(l), 100)}`)
  let best: T | null = null
  let draft = start ? JSON.stringify(kit.json(start.look)) : ''
  let preview = start ? await previewLook($, kit, start.look, `${name}.before`) : ''
  let drafts: string[] = [] // the drafts to pick from, as JSON
  let refused = ''
  for (let round = 1; round <= EMOTE_ROUNDS; round++) {
    // The run may read the reference image and the newest preview, nothing else.
    const reads = [image, preview].filter(Boolean).map(p => `Read(/${p})`)
    const argv = [
      'claude', '-p', '--model', MAKE_MODEL, '--effort', 'medium', '--safe-mode', '--setting-sources', '',
      '--no-session-persistence', '--tools', 'Read', '--permission-mode', 'dontAsk',
      ...(reads.length > 0 ? ['--allowedTools', ...reads] : []),
    ]
    const r = await $.process.run(argv, {
      cwd: mod.dataDir,
      stdin: emotePrompt(kit.kind, name, title, why, image, draft, preview, refused, start?.text, start !== undefined && round === 1, drafts, form, others),
      timeoutMs: EMOTE_ROUND_MS,
    })
    if (r.exitCode !== 0) return `claude exited ${r.exitCode} in round ${round}: ${oneLine(r.stderr || r.stdout, 200)}`
    const raw = parseJson(r.stdout)
    if (!start && !draft && drafts.length === 0) {
      // The drafts go on one sheet for the next round to pick from; a single one is a draft as usual.
      const list = raw?.drafts
      const looks = (Array.isArray(list) ? list : [raw]).slice(0, EMOTE_DRAFTS).map(d => lookFrom(kit, d, name, title))
      const good = looks.filter((l): l is T => typeof l !== 'string')
      refused = good.length > 0 ? '' : looks.join('; ') || 'no drafts'
      best = good[0] ?? best
      if (good.length > 1) {
        drafts = good.map(l => JSON.stringify(kit.json(l)))
        preview = `${mod.dataDir}/${kit.kind}s/previews/${name}.drafts.png`
        await writeBytes($, preview, kit.sheet(good))
      } else if (good[0]) {
        draft = JSON.stringify(kit.json(good[0]))
        preview = await previewLook($, kit, good[0], `${name}.draft${round}`)
      }
      continue
    }
    const look = lookFrom(kit, raw, name, title)
    if (typeof look === 'string') {
      refused = look
      continue
    }
    refused = ''
    // Done counts only for a draft whose preview the model has seen; for a
    // change, not before the model has seen its own changed draft.
    const json = JSON.stringify(kit.json(look))
    best = look
    if (raw?.done === true && json === draft && !(start && round === 1)) break
    draft = json
    drafts = []
    preview = await previewLook($, kit, look, `${name}.draft${round}`)
  }
  if (!best) return `no usable draft in ${EMOTE_ROUNDS} rounds: ${refused}`
  return saveLook($, kit, best, name, why, image, start, replace)
}

/** Writes a drawn emote or skin and its preview; a changed or redrawn one goes back into its file. */
async function saveLook<T extends { name: string; title: string }>(
  $: EngineInterface,
  kit: Kit<T>,
  best: T,
  name: string,
  why: string,
  image: string,
  start?: Change<T>,
  replace?: T & Dated,
): Promise<T & Dated> {
  const made = new Date(await $.clock.now()).toISOString()
  // A changed or redrawn look goes back where it was; the old one is kept in data/<kind>s/old/.
  const was = start?.look ?? replace
  const file = was?.file ?? `${mod.dataDir}/${kit.kind}s/${name}.json`
  if (was) await $.fs.write(await oldPath($, kit.kind, name), await $.fs.read(file))
  const changed = start ? { change: start.text } : {}
  await $.fs.write(file, `${JSON.stringify({ ...kit.json(best), made, project: mod.project, why, image, ...changed }, null, 2)}\n`)
  await previewLook($, kit, best)
  return { ...best, made, project: mod.project, why, image, file }
}

/** Where an act's, an emote's or a skin's old file goes when it is changed or deleted: data/<kind>s/old/<name>.<time>.json. */
async function oldPath($: EngineInterface, kind: MadeKind, name: string): Promise<string> {
  const stamp = new Date(await $.clock.now()).toISOString().replace(/[:.]/g, '-')
  return `${mod.dataDir}/${kind}s/old/${name}.${stamp}.json`
}

/**
 * Starts drawing an emote in the background; it plays on `who` when done. It
 * runs from a timer, so it outlives the hook that asked for it. With
 * `replace`, that emote is drawn again from scratch.
 */
function startEmote(
  $: EngineInterface,
  name: string,
  title: string,
  why: string,
  image: string,
  who: string,
  start?: Change<Emote>,
  form: Form = '',
  replace?: MadeEmote,
): void {
  brain.making = name
  const w = clawd.world
  const label = start ? ` · changing ${name}: "${start.text}"` : replace ? ` · drawing ${name} again` : ` · new emote coming: "${title}"`
  if (w) callLabel(w, [], label)
  $.clock.after(1, () => void drawEmote($, name, title, why, image, who, start, form, replace))
}

async function drawEmote(
  $: EngineInterface,
  name: string,
  title: string,
  why: string,
  image: string,
  who: string,
  start?: Change<Emote>,
  form: Form = '',
  replace?: MadeEmote,
): Promise<void> {
  const result = await drawn($, EMOTE_KIT, name, title, why, image, start, form, replace)
  if (typeof result === 'string') return
  const w = clawd.world
  if (w) {
    callActs(w, [{ who, what: result, delay: 0 }])
    callLabel(w, [{ who, name: `${name} (${start ? 'changed' : replace ? 'drawn again' : 'new emote'}) "${result.title}"` }])
  }
  brain.recent = [`${who}: ${name}`, ...brain.recent].slice(0, 8)
  $.ui.toast(start ? `Clawd's emote ${name} is changed` : replace ? `Clawd's emote ${name} is drawn again` : `Clawd has a new emote: ${name}`)
}

/**
 * Who wears a new skin for the rest of the session: the person, as with
 * /clawd skin <skin>, or the autopicker, whose skin a /clawd skin choice outranks.
 */
type SkinSlot = 'chosen' | 'picked'

/**
 * Starts drawing a skin in the background, as startEmote does an emote. A
 * new skin is worn for the rest of the session, in `slot`; a changed or
 * redrawn one comes on when it is the skin worn now.
 */
function startSkin(
  $: EngineInterface,
  name: string,
  title: string,
  why: string,
  image: string,
  start?: Change<Skin>,
  replace?: MadeSkin,
  slot: SkinSlot = 'chosen',
): void {
  brain.making = name
  const w = clawd.world
  const label = start ? ` · changing the skin ${name}: "${start.text}"` : replace ? ` · drawing the skin ${name} again` : ` · new skin coming: "${title}"`
  if (w) callLabel(w, [], label)
  $.clock.after(1, () => void drawSkin($, name, title, why, image, start, replace, slot))
}

async function drawSkin(
  $: EngineInterface,
  name: string,
  title: string,
  why: string,
  image: string,
  start: Change<Skin> | undefined,
  replace: MadeSkin | undefined,
  slot: SkinSlot,
): Promise<void> {
  const result = await drawn($, SKIN_KIT, name, title, why, image, start, '', replace)
  if (typeof result === 'string') return
  if (!start && !replace && slot === 'chosen') await update($, clawdSkin, () => name)
  if (!start && !replace && slot === 'picked') await update($, clawdPickedSkin, () => name)
  await applySkin($, true)
  const w = clawd.world
  if (w) callLabel(w, [], ` · skin ${name} (${start ? 'changed' : replace ? 'drawn again' : 'new'}) "${result.title}"`)
  $.ui.toast(
    start ? `Clawd's skin ${name} is changed` : replace ? `Clawd's skin ${name} is drawn again` : `Clawd wears its new skin ${name} for this session`,
  )
}

/** Draws the look; on failure, says so in the band, a toast and /clawd, and answers why. */
async function drawn<T extends { name: string; title: string }>(
  $: EngineInterface,
  kit: Kit<T>,
  name: string,
  title: string,
  why: string,
  image: string,
  start?: Change<T>,
  form: Form = '',
  replace?: T & Dated,
): Promise<(T & Dated) | string> {
  let result: (T & Dated) | string
  try {
    result = (await makeLookByMaker($, kit, name, title, why, image, start, form, replace)) ?? (await makeEmote($, kit, name, title, why, image, start, form, replace))
  } catch (err) {
    result = String(err)
  } finally {
    brain.making = ''
  }
  if (typeof result !== 'string') return result
  failed($, start ? `${kit.kind} change` : replace ? `${kit.kind} redraw` : `new ${kit.kind}`, name, result)
  return result
}

/** Says in the band, a toast and /clawd that making an act, an emote or a skin failed, and why. */
function failed($: EngineInterface, what: string, name: string, why: string): void {
  const w = clawd.world
  if (w) callLabel(w, [], ` · ${what} failed`)
  $.ui.log(`clawd: ${what} ${name} failed: ${why}`, { to: 'debug' })
  $.ui.toast(`Clawd's ${what} ${name} failed; /clawd says why`)
  brain.makeError = `${name}: ${why}`
}

/** One make the maker agent works on: what its Read may open, how a draft is rendered, and how it ends. */
type MakerJob = {
  kind: MadeKind
  name: string
  prompt: string
  reads: Set<string> // exact paths: the reference image and the PNGs it was given
  render: (draft: unknown, drafts: unknown) => Promise<string>
  state: 'queued' | 'spawning' | 'running' | 'ended'
  deadline: number
  started: (agentId: string | undefined, why: string) => void
  ended: (answer: string, reason: string) => void
}

// The maker's working state; a hot reload starts it over, and a maker of the old load is refused everything.
const maker = {
  type: '', // `<plugin>:maker` once registered; '' leaves every make to the rounds
  queue: [] as MakerJob[],
  jobs: new Map<string, MakerJob>(), // by agentId, while it runs
  others: new Map<string, boolean>(), // other subagents: whether each is a maker this load did not start
}

/** How a maker run went: its answer, or why it did not start, in which case the rounds run. */
type MakerEnd = { isStarted: false; why: string } | { isStarted: true; answer: string; reason: string }

/** Queues a make for `spawnQueued` and asks for a band render; resolves once the maker answered, or did not start. */
function runMaker($: EngineInterface, kind: MadeKind, name: string, prompt: string, reads: Set<string>, render: MakerJob['render']): Promise<MakerEnd> {
  if (!maker.type) return Promise.resolve({ isStarted: false, why: 'no maker agent is registered' })
  return new Promise<MakerEnd>(resolve => {
    const job: MakerJob = {
      kind,
      name,
      prompt,
      reads,
      render,
      state: 'queued',
      deadline: 0,
      started: (agentId, why) => {
        if (agentId !== undefined || job.state === 'ended') return
        job.state = 'ended'
        resolve({ isStarted: false, why })
      },
      ended: (answer, reason) => {
        if (job.state === 'ended') return
        job.state = 'ended'
        for (const [id, j] of maker.jobs) if (j === job) maker.jobs.delete(id)
        resolve({ isStarted: true, answer, reason })
      },
    }
    maker.queue.push(job)
    $.ui.invalidate('ui.render')
    $.clock.after(MAKER_START_MS, () => {
      if (job.state !== 'queued') return
      maker.queue = maker.queue.filter(j => j !== job)
      job.started(undefined, `not started within ${MAKER_START_MS / 1000} s, so no band was drawn`)
    })
    // A maker that never answers (a stall, a reload) fails the make; the rounds do not run then.
    $.clock.after(MAKER_START_MS + MAKER_MS + MAKER_GRACE_MS, () => job.ended('', NO_ANSWER))
  })
}

/**
 * Starts the queued makes, from the band's ui.render hook: only a spawn made
 * inside a hook leaves the maker's tool calls to this mod's tool.check and
 * tool.call hooks. Never call it from a timer or after a hook returned.
 */
async function spawnQueued($: EngineInterface): Promise<void> {
  for (let job = maker.queue.shift(); job; job = maker.queue.shift()) {
    job.state = 'spawning'
    let why = ''
    try {
      const now = await $.clock.now()
      const r = await $.agent.spawn({ subagentType: maker.type, prompt: job.prompt, description: `clawd: ${job.kind} ${job.name}` })
      if ('agentId' in r && r.agentId) {
        // Ended while the spawn ran (its time ran out): it stays out of the jobs, so the stray check refuses its calls.
        if ((job.state as MakerJob['state']) === 'ended') continue
        job.deadline = now + MAKER_MS
        maker.jobs.set(r.agentId, job)
        job.state = 'running'
        job.started(r.agentId, '')
        continue
      }
      why = 'deny' in r ? String(r.deny) : 'no agent id'
    } catch (err) {
      why = err instanceof Error ? err.message : String(err)
    }
    job.started(undefined, why)
  }
}

/** The verdict on a call in a maker's loop: render, ToolSearch, and Read of the exact files it was given; nothing after its time. */
function makerVerdict(job: MakerJob, tool: string, input: Record<string, unknown>, now: number): { decision: 'allow' } | { decision: 'deny'; reason: string } {
  if (now > job.deadline) return { decision: 'deny', reason: 'clawd: the time for this make is up; answer now with one line.' }
  if (tool === RENDER_TOOL || tool === 'ToolSearch') return { decision: 'allow' }
  if (tool === 'Read' && typeof input.file_path === 'string' && job.reads.has(input.file_path)) return { decision: 'allow' }
  return { decision: 'deny', reason: `clawd: the maker may only call ${RENDER_TOOL} and Read the files it was given.` }
}

/** Whether a subagent this load did not start is a maker, of an earlier load; asked once per agent. */
async function isStrayMaker($: EngineInterface, agentId: string): Promise<boolean> {
  const known = maker.others.get(agentId)
  if (known !== undefined) return known
  const isMaker = (await $.agent.list()).find(a => a.id === agentId)?.type === maker.type
  maker.others.set(agentId, isMaker)
  return isMaker
}

/** What a maker run came to: the made thing's draft, why it failed, or undefined when it did not start. */
function makerOutcome(end: MakerEnd, name: string, hasDraft: boolean): string | undefined {
  if (!end.isStarted) return undefined
  // A draft is kept only through the render tool, which answers only in a confined maker's loop.
  if (!hasDraft) return `the maker rendered no usable draft (${end.reason}): ${oneLine(end.answer, 200) || 'no answer'}`
  if (end.reason === NO_ANSWER) return `the maker did not answer in time for ${name}`
  if (/^failed\b/i.test(end.answer.trim())) return `the maker gave up on ${name}: ${oneLine(end.answer, 200)}`
  return ''
}

/**
 * The maker draws an emote or a skin, rendering to previews/<name>.r<N>.png;
 * with `start` it changes that look, with `replace` it draws it again. The
 * look, why it failed, or undefined when the maker did not start.
 */
async function makeLookByMaker<T extends { name: string; title: string }>(
  $: EngineInterface,
  kit: Kit<T>,
  name: string,
  title: string,
  why: string,
  image: string,
  start?: Change<T>,
  form: Form = '',
  replace?: T & Dated,
): Promise<(T & Dated) | string | undefined> {
  if (!maker.type) return undefined
  const others = start ? [] : (await loadLooks($, kit)).filter(l => l.name !== name).map(l => `- ${l.name}: ${oneLine(kit.what(l), 100)}`)
  const draft = start ? JSON.stringify(kit.json(start.look)) : ''
  const before = start ? await previewLook($, kit, start.look, `${name}.before`) : ''
  const reads = new Set([image, before].filter(Boolean))
  let last = null as T | null // the last draft rendered alone
  let n = 0
  const render = async (one: unknown, several: unknown): Promise<string> => {
    const looks = (Array.isArray(several) ? several.slice(0, EMOTE_DRAFTS) : [one]).map(d => lookFrom(kit, d, name, title))
    const good = looks.filter((l): l is T => typeof l !== 'string')
    const notes = looks.flatMap((l, i) => (typeof l === 'string' ? [`Draft ${i + 1} was refused: ${l}.`] : []))
    if (good.length === 0) return notes.join(' ') || 'No draft: give one as {"draft": {...}} or up to 3 as {"drafts": [...]}.'
    n += 1
    let path = `${mod.dataDir}/${kit.kind}s/previews/${name}.r${n}.png`
    if (good.length > 1) await writeBytes($, path, kit.sheet(good))
    else {
      last = good[0] as T
      path = await previewLook($, kit, last, `${name}.r${n}`)
    }
    reads.add(path)
    return [`Rendered ${good.length > 1 ? `${good.length} drafts` : 'the draft'} to ${path}. Read it.`, ...notes].join(' ')
  }
  const prompt = emotePrompt(kit.kind, name, title, why, image, draft, before, '', start?.text, start !== undefined, [], form, others, true)
  const end = await runMaker($, kit.kind, name, prompt, reads, render)
  const outcome = makerOutcome(end, name, last !== null)
  if (outcome === undefined) {
    $.ui.log(`clawd: the maker did not start for ${name} (${end.isStarted ? '' : end.why}); the rounds run`, { to: 'debug' })
    return undefined
  }
  if (outcome || !last) return outcome
  return saveLook($, kit, last, name, why, image, start, replace)
}

/** The maker writes an act, rendering to acts/previews/<name>.r<N>.png; as makeAct, or undefined when the maker did not start. */
async function makeActByMaker(
  $: EngineInterface,
  name: string,
  title: string,
  why: string,
  made: Routine[],
  emotes: Emote[],
  skins: Skin[],
  change?: ActChange,
  replace?: MadeAct,
): Promise<MadeAct | string | undefined> {
  if (!maker.type) return undefined
  const find = finder(made, emotes, skins)
  const reads = new Set<string>()
  let last = null as Routine | null // the last version that rendered
  let n = 0
  const render = async (one: unknown): Promise<string> => {
    const steps = typeof one === 'object' && one !== null ? (one as Record<string, unknown>).steps : undefined
    const routine = routineFrom({ name, title, steps })
    if (typeof routine === 'string') return `The steps were refused: ${routine}.`
    n += 1
    const path = `${mod.dataDir}/acts/previews/${name}.r${n}.png`
    const { png, frames } = actPreview(linkRoutine(routine, find), mod.skin)
    await writeBytes($, path, png)
    reads.add(path)
    last = routine
    return `Rendered the act in ${frames} frames to ${path}. Read it.`
  }
  const prompt = makePrompt(name, title, why, made.filter(r => r.name !== name), emotes, skins, change, MAKER_ACT_END)
  const end = await runMaker($, 'act', name, prompt, reads, render)
  const outcome = makerOutcome(end, name, last !== null)
  if (outcome === undefined) {
    $.ui.log(`clawd: the maker did not start for ${name} (${end.isStarted ? '' : end.why}); the text call runs`, { to: 'debug' })
    return undefined
  }
  if (outcome || !last) return outcome
  return saveAct($, last, name, why, change, replace)
}

/** Registers the maker agent and its render tool; without them every make runs the rounds. */
async function registerMaker($: EngineInterface): Promise<void> {
  try {
    await $.tool.register({
      name: 'render',
      description:
        "Clawd's maker only: checks a draft of a look or an act and draws it as a PNG, answering the PNG's path or why the draft was refused. Read-only: it writes nothing but the preview.",
      inputSchema: {
        type: 'object',
        properties: {
          draft: { type: 'object', description: 'One draft: a look as JSON, or {"steps": [...]} for an act.' },
          drafts: { type: 'array', items: { type: 'object' }, description: 'Up to 3 drafts of a look, drawn side by side.' },
        },
      },
      isDeferred: true,
    })
    const r = await $.agent.register({
      name: 'maker',
      description: 'Makes one act, emote or skin for the clawd mod and checks its renders. Started by the mod only.',
      prompt: MAKER_SYSTEM,
      tools: ['Read', 'ToolSearch', RENDER_TOOL],
      model: MAKE_MODEL,
      effort: 'medium',
      permissionMode: 'dontAsk',
      maxTurns: MAKER_TURNS,
      omitClaudeMd: true,
      background: true,
    })
    maker.type = r.agent
  } catch (err) {
    maker.type = ''
    $.ui.log(`clawd: the maker agent was not registered, so makes run the rounds: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
  }
}

/** With `/clawd trace`, keeps the pick in data/picks/<session id>.jsonl, the last TRACE_MAX. */
async function tracePick($: EngineInterface, t: Trace): Promise<void> {
  if (!(await read($, isTracing))) return
  const path = `${mod.dataDir}/picks/${await $.session.id()}.jsonl`
  let lines: string[] = []
  try {
    lines = (await $.fs.read(path)).split('\n').filter(Boolean)
  } catch {
    // the first pick traced in this session
  }
  lines = [...lines, JSON.stringify(t)].slice(-TRACE_MAX)
  try {
    await $.fs.write(path, `${lines.join('\n')}\n`)
  } catch (err) {
    $.ui.log(`clawd: trace not written: ${String(err)}`, { to: 'debug' })
  }
}

/**
 * With `/clawd debug`, shows the pick in the transcript, in
 * rows the model never sees: the trigger, the model and its tokens; the request
 * it was sent, one row per line, its parts left out while they are as last
 * shown (clawd-context.ts); the whole reply; what came of it.
 * A row shows no line breaks (it draws a glyph for each; tested live
 * 2026-10-07), so the reply's whitespace is collapsed. `$.model.complete`
 * returns the reply's text only, so the model's thinking cannot be shown.
 */
async function debugPick($: EngineInterface, t: Trace, model: string, tokens: string): Promise<void> {
  if (!(await read($, isDebugging))) return
  $.ui.log(`Clawd debug · autopick, ${t.trigger} · ${model}${tokens}`)
  for (const row of contextRows(contextParts(t.system, t.prompt), brain.shown)) $.ui.log(row)
  $.ui.log(`reply: ${t.reply.replace(/\s+/g, ' ').trim() || '(none)'}`)
  $.ui.log(`→ ${t.outcome}`)
}

async function localTime($: EngineInterface): Promise<string> {
  try {
    const r = await $.process.run(['date', '+%a %H:%M'], { timeoutMs: 3000 })
    return r.stdout.trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * What an emote does to Clawd, for the picker and the act writer. The title
 * of one that keeps the body often starts with "Clawd", so it is not put
 * after "turns into".
 */
function emoteWhat(e: Emote): string {
  if (e.body) return `Clawd turns into ${e.title}`
  const keys = e.prop?.path ?? []
  const [first, last] = [keys[0], keys.at(-1)]
  // Past y 10 a prop has left the band.
  const how = (last?.y ?? 0) >= 10 ? ' that flies off' : keys.some(k => k.x !== first?.x || k.y !== first?.y) ? ' that moves' : ''
  const parts = [e.tool && 'a tool in its hand', e.prop && `a thing beside it${how}`]
  return `Clawd keeps the body it has, with ${parts.filter(Boolean).join(' and ')}: ${e.title}`
}

/**
 * The picker's prompt. With `mayWear` (no /clawd skin choice this session) it
 * lists the skins as calls and may ask for a new one; both are worn for the
 * rest of the session.
 */
function pickPrompt(
  w: World,
  trigger: string,
  made: MadeAct[],
  emotes: MadeEmote[],
  skins: MadeSkin[],
  mayWear: boolean,
  madeToday: number,
  now: number,
  time: string,
): string {
  const lines = brain.feed.map(l => l.text)
  const first = brain.feed[0]
  if (first && first.n > brain.seen + 1) lines.unshift(`(${first.n - brain.seen - 1} earlier lines dropped)`)
  const newest = made[0]
  const doing = (a: World['act']) => (a ? (a.routine ?? a.kind) : 'between acts')
  const minis = w.minis.filter(m => !m.isLeaving)
  const canMake = madeToday < NEW_PER_DAY
  const wearable = mayWear ? skins.filter(x => x.name !== mod.skin?.name) : []
  const body = mod.skin ? `wears the skin ${mod.skin.name} ("${oneLine(mod.skin.title, 60)}") this session` : 'in its own body'
  return [
    `<session_summary>${brain.summary || '(nothing yet)'}</session_summary>`,
    '<new_since_your_last_pick>',
    ...(lines.length > 0 ? lines : ['(nothing new)']),
    '</new_since_your_last_pick>',
    '<situation>',
    `trigger: ${trigger}`,
    `project: ${mod.project}`,
    `local time: ${time}`,
    `session running for ${ago(now - mod.startedAt)}; last session event ${ago((w.t - w.lastEventAt) * 1000)} ago`,
    `the session is ${w.mode === 'work' ? 'working' : 'idle'}; ${w.pile} bricks on the pile (one per tool call that does more than read)`,
    `your recent calls, newest first: ${brain.recent.join(', ') || 'none'}`,
    '</situation>',
    '<entities>',
    `clawd: Clawd itself, for the main session; ${body}; doing ${doing(w.act)}`,
    ...minis.map(
      m =>
        `${m.id}: a mini Clawd for the subagent "${oneLine(m.title, 60)}" (${m.kind}); running ` +
        `${ago((w.t - m.since) * 1000)}, ${m.tools} tool calls; doing ${doing(m.act)}`,
    ),
    '</entities>',
    `<newest_made_act>${
      newest
        ? `${newest.name}: "${newest.title}", made ${ago(now - Date.parse(newest.made))} ago in ${newest.project || '?'} because: ${newest.why || '?'}`
        : 'none yet'
    }</newest_made_act>`,
    '<acts>',
    ...Object.entries(PICKABLE).map(([name, what]) => `${name}: ${what}`),
    ...made.map(r => `${r.name}: ${r.title}`),
    ...emotes.map(e => `${e.name}: an emote, clawd only, ${e.dur} s: ${emoteWhat(e)}`),
    ...wearable.map(x => `${x.name}: a skin, clawd only, for the rest of the session: Clawd's body becomes ${x.title}`),
    '</acts>',
    '',
    'Return {"summary": "...", "calls": [{"who": "clawd", "play": "...", "delay": 0}], "why": "...", "new": null}.',
    '- summary: at most three sentences. Update the session summary with what is new: what the',
    '  session is about, how it is going, the mood. Keep it as it is when nothing is new.',
    '- calls: what to play, like parallel tool calls: one call, or several for several entities.',
    '  who: an id from <entities>, or "all". play: a name from <acts>. delay: seconds from now,',
    `  0 to ${MAX_DELAY_S}. Calls with the same delay start together; different delays stagger them,`,
    '  e.g. a wave that runs from clawd to a1 to a2. Several calls for one entity play one after',
    '  another; after an emote, the further calls for clawd play while it wears the look, so an emote',
    '  with a tool and then a wave waves the tool. A call cuts in on what the entity is doing, except',
    '  a reaction to a session event, which it waits for. Leave out entities that have no reason to',
    '  react. Vary the acts: avoid your recent calls unless one clearly fits best. Quiet moments suit',
    '  calm acts.',
    ...(wearable.length > 0 ? ['  A skin stays on for the rest of the session: call one only when the person asks Clawd to stay that.'] : []),
    '- why: a few words.',
    // Tuned with replays through Haiku (2026-10-03): the earlier "null, unless no
    // act fits" wording answered "hi snowman" with a wave, 0 of 18 nicknames.
    canMake
      ? '- new: first read what the person just wrote. When they call Clawd by a name, compare it to\n' +
        '  something or ask Clawd itself for a trick ("hey pirate", "he looks like a teapot", "do a cartwheel"),\n' +
        '  they want to see Clawd become that thing or do that trick. If no act in <acts> shows exactly\n' +
        '  that, ask for one. A task the person gives the session (open an app, a page or a file, fix\n' +
        "  a bug) is work for the assistant: answer it with acts from <acts>, since Clawd's moves cannot\n" +
        '  show windows, pages or files. Asking is\n' +
        '  {"name": "snake_case_name", "title": "what it shows and when it fits, under 80 characters",\n' +
        '  "for": "<who plays it first>"}; otherwise new is null. Add "look": "become" when Clawd should\n' +
        '  look like that thing (a pirate, a teapot), or "look": "hold" when it should hold, use or show a\n' +
        '  thing (a guitar, a telescope, a cake), rather than do a trick: then it is drawn as a new emote.\n' +
        (mayWear
          ? '  Add "look": "skin" instead when they ask Clawd to stay that thing from now on ("be a cat from\n' +
            '  now on", "stay a pirate for the rest of the day"): then it is drawn as a new skin, which Clawd\n' +
            '  wears for the rest of the session.\n'
          : '') +
        '  A thing to hold is drawn on whatever body Clawd has. Ask no new look for what its skin shows.\n' +
        '  Add "image": "<path>" when the person wrote the path of a local image of that thing. calls\n' +
        '  still name acts from <acts>: play the closest one while the new act is written.\n' +
        `  ${madeToday} of at most ${NEW_PER_DAY} new acts, emotes and skins were made in the last 24 hours.`
      : `- new: null. The ${NEW_PER_DAY} new acts, emotes and skins for the last 24 hours are made.`,
  ].join('\n')
}

/** A made act to change, and the change asked for (/clawd act change). */
type ActChange = { act: MadeAct; text: string }

/** An act's steps as its file keeps them: the names of its emote and play steps, not what they were linked to. */
function plainSteps(r: Routine): Step[] {
  return r.steps.map(({ worn: _worn, inner: _inner, ...rest }) => rest)
}

// How the maker works on an act, in place of the reply the text call gives.
const MAKER_ACT_END = [
  `At most 12 steps. Load ${RENDER_TOOL} with ToolSearch (query "select:${RENDER_TOOL}"), then hand it each`,
  'version as {"draft": {"steps": [...]}}. It answers the path of a PNG, or why the steps were refused: the',
  `band every ${ACT_PREVIEW_EVERY_S} s while the act plays, one frame per line from top to bottom. Read it, check that the act reads`,
  'as its title and that Clawd stays on the band, fix the steps and render again, as often as it helps.',
  'The act that is kept is the last version that rendered.',
].join('\n')

function makePrompt(
  name: string,
  title: string,
  why: string,
  made: Routine[],
  emotes: Emote[],
  skins: Skin[],
  change?: ActChange,
  end = 'At most 12 steps. Return {"steps": [...]}.',
): string {
  const names = (items: { name: string; title: string }[]) => items.map(x => `${x.name} ("${oneLine(x.title, 60)}")`).join(', ') || 'none yet'
  return [
    change ? 'Change the steps of an act.' : 'Write the steps for a new act.',
    `name: ${name}`,
    `title: ${title}`,
    `why it was asked for: ${why}`,
    `the session so far: ${brain.summary || '(no summary)'}`,
    ...(change
      ? [
          `The act as it is now: ${JSON.stringify({ steps: plainSteps(change.act) })}`,
          `The change asked for now: "${change.text}". Make that change and keep what it does not touch.`,
        ]
      : []),
    '',
    "Clawd's own body is 6 cells wide and stands on a floor line; above its head is one row of room",
    '(two when it jumps). A skin may make it wider or taller. A mini Clawd, half its size, may play',
    'the act too. Steps play one after another;',
    'the act should last 3 to 12 seconds. A step is an',
    'object with "do" and optional fields:',
    '- idle {dur}: stands and looks around. wave {dur}. look {dur}: looks left and right.',
    '  think {dur}: looks up with a question mark.',
    '- wander {to}, run {to}: walks or runs to a spot, to from 0 (left edge) to 1 (right edge).',
    '  run {wrap true, dir -1|1, to}: a lap: runs off the edge in dir and straight back in from the',
    '  other edge, on to `to` (default: where it started).',
    '- move {to, speed, ease, wrap, dir}: goes to `to` at `speed`: walk, run, or a number of walking',
    '  speeds from 0.25 to 4 (run is 3). ease true speeds up from a stand and slows to a stop, about',
    '  0.4 s each way. wrap and dir work as for run. wander and run also take speed and ease.',
    '- hop {n 1-3, height 1-6, sparks true|false}: hops in place.',
    '- jump {dir -1|1, height 1-6}: a big jump sideways.',
    '- celebrate: two hops with sparks, then a wave. trip: trips, lies flat with dizzy stars, gets',
    '  up. chase: chases a sparkle and jumps to catch it. peek: runs off one edge and comes back',
    '  from the other. alert: an exclamation mark, eyes wide.',
    '- pose {dur 0.2-4, shape, sit}: holds still. shape: normal, squash, stretch or flat. sit: true',
    '  sits.',
    '- Any step may also take arms, eyes, look and up, which hold for that whole step, so',
    '  {"do": "run", "arms": "wave"} runs and waves. arms: out, up, down, wave, flail or none. eyes:',
    '  open, closed or wide. look: -1 back, 0 ahead, 1 forward. up: true looks up.',
    '- mark {glyph}: a glyph over its head for a moment, one of ! ? * + ~ z o ^ #.',
    '- sparks {n 1-8}: gold sparks around it.',
    '- emote {name, dur 1-20}: puffs into a look by name; the steps after it play in that look for',
    "  dur seconds (default: the look's own time). A mini skips it. A look either turns Clawd into",
    '  something else for that time, or keeps the body Clawd has and adds a thing: a tool in its front',
    '  hand, which moves with the arm (wave and arms up swing it), or a prop that stands where Clawd',
    '  was or moves off on its own. After a look that adds a thing, let the steps use it: wave or raise',
    '  the tool, hop beside the prop, step back and look at it. Looks:',
    ...(emotes.length > 0 ? emotes.map(e => `  ${e.name}: ${emoteWhat(e)}`) : ['  none yet']),
    `  Skins, which turn Clawd into them: ${names(skins)}.`,
    "- play {name}: plays a made act's steps here. Inside it, that act's own play steps are skipped.",
    `  Made acts: ${names(made)}.`,
    end,
  ].join('\n')
}

/**
 * Opus writes the steps of a new act. With `change` it changes a made act's
 * steps; with `replace` it writes that act again from scratch. A changed or
 * rewritten act goes back into its file, the old file into data/acts/old/.
 * The act, or why there is none.
 */
async function makeAct(
  $: EngineInterface,
  name: string,
  title: string,
  why: string,
  made: Routine[],
  emotes: Emote[],
  skins: Skin[],
  change?: ActChange,
  replace?: MadeAct,
): Promise<MadeAct | string> {
  const answer = await $.model.complete({
    model: MAKE_MODEL,
    system: MAKE_SYSTEM,
    prompt: makePrompt(name, title, why, made.filter(r => r.name !== name), emotes, skins, change),
    maxTokens: 2000,
    effort: 'medium',
    timeoutMs: 120_000,
  })
  if (!answer.isAnswered) return answer.reason
  const routine = routineFrom({ name, title, steps: parseJson(answer.text)?.steps })
  if (typeof routine === 'string') return `${routine}; Opus wrote: ${oneLine(answer.text, 300)}`
  return saveAct($, routine, name, why, change, replace)
}

/** Writes an act a model wrote; a changed or rewritten one goes back into its file, the old file into data/acts/old/. */
async function saveAct($: EngineInterface, routine: Routine, name: string, why: string, change?: ActChange, replace?: MadeAct): Promise<MadeAct> {
  const act: MadeAct = { ...routine, made: new Date(await $.clock.now()).toISOString(), project: mod.project, why }
  const file = `${mod.dataDir}/acts/${name}.json`
  if (change || replace) await $.fs.write(await oldPath($, 'act', name), await $.fs.read(file))
  await $.fs.write(file, `${JSON.stringify({ ...act, ...(change ? { change: change.text } : {}) }, null, 2)}\n`)
  return act
}

/**
 * Starts writing an act in the background, as startEmote draws an emote; it
 * plays on `who` when done. With `change` a made act is changed, with
 * `replace` written again from scratch.
 */
function startAct($: EngineInterface, name: string, title: string, why: string, who: string, change?: ActChange, replace?: MadeAct, called: Called[] = []): void {
  brain.making = name
  const w = clawd.world
  const label = change ? ` · changing ${name}: "${change.text}"` : replace ? ` · writing ${name} again` : ` · new act coming: "${title}"`
  // A pick's own calls stay in the label beside the note.
  if (w) callLabel(w, called, label)
  $.clock.after(1, () => void writeAct($, name, title, why, who, change, replace))
}

async function writeAct($: EngineInterface, name: string, title: string, why: string, who: string, change?: ActChange, replace?: MadeAct): Promise<void> {
  const emotes = await loadEmotes($)
  const made = await loadMade($, emotes)
  const skins = (await loadSkins($)).filter(x => !x.isHidden)
  let result: MadeAct | string
  try {
    result = (await makeActByMaker($, name, title, why, made, emotes, skins, change, replace)) ?? (await makeAct($, name, title, why, made, emotes, skins, change, replace))
  } catch (err) {
    result = String(err)
  } finally {
    brain.making = ''
  }
  if (typeof result === 'string') return failed($, change ? 'act change' : replace ? 'act rewrite' : 'new act', name, result)
  const w = clawd.world
  if (w) {
    callActs(w, [{ who, what: linkRoutine(result, finder(made, emotes, skins)), delay: 0 }])
    callLabel(w, [{ who, name: `${name} (${change ? 'changed' : replace ? 'written again' : 'new'}) "${result.title}"` }])
  }
  brain.recent = [`${who}: ${name}`, ...brain.recent].slice(0, 8)
  $.ui.toast(change ? `Clawd's act ${name} is changed` : replace ? `Clawd's act ${name} is written again` : `Clawd has a new act: ${name}`)
}

const ASKED = 'asked with /clawd autopick now'

function schedulePick($: EngineInterface, now: number): void {
  brain.timer?.cancel()
  const ms = Math.round((PICK_MIN_S + Math.random() * (PICK_MAX_S - PICK_MIN_S)) * 1000)
  brain.dueAt = now + ms
  brain.timer = $.clock.after(ms, () => void pickNext($, 'timer'))
}

/** Asks the picker model what Clawd plays next, then sets the timer for the next pick. */
async function pickNext($: EngineInterface, trigger: string): Promise<void> {
  brain.timer?.cancel()
  brain.timer = null
  brain.dueAt = 0
  if (brain.isPicking) {
    brain.again = trigger
    return
  }
  const w = clawd.world
  const now = await $.clock.now()
  // Off, or paused while Remote Control is on, only /clawd autopick now picks, and no timer runs.
  if (trigger !== ASKED && !(await isPickingAlone($))) return
  if (!w || !clawd.requestId || !(await read($, isClawdOn))) return schedulePick($, now)
  // Asleep with no subagent running, Clawd waits for the next session event,
  // which wakes it and picks.
  if (trigger === 'timer' && isAsleep(w) && w.minis.length === 0) return
  brain.isPicking = true
  try {
    await pick($, w, trigger, now)
  } catch (err) {
    $.ui.log(`clawd: pick failed: ${String(err)}`, { to: 'debug' })
  } finally {
    brain.isPicking = false
    const again = brain.again
    brain.again = null
    if (again) void pickNext($, again)
    else if (await isPickingAlone($)) schedulePick($, await $.clock.now())
  }
}

async function pick($: EngineInterface, w: World, trigger: string, now: number): Promise<void> {
  const emotes = await loadEmotes($)
  const made = await loadMade($, emotes)
  const skins = await loadSkins($)
  // A skin the person chose with /clawd skin outranks the picker's, so the picker gets none then.
  const mayWear = (await read($, clawdSkin)) === null
  const madeToday = [...made, ...emotes, ...skins].filter(r => r.made && now - Date.parse(r.made) < DAY_MS).length
  const fedUpTo = brain.seq
  // What the person wrote in the lines this pick reads: an image path the picker names must be in there.
  const userWrote = brain.feed.filter(l => l.n <= fedUpTo && l.text.startsWith('user: ')).map(l => l.text).join('\n')
  const prompt = pickPrompt(w, trigger, made, emotes, skins.filter(x => !x.isHidden), mayWear, madeToday, now, await localTime($))
  const model = await autopickModel($)
  const answer = await $.model.complete({
    model,
    system: PICK_SYSTEM,
    prompt,
    maxTokens: 600,
    timeoutMs: 30_000,
  })
  const at = new Date(now).toISOString()
  const u = answer.usage
  const tokens = ` · ${u.input_tokens} tokens in, ${u.cache_read_input_tokens} cache read, ${u.cache_creation_input_tokens} cache write, ${u.output_tokens} out`
  const traced = async (reply: string, outcome: string) => {
    const t = { at, trigger, system: PICK_SYSTEM, prompt, reply, outcome }
    await debugPick($, t, model, tokens)
    await tracePick($, t)
  }
  if (!answer.isAnswered) {
    brain.last = { trigger, calls: [], why: `no answer: ${answer.reason}`, at: now }
    return traced('', `no answer: ${answer.reason}`)
  }
  brain.feed = brain.feed.filter(l => l.n > fedUpTo)
  brain.seen = fedUpTo
  const parsed = parseJson(answer.text)
  if (typeof parsed?.summary === 'string' && parsed.summary.trim()) brain.summary = parsed.summary.trim()
  const why = typeof parsed?.why === 'string' ? parsed.why : ''
  const byName = new Map<string, Routine | Emote>([...emotes.map(e => [e.name, e] as const), ...made.map(r => [r.name, r] as const)])
  const actOf = (name: unknown): Playable | undefined =>
    typeof name !== 'string' ? undefined : Object.hasOwn(PICKABLE, name) ? (name as ActKind) : byName.get(name)
  const skinOf = (name: unknown): MadeSkin | undefined => (mayWear ? skins.find(x => x.name === name) : undefined)
  const isWho = (who: string) => who === 'all' || bodyOf(w, who) !== undefined
  // A skin the picker calls or has drawn is Clawd's body for the rest of the session.
  const wear = async (skin: string) => {
    await update($, clawdPickedSkin, () => skin)
    await applySkin($, true)
  }

  // The calls; a bare {"play"} is one call for Clawd.
  const raw = Array.isArray(parsed?.calls) ? parsed.calls : parsed?.play !== undefined ? [{ who: 'clawd', play: parsed.play }] : []
  const calls: Call[] = []
  const called: Called[] = []
  let worn: MadeSkin | undefined
  for (const item of raw.slice(0, 12)) {
    const c = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
    const who = typeof c.who === 'string' ? c.who : 'clawd'
    const skin = skinOf(c.play)
    if (skin) {
      // A skin is Clawd's alone, as an emote is: a mini stays a Clawd.
      if (who === 'clawd' || who === 'all') {
        worn = skin
        called.push({ who: 'clawd', name: skin.name, delay: 0 })
      }
      continue
    }
    const what = actOf(c.play)
    if (!isWho(who) || what === undefined) continue
    const delay = typeof c.delay === 'number' && Number.isFinite(c.delay) ? Math.min(MAX_DELAY_S, Math.max(0, c.delay)) : 0
    calls.push({ who, what, delay })
    called.push({ who, name: typeof what === 'string' ? what : what.name, delay })
  }
  // Haiku often plays the act it asks for before it exists; that call is
  // dropped above, and the ask still stands without any other call.
  const ask = parsed?.new as { name?: unknown; title?: unknown; for?: unknown; look?: unknown; image?: unknown } | null | undefined
  // "look": true, from before "hold" existed (2026-10-08), means "become".
  const form: Form | 'skin' | null =
    ask?.look === true || ask?.look === 'become' ? 'become' : ask?.look === 'hold' ? 'hold' : ask?.look === 'skin' ? 'skin' : null
  const kind: MadeKind = form === 'skin' ? 'skin' : form ? 'emote' : 'act'
  const isAsking = !!ask && typeof ask.name === 'string' && typeof ask.title === 'string'
  if (called.length === 0 && !isAsking) {
    brain.last = { trigger, calls: [], why: `unusable reply: ${oneLine(answer.text, 80)}`, at: now }
    return traced(answer.text, 'unusable reply: no call names a known body and act')
  }
  if (called.length > 0) {
    if (calls.length > 0) callActs(w, calls)
    if (worn) await wear(worn.name)
    callLabel(w, called)
    brain.recent = [...called.map(callText), ...brain.recent].slice(0, 8)
  }
  brain.last = { trigger, calls: called, why, at: now }
  const playing = `played ${called.map(callText).join(', ') || 'nothing'}`

  // A new act, emote or skin, when asked for and allowed; an act plays on `for` once written.
  if (!ask || typeof ask.name !== 'string' || typeof ask.title !== 'string') return traced(answer.text, `${playing}; no new act`)
  if (madeToday >= NEW_PER_DAY) return traced(answer.text, `${playing}; new ${kind} ${ask.name} asked, but ${NEW_PER_DAY} were made today`)
  const name = ask.name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30)
  const title = oneLine(ask.title, 80)
  const target = typeof ask.for === 'string' && isWho(ask.for) ? ask.for : 'clawd'
  // Acts, emotes and skins share their names with each other and with the /clawd words.
  if (RESERVED.includes(name)) return traced(answer.text, `${playing}; new ${kind} ${name} refused: the name is a /clawd word`)
  const existing = actOf(name)
  if (existing !== undefined) {
    // It asked for one that exists: play that.
    callActs(w, [{ who: target, what: existing, delay: 0 }])
    callLabel(w, [{ who: target, name }])
    return traced(answer.text, `${playing}; new ${kind} ${name} exists, played that`)
  }
  if (skins.some(x => x.name === name)) {
    if (!mayWear) return traced(answer.text, `${playing}; new ${kind} ${name} exists as a skin, but the person chose a skin with /clawd skin`)
    await wear(name)
    return traced(answer.text, `${playing}; new ${kind} ${name} exists as a skin, worn for the session`)
  }
  if (form) {
    // A new look: drawn in the background, so the picks go on meanwhile.
    if (form === 'skin' && !mayWear) return traced(answer.text, `${playing}; new skin ${name} refused: the person chose a skin with /clawd skin`)
    if (brain.making) return traced(answer.text, `${playing}; new ${kind} ${name} asked, but ${brain.making} is still being made`)
    const image = typeof ask.image === 'string' && userWrote.includes(ask.image) ? await imagePath($, ask.image) : ''
    if (form === 'skin') startSkin($, name, title, why, image, undefined, undefined, 'picked')
    else startEmote($, name, title, why, image, 'clawd', undefined, form)
    return traced(answer.text, `${playing}; new ${kind} ${name}${form === 'skin' ? '' : ` (${form})`} being drawn${image ? ` after ${image}` : ''}`)
  }
  // One model makes one thing at a time; an act being written has no file yet, so a second write would race it.
  if (brain.making) return traced(answer.text, `${playing}; new act ${name} asked, but ${brain.making} is still being made`)
  // Written in the background since 2026-10-26, as a look is drawn, so the picks go on while the maker works.
  startAct($, name, title, why, target, undefined, undefined, called)
  return traced(answer.text, `${playing}; new act ${name} being written`)
}

/** What a `/clawd` word may name now: the minis on screen, the emotes, the skins, the made acts, the built-in acts. */
async function loadNames($: EngineInterface): Promise<Names> {
  const emotes = await loadEmotes($)
  const made = await loadMade($, emotes)
  const skins = (await loadSkins($)).filter(x => !x.isHidden)
  const minis = (clawd.world?.minis ?? []).filter(m => !m.isLeaving)
  return {
    minis: Object.fromEntries(minis.map(m => [m.id, `the mini for "${oneLine(m.title, 40)}"`])),
    emotes: Object.fromEntries(emotes.map(x => [x.name, x.title])),
    skins: Object.fromEntries(skins.map(x => [x.name, x.title])),
    made: Object.fromEntries(made.map(r => [r.name, r.title])),
    acts: Object.fromEntries(ACTS.map(a => [a, ACT_WHAT[a] ?? 'an act'])),
    isSkinOnly: mod.fileSkin !== '',
  }
}

/** Sets the menu above the prompt (undefined closes it); a write only when it changes. */
async function setMenu($: EngineInterface, menu: Menu | undefined): Promise<void> {
  const now = await read($, clawdMenu)
  if (JSON.stringify(now) !== JSON.stringify(menu ?? null)) await update($, clawdMenu, () => menu ?? null)
}

/** The text cut to n cells, ending in `...` when cut. */
function cut(s: string, n: number): string {
  if (s.length <= n) return s
  return n <= 3 ? s.slice(0, Math.max(0, n)) : `${s.slice(0, n - 3)}...`
}

/** The menu's top edge as Text, when Clawd is hidden: the title, and ` · note`, cut to fit. */
function edgeLine(title: string, note: string, columns: number): [string, string] {
  const room = Math.max(0, columns - 6)
  const head = cut(clean(title), room)
  return [head, cut(note ? clean(` · ${note}`) : '', room - head.length)]
}

// What follows each command in /clawd help.
const ARGS: Readonly<Record<string, string>> = {
  help: ' [uml]',
  act: ` <act> [1-${MAX_REPEAT}]`,
  emote: ' <emote>',
  skin: ' [<skin>|auto|none]',
  list: ' acts|made|emotes|skins|minis',
  autopick: ' [now|on|off|haiku|sonnet|opus]',
  trace: ' [on|off]',
  debug: ' [on|off]',
}
// What follows each `/clawd act` command in /clawd help.
const ACT_ARGS: Readonly<Record<string, string>> = {
  create: ' <name> [what it does]',
  change: ' <made act> [change]',
  delete: ' <made act>',
  preview: ' <act>',
}
// What follows each `/clawd emote` command in /clawd help.
const EMOTE_ARGS: Readonly<Record<string, string>> = {
  create: ' <name> [image] [looks]',
  change: ' <emote> [image] [change]',
  delete: ' <emote>',
  preview: ' <emote>',
}
// What follows each `/clawd skin` command in /clawd help; auto and none take nothing.
const SKIN_ARGS: Readonly<Record<string, string>> = {
  create: ' <name> [image] [looks]',
  change: ' <skin> [image] [change]',
  delete: ' <skin>',
  preview: ' <skin>',
}
// The first line of /clawd list <kind>.
const KIND_INTRO: Record<ListKind, string> = {
  acts: `Acts: moves Clawd or a mini plays once. /clawd act <act> [1-${MAX_REPEAT}], or /clawd <mini> <act>; /clawd act preview <act> draws one.`,
  made: 'Made acts: acts a model wrote, asked for by the autopicker or /clawd act create. They play like acts; /clawd act change and delete alter and remove them.',
  emotes:
    'Emotes: looks Clawd takes for a while; it turns into a thing or holds one. /clawd emote <emote> plays one; /clawd emote create, change and delete make, alter and remove them.',
  skins:
    "Skins: bodies Clawd wears all the time instead of its own; emotes and acts play on them. clawd.json or the project folder picks one, the autopicker or /clawd skin <skin> another for this session; /clawd skin create, change and delete make, alter and remove them.",
  minis: 'Minis: small Clawds, one per running subagent; each leaves when its subagent ends. /clawd <mini> <act>.',
}

async function clawdHelp($: EngineInterface): Promise<string> {
  const names = await loadNames($)
  const usage: [string, string][] = [
    ['/clawd', 'what Clawd is doing, and the last autopick'],
    ...Object.entries(COMMANDS).flatMap(([name, what]): [string, string][] => {
      const row: [string, string] = [`/clawd ${name}${ARGS[name] ?? ''}`, what]
      if (name === 'skin') {
        return [
          [`/clawd skin <skin>`, 'Clawd wears this skin for the rest of the session'],
          ...Object.entries(SKIN_COMMANDS)
            .filter(([verb]) => !(verb === 'none' && names.isSkinOnly))
            .map(([verb, does]): [string, string] => [`/clawd skin ${verb}${SKIN_ARGS[verb] ?? ''}`, does]),
        ]
      }
      if (name === 'act') {
        return [
          [`/clawd act <act> [1-${MAX_REPEAT}]`, 'Clawd plays an act, up to 5 times in a row'],
          ...Object.entries(ACT_COMMANDS).map(([verb, does]): [string, string] => [`/clawd act ${verb}${ACT_ARGS[verb] ?? ''}`, does]),
          [`/clawd <mini> <act> [1-${MAX_REPEAT}]`, 'a mini plays an act, e.g. /clawd a1 wave'],
        ]
      }
      if (name !== 'emote') return [row]
      return [
        [`/clawd emote <emote>`, "Clawd takes an emote's look for a while"],
        ...Object.entries(EMOTE_COMMANDS).map(([verb, does]): [string, string] => [`/clawd emote ${verb}${EMOTE_ARGS[verb] ?? ''}`, does]),
      ]
    }),
  ]
  const width = Math.max(...usage.map(([cmd]) => cmd.length))
  const n = (rows: Readonly<Record<string, string>>) => Object.keys(rows).length
  return [
    'Clawd is the Claude Code logo, running in the band above the prompt. It hops when you send a prompt,',
    'holds up a scroll while tools only read, stacks a brick for each other tool call and kicks the pile',
    'over at the next prompt. Between events it plays random acts. With /clawd autopick on, a model, the',
    `autopicker, chooses instead, every ${PICK_MIN_S} to ${PICK_MAX_S} s, and that uses your Claude usage.`,
    `The autopicker is ${await autopickModel($)}; /clawd autopick haiku, sonnet or opus switches it (haiku by default).`,
    '',
    'What can play:',
    '  act    a move Clawd or a mini plays once: jump, wave, chase, ... Made acts are acts a model',
    '         wrote; they play the same way. /clawd act create, change and delete make, alter and',
    '         remove made acts.',
    '  emote  a look Clawd itself takes for a while: it turns into a thing, such as a snowman, or holds',
    '         one, such as a pointer, and keeps moving. Clawd only. /clawd emote create, change and',
    '         delete make, alter and remove them.',
    '  mini   a small Clawd that comes for each running subagent and leaves when it ends. You cannot',
    '         make one; while it is there, /clawd <its id> <act> tells it what to play (a1, a2, ...).',
    "What Clawd is: a skin is a body Clawd wears all the time instead of its own, such as the MatSci",
    "octopus in a MatSci folder. Acts and emotes play on it. The mod's clawd.json or the project folder",
    'picks it; the autopicker or /clawd skin <skin> wears another for this session, /clawd skin auto',
    'goes back. Your own /clawd skin choice wins over the autopicker\'s.',
    'Acts, emotes and skins all take create, change, delete and preview, and the autopicker may ask for',
    `new ones of each, ${NEW_PER_DAY} a day in all.`,
    'While Remote Control is on, Clawd wears a gray antenna with a green tip, on any look, and the autopicker pauses.',
    `Now there are ${n(names.acts)} acts, ${n(names.made)} made acts, ${n(names.emotes)} emotes, ${n(names.skins)} skins and ${n(names.minis)} minis; /clawd list <kind> names them.`,
    '',
    ...usage.map(([cmd, what]) => `${cmd.padEnd(width)}  ${what}`),
    '',
    'Short forms: /clawd jump works without act, an emote name without emote, and a name may be cut short',
    'while only one fits (/clawd cel plays celebrate). While you type, a framed list above the prompt',
    'shows the names the word fits, and a space writes out a word that fits one name.',
    '',
    '/clawd help uml draws how Clawd behaves and how a new act, emote or skin is made and found, as UML.',
    `The session's model can run any /clawd command through the tool ${CLAWD_TOOL}, which it loads when it needs it;`,
    `a create or change it starts waits for the ${NEW_PER_DAY} a day.`,
  ].join('\n')
}

/** `/clawd help uml`: the diagrams, with a warning when the terminal is narrower than they are. */
async function clawdHelpUml($: EngineInterface, columns: number): Promise<string> {
  const lines = clawdUml({
    sleepAfterS: SLEEP_AFTER_S,
    readHoldS: READ_HOLD_S,
    miniStaleS: MINI_STALE_S,
    maxMinis: MAX_MINIS,
    pickMinS: PICK_MIN_S,
    pickMaxS: PICK_MAX_S,
    maxDelayS: MAX_DELAY_S,
    newPerDay: NEW_PER_DAY,
    maxSteps: MAX_STEPS,
    emoteDrafts: EMOTE_DRAFTS,
    emoteRounds: EMOTE_ROUNDS,
    pickModel: await autopickModel($),
    makeModel: MAKE_MODEL,
  })
  const narrow = columns < UML_WIDTH ? [`The diagrams are ${UML_WIDTH} columns wide and the terminal has ${columns}, so lines wrap.`, ''] : []
  return [...narrow, ...lines].join('\n')
}

// The colours of /clawd help uml, by what umlKinds says a run is.
const UML_STYLE: Record<UmlKind, { color?: string; bold?: boolean }> = {
  text: {},
  heading: { bold: true },
  state: { color: '#d77757' }, // Clawd's orange, ORANGE in clawd-sim.ts
  name: { bold: true },
  note: { color: FLOOR_TEXT },
  flow: { color: '#5fa8d3' },
  end: { color: 'success', bold: true },
  guard: { color: '#e0b84a' },
  footnote: { color: '#b48ead' },
}

async function clawdListOf($: EngineInterface, of: ListKind): Promise<string> {
  const rows = Object.entries((await loadNames($))[of])
  let intro = KIND_INTRO[of]
  if (of === 'made' || of === 'emotes' || of === 'skins') {
    const now = await $.clock.now()
    const dated = [...(await loadMade($)), ...(await loadEmotes($)), ...(await loadSkins($))]
    const madeToday = dated.filter(r => r.made && now - Date.parse(r.made) < DAY_MS).length
    intro += ` Made in the last 24 h: ${madeToday} acts, emotes and skins; the autopicker may ask for ${NEW_PER_DAY} a day.`
  }
  const width = Math.max(0, ...rows.map(([name]) => name.length))
  return [intro, ...(rows.length > 0 ? rows.map(([name, what]) => `  ${name.padEnd(width)}  ${what}`) : ['  none now'])].join('\n')
}

/** Which skin Clawd wears and why, for /clawd and /clawd skin. */
async function skinLine($: EngineInterface): Promise<string> {
  const { name, from } = await skinNow($)
  const why = from ? `; ${from}` : ''
  if (!name) return `Skin: none, Clawd's own body${why}.`
  if (!mod.skin) return `Skin: ${name} is asked for${why}, but there is no such skin, so Clawd has its own body.`
  return `Skin: ${name} ("${mod.skin.title}")${why}.`
}

async function clawdStatus($: EngineInterface): Promise<string> {
  const w = clawd.world
  const now = await $.clock.now()
  const where = w ? `${w.act?.routine ?? w.act?.kind ?? 'between acts'}, ${w.mode} mode, pile of ${w.pile}` : 'not on screen'
  const last = brain.last
  const next = brain.isPicking
    ? 'The autopicker is choosing now.'
    : !(await isAutopicking($))
      ? 'The autopicker is off, so Clawd plays random acts; /clawd autopick on lets a model choose (uses your Claude usage).'
      : mod.isRemote
        ? 'The autopicker is paused while Remote Control is on, so Clawd plays random acts; it picks again when Remote Control ends.'
        : brain.dueAt > 0
          ? `Next autopick in ${ago(brain.dueAt - now)}.`
          : 'Next autopick at the next prompt or turn end.'
  const minis = (w?.minis ?? []).map(
    m =>
      `${m.id} "${oneLine(m.title, 40)}" (${m.kind}, ${ago((w ? w.t - m.since : 0) * 1000)}, ${m.tools} tools, ` +
      `${m.isLeaving ? 'leaving' : (m.act?.routine ?? m.act?.kind ?? 'between acts')})`,
  )
  return [
    `Clawd ${(await read($, isClawdOn)) ? 'on' : 'off'}: ${where}.${mod.isRemote ? ' Remote Control is on, so it wears an antenna.' : ''}`,
    `Minis: ${minis.join('; ') || 'none (one comes per running subagent)'}; ${w?.minisMade ?? 0} this session.`,
    last
      ? `Last autopick (${last.trigger}, ${ago(now - last.at)} ago): ${last.calls.map(callText).join(', ') || '-'}` +
        `${last.why ? `; ${last.why}` : ''}.` +
        (last.made ? ` New act "${last.made.title}".` : '')
      : 'No autopick yet.',
    `${next} Picker model: ${await autopickModel($)}. Session summary: ${brain.summary || '(none yet)'}`,
    await skinLine($),
    ...(brain.making ? [`Making ${brain.making} now.`] : []),
    ...(brain.makeError ? [`The last act, emote or skin a model made failed: ${brain.makeError}`] : []),
    '/clawd help explains acts, emotes, skins and minis and lists the commands.',
  ].join('\n')
}

/** The names a new act, emote or skin may not take: they share one set of names with each other and with the /clawd words. */
async function takenNames($: EngineInterface): Promise<string[]> {
  return [
    ...ACTS,
    ...Object.keys(PICKABLE),
    ...RESERVED,
    ...(await loadMade($)).map(r => r.name),
    ...(await loadEmotes($)).map(x => x.name),
    ...(await loadSkins($)).map(x => x.name),
  ]
}

/**
 * A typed name as a file name: capitals and hyphens become snake_case
 * (ClaudeWithGlasses and claude-with-glasses give claude_with_glasses); ''
 * when no name of 2 to 31 characters starting with a letter is left.
 */
function snakeName(word: string): string {
  const name = word
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 31)
    .replace(/^_+|_+$/g, '')
  return /^[a-z][a-z0-9_]{1,30}$/.test(name) ? name : ''
}

const NAME_SYSTEM =
  'You name a new act, emote or skin for Clawd, the Claude Code logo drawn as a small creature above the prompt of a Claude Code session. Reply with one JSON object and nothing else.'
const MADE_WHAT: Record<MadeKind, string> = {
  act: 'An act is a move Clawd plays',
  emote: 'An emote is a look Clawd takes for a while',
  skin: 'A skin is a body Clawd wears for the rest of the session',
}

/** Words after create that read as a sentence: three or more, none with an underscore. */
const isSentence = (words: readonly string[]): boolean => words.length >= 3 && words.every(w => !w.includes('_'))

/**
 * Haiku names what a sentence after create asks for, and keeps the words that
 * describe it as the title. Undefined when it gives no usable name; the first word is the name then.
 */
async function nameFor($: EngineInterface, kind: MadeKind, words: readonly string[], taken: readonly string[]): Promise<{ name: string; title: string } | undefined> {
  const said = words.join(' ')
  const prompt = [
    `The person typed /clawd ${kind} create, then these words: ${said}`,
    `${MADE_WHAT[kind]}. Return {"name": "...", "title": "..."}.`,
    '- name: lower case, words joined by _, 2 to 30 characters, saying what it is (claude_with_glasses).',
    '  When the first word names it and the rest describes it ("frog a green frog with big eyes"), the',
    '  name is that word.',
    '- title: those words as they are, without the first one when it is the name, under 80 characters.',
    `Names already taken, which the new one may not have: ${taken.join(', ')}.`,
  ].join('\n')
  try {
    const answer = await $.model.complete({ model: NAME_MODEL, system: NAME_SYSTEM, prompt, maxTokens: 200, timeoutMs: 30_000 })
    if (!answer.isAnswered) return undefined
    const r = parseJson(answer.text)
    const name = typeof r?.name === 'string' ? snakeName(r.name) : ''
    if (!name) return undefined
    return { name, title: (typeof r?.title === 'string' ? oneLine(r.title, 80) : '') || oneLine(said, 80) }
  } catch {
    return undefined
  }
}

/** What /clawd <kind> change asks for: the words, without one pair of quotes around them all, which are the user's. */
function changeText(words: readonly string[], n: number): string {
  const said = oneLine(words.join(' '), n)
  return /^(["']).*\1$/.test(said) && said.length > 1 ? said.slice(1, -1).trim() : said
}

/**
 * `/clawd emote|skin preview|create|change|delete ...`; undefined for any
 * other verb. `begin` starts a drawing. orderOf has checked that change and
 * delete name a look in full. A change with no words and no image draws the
 * look again from scratch.
 */
async function lookCommand<T extends { name: string; title: string }>(
  $: EngineInterface,
  kit: Kit<T>,
  verb: string,
  rest: readonly string[],
  names: Names,
  begin: (name: string, title: string, why: string, image: string, start?: Change<T>, replace?: T & Dated) => void,
): Promise<string | undefined> {
  const kind = kit.kind
  const looks = await loadLooks($, kit)
  const [arg] = rest
  const whenDone = kind === 'emote' ? 'it plays when done' : 'Clawd wears it when done'
  if (verb === 'preview') {
    const fits = arg === undefined ? [] : namesFit(arg, [kind], names)
    const look = fits.length === 1 ? looks.find(x => x.name === fits[0]?.name) : undefined
    if (!look) return `Clawd: no ${kind} ${arg ?? ''}. ${kind === 'emote' ? 'Emotes' : 'Skins'}: ${looks.map(x => x.name).join(', ') || 'none'}.`
    const path = await previewLook($, kit, look)
    const poses = 'prop' in look && look.prop ? [...PREVIEW_POSES, ...PREVIEW_PROP_POSES] : PREVIEW_POSES
    const twice = 'body' in look && !look.body && mod.skin && !mod.fileSkin ? ` They show it on the skin ${mod.skin.name}, then on Clawd's own body.` : ''
    return `Clawd: ${look.name} in ${poses.length} poses, ${PREVIEW_PER_LINE} per line, is in ${path}. The poses: ${poses.join(', ')}.${twice}`
  }
  if (verb === 'create') {
    // `/clawd emote create <name> [image path] [what it looks like]`, and the same
    // for a skin. The name alone is enough: the model draws
    // from it in words. An image path in its place gives the name from its file,
    // and a sentence gets its name from Haiku (nameFor).
    const usage = `Usage: /clawd ${kind} create <name> [image path] [what it looks like], e.g. /clawd ${kind} create frog_with_big_eyes or /clawd ${kind} create frog a green frog with big eyes`
    const [typed = '', ...after] = rest
    if (!typed) return usage
    if (brain.making) return `Clawd: ${brain.making} is still being made; one at a time.`
    const isImageFirst = IMAGE.test(typed)
    const more = isImageFirst ? [typed, ...after] : after
    const at = more.findIndex(word => IMAGE.test(word))
    const image = at >= 0 ? await imagePath($, more[at] ?? '') : ''
    if (at >= 0 && !image) return `Clawd: ${more[at]} is no image file.`
    const said = more.filter((_, i) => i !== at)
    const words = isImageFirst ? said : [typed, ...said]
    const taken = await takenNames($)
    const named = isSentence(words) ? await nameFor($, kind, words, taken) : undefined
    const first = snakeName(isImageFirst ? (typed.split('/').pop() ?? '').replace(IMAGE, '') : typed)
    const name = named?.name ?? first
    const title = named?.title ?? (oneLine(said.join(' '), 80) || name.replace(/_/g, ' '))
    if (!name) return usage
    if (taken.includes(name)) return `Clawd: ${name} is taken; pick another name.`
    begin(name, title, `asked for with /clawd ${kind} create`, image)
    const by = named && named.name !== first ? ` (named by ${NAME_MODEL})` : ''
    return `Clawd: a model draws ${name}${by}${image ? ` after ${image}` : ''}, in a few minutes; ${whenDone}.`
  }
  const look = looks.find(x => x.name === arg)
  if ((verb === 'change' || verb === 'delete') && !look) return `Clawd: ${arg ?? ''} is gone.`
  if (look && brain.making === look.name) return `Clawd: ${look.name} is being made right now; wait until it is done.`
  if (verb === 'delete' && look) {
    const to = await oldPath($, kind, look.name)
    await $.process.run(['mkdir', '-p', `${mod.dataDir}/${kind}s/old`], { timeoutMs: 5000 })
    const r = await $.process.run(['mv', '--', look.file, to], { timeoutMs: 5000 })
    if (r.exitCode !== 0) return `Clawd: ${look.name} could not be moved: ${oneLine(r.stderr, 200)}`
    const own = kind === 'emote' ? mod.emoteDir : mod.skinDir
    const tracked = look.file.startsWith(`${own}/`) ? ` It shipped with the mod in ${kind}s/: in a git checkout, commit the removal or git checkout it back.` : ''
    if (kind === 'skin') {
      if ((await read($, clawdPickedSkin)) === look.name) await update($, clawdPickedSkin, () => null)
      await applySkin($, true)
    }
    return `Clawd: ${look.name} is deleted. Its file is now ${to}; move it back to undo.${tracked}`
  }
  if (verb === 'change' && look) {
    // `/clawd emote change <emote> [image path] [what to change]`; a paid model run like create.
    const more = rest.slice(1)
    const at = more.findIndex(word => IMAGE.test(word))
    const image = at >= 0 ? await imagePath($, more[at] ?? '') : ''
    if (at >= 0 && !image) return `Clawd: ${more[at]} is no image file.`
    const said = changeText(more.filter((_, i) => i !== at), 120)
    const text = said || (image ? 'make it look like the new reference image' : '')
    if (brain.making) return `Clawd: ${brain.making} is still being made; one at a time.`
    const why = look.why || `asked for with /clawd ${kind} change`
    const after = kind === 'emote' ? whenDone : 'Clawd wears it when done if it is the skin worn now'
    const old = `The old look goes to ${mod.dataDir}/${kind}s/old/ once the new one is saved.`
    if (!text) {
      // Nothing to change: the look is drawn again from scratch, from its title and reference
      // image, as create draws a new one.
      begin(look.name, look.title, why, look.image, undefined, look)
      return `Clawd: a model draws ${look.name} again from scratch after "${oneLine(look.title, 80)}", in a few minutes; ${after}. ${old}`
    }
    begin(look.name, look.title, why, image || look.image, { look, text })
    return `Clawd: a model changes ${look.name}: "${text}", in a few minutes; ${after}. ${old}`
  }
  return undefined
}

/**
 * `/clawd act preview|create|change|delete ...`, as lookCommand does for
 * emotes and skins. Opus
 * writes an act from words, so create and change take no image. orderOf has
 * checked that change and delete name a made act in full. A change with no
 * words writes the act again from scratch, from its title and why.
 */
async function actCommand($: EngineInterface, verb: string, rest: readonly string[], names: Names): Promise<string> {
  const made = await loadMade($)
  const [arg] = rest
  if (verb === 'preview') {
    const fits = arg === undefined ? [] : namesFit(arg, ['act', 'made'], names)
    const fit = fits.length === 1 ? fits[0] : undefined
    const what: Playable | undefined = fit?.kind === 'made' ? made.find(r => r.name === fit.name) : fit?.kind === 'act' ? (fit.name as ActKind) : undefined
    if (!fit || what === undefined) return `Clawd: no act ${arg ?? ''}. /clawd list acts and /clawd list made name them.`
    const { png, frames } = actPreview(what, mod.skin)
    const path = `${mod.dataDir}/acts/previews/${fit.name}.png`
    await writeBytes($, path, png)
    const skin = mod.skin ? ` Clawd wears the skin ${mod.skin.name}.` : ''
    return `Clawd: ${fit.name} in ${frames} frames, the band every ${ACT_PREVIEW_EVERY_S} s from top to bottom, is in ${path}.${skin}`
  }
  if (verb === 'create') {
    // `/clawd act create <name> [what it does]`; the name alone is enough, and a
    // sentence gets its name from Haiku, as for a look.
    const usage = 'Usage: /clawd act create <name> [what it does], e.g. /clawd act create cartwheel or /clawd act create cartwheel turns a cartwheel across the band'
    const [typed = '', ...more] = rest
    if (!typed) return usage
    if (brain.making) return `Clawd: ${brain.making} is still being made; one at a time.`
    const taken = await takenNames($)
    const named = isSentence(rest) ? await nameFor($, 'act', rest, taken) : undefined
    const first = snakeName(typed)
    const name = named?.name ?? first
    const does = named?.title ?? (oneLine(more.join(' '), 80) || name.replace(/_/g, ' '))
    if (!name) return usage
    if (taken.includes(name)) return `Clawd: ${name} is taken; pick another name.`
    startAct($, name, does, 'asked for with /clawd act create', 'clawd')
    const by = named && named.name !== first ? ` (named by ${NAME_MODEL})` : ''
    return `Clawd: ${MAKE_MODEL} writes ${name}${by}, in a minute or two; it plays when done.`
  }
  const act = made.find(r => r.name === arg)
  if (!act) return `Clawd: ${arg ?? ''} is gone.`
  if (brain.making === act.name) return `Clawd: ${act.name} is being made right now; wait until it is done.`
  if (verb === 'delete') {
    const to = await oldPath($, 'act', act.name)
    await $.process.run(['mkdir', '-p', `${mod.dataDir}/acts/old`], { timeoutMs: 5000 })
    const r = await $.process.run(['mv', '--', `${mod.dataDir}/acts/${act.name}.json`, to], { timeoutMs: 5000 })
    if (r.exitCode !== 0) return `Clawd: ${act.name} could not be moved: ${oneLine(r.stderr, 200)}`
    return `Clawd: ${act.name} is deleted. Its file is now ${to}; move it back to undo.`
  }
  if (verb === 'change') {
    // `/clawd act change <act> [what to change]`; a paid model run like create.
    const text = changeText(rest.slice(1), 120)
    if (brain.making) return `Clawd: ${brain.making} is still being made; one at a time.`
    const why = act.why || 'asked for with /clawd act change'
    const old = `The old act goes to ${mod.dataDir}/acts/old/ once the new one is saved.`
    if (!text) {
      startAct($, act.name, act.title, why, 'clawd', undefined, act)
      return `Clawd: ${MAKE_MODEL} writes ${act.name} again from scratch after "${oneLine(act.title, 80)}", in a minute or two; it plays when done. ${old}`
    }
    startAct($, act.name, act.title, why, 'clawd', { act, text })
    return `Clawd: ${MAKE_MODEL} changes ${act.name}: "${text}", in a minute or two; it plays when done. ${old}`
  }
  return 'Clawd: /clawd act takes an act, or create, change, delete or preview.'
}

/**
 * `/clawd skin` says which skin Clawd wears and why; `/clawd skin <skin>`
 * wears that one for the rest of the session, `none` Clawd's own body, and
 * `auto` what clawd.json or the project folder gives. A mod whose clawd.json
 * names a skin has no `none` (`Names.isSkinOnly`). The skin commands work as the
 * emote commands do.
 */
async function skinCommand($: EngineInterface, rest: readonly string[], names: Names): Promise<string> {
  const [first] = rest
  const how = mod.fileSkin
    ? '/clawd skin <skin> wears another for this session, auto the one clawd.json names; /clawd list skins names them.'
    : "/clawd skin <skin> wears another for this session, none Clawd's own body, auto what clawd.json or the project folder gives; /clawd list skins names them."
  if (first === undefined) return `${await skinLine($)} ${how}`
  if (first === 'auto' || first === 'none' || Object.hasOwn(names.skins, first)) {
    await update($, clawdSkin, () => (first === 'auto' ? null : first === 'none' ? '' : first))
    // auto also drops the skin the autopicker chose; a choice of yours outranks it anyway.
    if (first === 'auto') await update($, clawdPickedSkin, () => null)
    await applySkin($, true)
    return `Clawd: ${await skinLine($)}${first === 'auto' ? '' : ' /clawd skin auto goes back.'}`
  }
  const begin = (name: string, title: string, why: string, image: string, start?: Change<Skin>, replace?: MadeSkin) =>
    startSkin($, name, title, why, image, start, replace)
  return (await lookCommand($, SKIN_KIT, first, rest.slice(1), names, begin)) ?? `${await skinLine($)} ${how}`
}

/** Registers the clawd tool; a failure goes to the debug log and leaves the band running. */
async function registerTool($: EngineInterface): Promise<void> {
  try {
    await $.tool.register({
      name: 'clawd',
      description: TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string', description: 'The words after /clawd, such as "act wave 2"; "" for what Clawd is doing.' } },
        required: ['command'],
      },
    })
  } catch (err) {
    $.ui.log(`clawd: the clawd tool was not registered: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
  }
}

/** Acts, emotes and skins a model made in the last 24 hours, counted from the files, so over all sessions and hosts. */
async function madeLastDay($: EngineInterface): Promise<number> {
  const now = await $.clock.now()
  const dated = [...(await loadMade($)), ...(await loadEmotes($)), ...(await loadSkins($))]
  return dated.filter(r => r.made && now - Date.parse(r.made) < DAY_MS).length
}

/**
 * The words after `/clawd`, run, and the answer: from the command the person
 * types, or from the clawd tool (`isModel`). `columns` is the width
 * `/clawd help uml` is drawn for.
 */
async function clawdRun($: EngineInterface, args: string, columns: number, isModel: boolean): Promise<string> {
  const words = args.trim().split(/\s+/).filter(Boolean)
  // A word may be cut short while it fits one name (clawd-words.ts).
  const names = await loadNames($)
  const order = orderOf(words, names)
  if (order.kind === 'status') return clawdStatus($)
  if (order.kind === 'unclear') return order.text
  if (order.kind === 'list') return clawdListOf($, order.of)
  const w = clawd.world
  if (order.kind === 'play') {
    if (!w) return 'Clawd is not on screen.'
    const { who, fit, count: n } = order
    const what = fit.kind === 'emote' ? (await loadEmotes($)).find(x => x.name === fit.name) : fit.kind === 'made' ? (await loadMade($)).find(r => r.name === fit.name) : undefined
    if (fit.kind !== 'act' && !what) return `Clawd: ${fit.name} is gone.`
    if (who !== 'clawd' && !bodyOf(w, who)) return `Clawd: ${who} has left.`
    // All repeats are queued at once, so one does not cut the next short.
    perform(w, what ?? (fit.name as ActKind), n, who)
    const name = who === 'clawd' ? 'Clawd' : who
    return n > 1 ? `${name}: ${fit.name} ×${n}.` : `${name}: ${fit.name}.`
  }
  const verb = order.name
  const [arg] = order.rest
  // A create or change the person types starts at once; one a model asks for
  // waits for the daily limit, as the autopicker's asks do.
  if (isModel && (verb === 'act' || verb === 'emote' || verb === 'skin') && (arg === 'create' || arg === 'change')) {
    const made = await madeLastDay($)
    if (made >= NEW_PER_DAY) {
      return `Clawd: ${made} acts, emotes and skins were made in the last 24 hours, and a model may start a create or change only below ${NEW_PER_DAY}. The person can still type /clawd ${verb} ${arg}.`
    }
  }
  if (verb === 'help') {
    if (arg === undefined) return clawdHelp($)
    return 'uml'.startsWith(arg) ? clawdHelpUml($, columns) : 'Clawd: /clawd help takes uml or nothing.'
  }
  if (verb === 'on' || verb === 'off') {
    await update($, isClawdOn, () => verb === 'on')
    await $.store.set('isClawdOn', verb === 'on')
    return `Clawd ${verb}.`
  }
  // Bare trace, debug and autopick switch their state; on and off still set it.
  if (verb === 'trace') {
    const turn = arg === undefined ? undefined : ['on', 'off'].find(t => t === arg || (arg.length > 1 && t.startsWith(arg)))
    if (arg !== undefined && !turn) return 'Clawd: /clawd trace takes on, off or nothing.'
    const isOn = turn ? turn === 'on' : !(await read($, isTracing))
    await update($, isTracing, () => isOn)
    return isOn
      ? `Clawd: each autopick now goes to ${mod.dataDir}/picks/${await $.session.id()}.jsonl (the last ${TRACE_MAX}). /clawd trace stops it.`
      : 'Clawd: autopicks are no longer traced.'
  }
  if (verb === 'debug') {
    const turn = arg === undefined ? undefined : ['on', 'off'].find(t => t === arg || (arg.length > 1 && t.startsWith(arg)))
    if (arg !== undefined && !turn) return 'Clawd: /clawd debug takes on, off or nothing.'
    const isOn = turn ? turn === 'on' : !(await read($, isDebugging))
    await update($, isDebugging, () => isOn)
    // Switched on, the next pick shows its whole request again.
    if (isOn) brain.shown.clear()
    // Debug looked broken while autopick was off and no pick ran.
    const offHint = !(await isAutopicking($))
      ? ' Autopick is off, so only /clawd autopick now picks; /clawd autopick lets it run by itself.'
      : mod.isRemote
        ? ' Autopick is paused while Remote Control is on, so only /clawd autopick now picks.'
        : ''
    return isOn
      ? `Clawd: debug on. Each autopick's tokens, the request it sent, its whole reply and what came of it now show here, dim and not sent to the model. A part of the request that is as last shown is left out and named. The model's thinking is not available to a mod.${offHint} /clawd debug turns it off.`
      : 'Clawd: debug off.'
  }
  if (verb === 'autopick') {
    const turn = arg === undefined ? undefined : ['now', 'on', 'off', ...PICK_MODELS].find(t => t === arg || (arg.length > 1 && t.startsWith(arg)))
    if (arg !== undefined && !turn) return 'Clawd: /clawd autopick takes now, on, off, haiku, sonnet, opus or nothing.'
    if (turn === 'now') {
      $.clock.after(1, () => void pickNext($, ASKED))
      return 'Clawd: the autopicker chooses now; /clawd shows its pick.'
    }
    // A model word sets the picker model and leaves the switch as it is.
    const model = PICK_MODELS.find(m => m === turn)
    if (model) {
      await $.store.set('pickModel', model)
      const state = !(await isAutopicking($))
        ? ' The autopicker is off; /clawd autopick turns it on.'
        : mod.isRemote
          ? ' It is paused while Remote Control is on.'
          : ''
      const cost = model === DEFAULT_PICK_MODEL ? '' : ` Each pick costs more of your Claude usage than with ${DEFAULT_PICK_MODEL}.`
      return `Clawd: the autopicker uses ${model} (remembered).${cost}${state}`
    }
    const isOn = turn ? turn === 'on' : !(await isAutopicking($))
    await $.store.set('isAutopickOn', isOn)
    if (isOn) {
      if (!mod.isRemote) schedulePick($, await $.clock.now())
      return (
        `Clawd: the autopicker is on (remembered). ${await autopickModel($)} picks what plays after each prompt and turn and every ` +
        `${PICK_MIN_S} to ${PICK_MAX_S} s, about 100 calls an hour in a busy session, and may have ${MAKE_MODEL} make ` +
        `up to ${NEW_PER_DAY} new acts or emotes a day. It all counts against your Claude usage. /clawd autopick turns it off; ` +
        '/clawd autopick haiku, sonnet or opus switches the model.' +
        (mod.isRemote ? ' It is paused while Remote Control is on and starts when Remote Control ends.' : '')
      )
    }
    brain.timer?.cancel()
    brain.timer = null
    brain.dueAt = 0
    return 'Clawd: the autopicker is off (remembered). Clawd plays random acts and makes no model calls. /clawd autopick turns it on.'
  }
  if (verb === 'skin') return skinCommand($, order.rest, names)
  if (verb === 'act') return actCommand($, arg ?? '', order.rest.slice(1), names)
  if (verb !== 'emote') return clawdStatus($)
  const begin = (name: string, title: string, why: string, image: string, start?: Change<Emote>, replace?: MadeEmote) =>
    startEmote($, name, title, why, image, 'clawd', start, '', replace)
  return (await lookCommand($, EMOTE_KIT, arg ?? '', order.rest.slice(1), names, begin)) ?? (await clawdStatus($))
}

/** Whether a /clawd command changes something: all but the status, lists, help, plays, the skin shown and previews. */
function changes(order: Order): boolean {
  if (order.kind !== 'command' || order.name === 'help') return false
  const [arg] = order.rest
  return !((order.name === 'act' || order.name === 'emote' || order.name === 'skin') && (arg === undefined || arg === 'preview'))
}

/**
 * Why the clawd tool refuses a command a model runs, or '' to run it. The
 * tool's own answer comes before the engine's permission check (found
 * 2026-10-26), so a command that changes something asks that check here.
 * On an ask the person decides.
 */
async function gateTool($: EngineInterface, args: string): Promise<string> {
  if (!changes(orderOf(args.split(/\s+/).filter(Boolean), await loadNames($)))) return ''
  const command = `/clawd ${args}`.trim()
  try {
    const check = await $.tool.check({ tool: CLAWD_TOOL, input: { command } })
    if (check.decision === 'allow') return ''
    if (check.decision === 'deny') return `Clawd: ${command} is not allowed here${check.reason ? `: ${check.reason}` : '.'}`
    const answer = await $.ui.ask(`A model wants to run ${command}. Allow it?`, { options: ['Allow', 'Refuse'], header: 'clawd' })
    return answer === 'Allow' ? '' : `Clawd: the person refused ${command}.`
  } catch (err) {
    return `Clawd: ${command} was not run, as its permission check failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    mod.isOff = (await $.env.get('CLAUDE_CLAWD_OFF')) === '1' || !e.isInteractive
    // The tool is registered before next(e), as the engine's own example does.
    if (!mod.isOff) await registerTool($)
    if (!mod.isOff) await registerMaker($)
    const started = await next(e)
    if (mod.isOff) return started
    const seed = Number(await $.env.get('CLAUDE_CLAWD_SEED'))
    if (Number.isInteger(seed)) mod.rand = seeded(seed)
    const isOn = (await $.store.get('isClawdOn')) !== false
    if (!isOn) await update($, isClawdOn, () => false)
    $.ui.log(
      isOn
        ? `Clawd is on · /clawd help explains it · /clawd off hides it (remembered) · remove the mod: claude plugin disable ${$.plugin.name}`
        : `Clawd is off · /clawd on brings it back`,
    )
    await $.command.register({
      name: 'clawd',
      description: 'Clawd above the prompt: help, act, emote, skin, list, on, off, autopick; short names work',
    })
    $.clock.every(TICK_MS, () => clawdTick($))
    await pollRemote($)
    $.clock.every(REMOTE_POLL_MS, () => void pollRemote($))
    const root = $.plugin.root
    mod.emoteDir = `${root}/emotes`
    mod.skinDir = `${root}/skins`
    mod.dataDir = await dataDirOf($, root)
    mod.fileSkin = await fileSkinOf($, root)
    try {
      mod.root = await $.session.root() // a reload's e.cwd follows the shell's cd
    } catch {
      mod.root = e.cwd
    }
    await applySkin($, false) // finds the skin before Clawd is drawn
    $.clock.every(ROOT_POLL_MS, () => void pollRoot($))
    mod.project = e.cwd.split('/').filter(Boolean).pop() ?? e.cwd
    mod.startedAt = await $.clock.now()
    if (await isPickingAlone($)) schedulePick($, mod.startedAt)
    return started
  })

  on('prompt.submit', async ($, e, next) => {
    if (mod.names) {
      mod.names = undefined
      await setMenu($, undefined)
    }
    if (!mod.isOff && e.origin.kind !== 'plugin' && clawd.world) onPrompt(clawd.world)
    if (!mod.isOff && e.origin.kind !== 'plugin' && !e.text.trimStart().startsWith('/clawd')) {
      feed(`user: ${oneLine(e.text, 400)}`)
      // On a timer, so the prompt never waits for the picker.
      $.clock.after(1, () => void pickNext($, 'prompt sent'))
    }
    return next(e)
  })

  // Typing `/clawd ...`: the band shows a framed list of what the word at the
  // cursor fits, the words turn green (one name) or red (none), and a space
  // after a word that fits one name writes it out (Tab never reaches a hook).
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    if (mod.isOff || !isClawdDraft(box.text)) {
      if (mod.names) {
        mod.names = undefined
        await setMenu($, undefined)
      }
      return box
    }
    mod.names ??= await loadNames($) // fresh once per /clawd draft
    const typed = e.inputText === ' ' ? writeOut(box.text, box.cursor, mod.names) : undefined
    const text = typed?.text ?? box.text
    const cursor = typed?.cursor ?? box.cursor
    await setMenu($, menuFor(text, cursor, mod.names))
    const marks = marksFor(text, mod.names).map(m => ({ start: m.start, end: m.end, color: m.isFit ? 'success' : 'error' }))
    return { ...box, text, cursor, decorations: [...(typed ? [] : (box.decorations ?? [])), ...marks] }
  })

  // The maker is the mod's own: never offered to a model.
  on('agent.offer', async ($, e, next) => (maker.type && e.agent === maker.type ? { isOffered: false } : next(e))).catch(($, e, next) =>
    e.agent === `${$.plugin.name}:maker` ? { isOffered: false } : next(e),
  )

  // The maker's calls, and the Agent check of the mod's own maker spawn. Every
  // other call passes at once. A failure refuses a maker's call.
  on('tool.check', async ($, e, next) => {
    const job = e.agentId === undefined ? undefined : maker.jobs.get(e.agentId)
    if (job) return makerVerdict(job, e.tool, e.input as Record<string, unknown>, await $.clock.now())
    if (e.tool === RENDER_TOOL) return { decision: 'deny', reason: `clawd: ${RENDER_TOOL} is for the mod's maker only.` }
    // The mod may start its own maker in plan and auto mode, where the
    // classifier gives no verdict for a spawn no model asked for.
    if (e.tool === 'Agent' && maker.type && next.origin.plugin === $.plugin.name && (e.input as { subagent_type?: unknown }).subagent_type === maker.type) {
      return { decision: 'allow' }
    }
    if (e.agentId !== undefined && maker.type && (await isStrayMaker($, e.agentId))) {
      return { decision: 'deny', reason: 'clawd: this maker was started before the mod reloaded; answer now with one line.' }
    }
    return next(e)
  }).catch(($, e, next) =>
    (e.agentId !== undefined && maker.jobs.has(e.agentId)) || e.tool === RENDER_TOOL
      ? { decision: 'deny', reason: 'clawd: the check of a maker call failed.' }
      : next(e),
  )

  // A subagent started: a mini Clawd for it, while it runs. The maker runs only
  // under the parent modes it was tested under.
  on('agent.spawn', async ($, e, next) => {
    if (maker.type && e.subagentType === maker.type && e.permissionMode !== undefined && !MAKER_MODES.includes(e.permissionMode)) {
      return { deny: `clawd: the maker does not run in ${e.permissionMode} mode` }
    }
    const started = await next(e)
    const w = clawd.world
    if (mod.isOff || !w || started.agentId === undefined) return started
    const mini = spawnMini(w, started.agentId, e.description, e.subagentType)
    feed(
      `subagent ${mini?.id ?? '(no mini, too many)'} started: "${oneLine(e.description, 80)}" (${e.subagentType})` +
        `${e.background ? ', in the background' : ''}`,
    )
    if (mini) $.clock.after(1, () => void pickNext($, `subagent ${mini.id} started`))
    return started
  })

  on('tool.call', async ($, e, next) => {
    // A clawd tool call is no work to show: its brick would cut short the act it asked for.
    if ((e.tool as string) === CLAWD_TOOL) return next(e)
    const ran = await next(e)
    const isError = ran.deny !== undefined || ran.isError === true
    // A Read, or a Bash call the engine judged read-only (rg, ls, cat), makes it read.
    const isReading = !isError && (e.tool === 'Read' || (e.tool === 'Bash' && ran.isReadOnly === true))
    if (!mod.isOff && clawd.world) onTool(clawd.world, isError, e.agentId, isReading)
    if (!mod.isOff) feed(toolLine(e as unknown as Record<string, unknown>, isError))
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // A maker's answer ends its make; the save runs in the chain that waits for it.
    const job = e.agentId === undefined ? undefined : maker.jobs.get(e.agentId)
    if (job) job.ended(e.answer, e.reason)
    if (mod.isOff) return result
    if (e.agentId !== undefined) {
      // A subagent's answer: its mini says goodbye and runs off.
      const id = miniName(e.agentId)
      const mini = clawd.world ? endMini(clawd.world, e.agentId, e.reason) : undefined
      if (mini) {
        feed(`subagent ${id} finished (${e.reason}, ${Math.round(e.durationMs / 1000)} s): ${oneLine(e.answer, 200, true)}`)
        $.clock.after(1, () => void pickNext($, `subagent ${id} finished`))
      }
      return result
    }
    if (clawd.world) onTurnEnd(clawd.world, e.reason)
    feed(`assistant, turn ended (${e.reason}, ${Math.round(e.durationMs / 1000)} s): ${oneLine(e.answer, 500, true)}`)
    $.clock.after(1, () => void pickNext($, `turn ended (${e.reason})`))
    return result
  })

  on('command.run', { command: 'clawd' }, async ($, e) => {
    if (mod.names) {
      mod.names = undefined
      await setMenu($, undefined)
    }
    return { text: await clawdRun($, e.args, e.presentation.columns, false) }
  })

  // The clawd tool: the session's model, or a subagent, runs a /clawd command. A
  // RegExp, because the engine's tool-name type lists only the tools it had
  // when the mod last loaded.
  on('tool.call', { tool: new RegExp(`^${CLAWD_TOOL}$`) }, async ($, e) => {
    const { command } = e as unknown as { command?: unknown } // a tool's input fields sit on the event
    const args = typeof command === 'string' ? command.trim().replace(/^\/clawd(\s+|$)/, '') : ''
    const refused = await gateTool($, args)
    if (refused) return { result: refused, isError: true }
    return { result: await clawdRun($, args, UML_WIDTH, true) }
  })

  // The render tool: a maker's draft, checked and drawn. This answer comes
  // before the engine's permission check, so it checks the maker and its time itself.
  on('tool.call', { tool: new RegExp(`^${RENDER_TOOL}$`) }, async ($, e) => {
    const job = e.agentId === undefined ? undefined : maker.jobs.get(e.agentId)
    if (!job) return { result: `clawd: ${RENDER_TOOL} is for the mod's maker only.`, isError: true }
    const verdict = makerVerdict(job, RENDER_TOOL, {}, await $.clock.now())
    if (verdict.decision === 'deny') return { result: verdict.reason, isError: true }
    const { draft, drafts } = e as unknown as { draft?: unknown; drafts?: unknown } // a tool's input fields sit on the event
    try {
      return { result: await job.render(draft, drafts) }
    } catch (err) {
      return { result: `clawd: the render failed: ${err instanceof Error ? err.message : String(err)}`, isError: true }
    }
  })

  // /clawd help uml in colour. The stored row keeps the plain text the model reads.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (mod.isOff || e.surface !== 'terminal' || e.props.command !== 'clawd' || !e.props.text.includes(UML_LEGEND)) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {umlKinds(e.props.text.split('\n')).map((runs, i) => (
          <Box key={`uml-${i}`}>
            <Text>{runs.length ? runs.map(run => <Text {...UML_STYLE[run.kind]}>{run.text}</Text>) : ' '}</Text>
          </Box>
        ))}
      </Box>
    )
  })

  // Above the prompt: whatever the engine draws there, then Clawd's runway,
  // then the /clawd menu while one is typed.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // A queued make starts here, inside a hook, so its maker stays confined (spawnQueued).
    if (maker.queue.length > 0) await spawnQueued($)
    if (mod.isOff || e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const rows = Math.min(await read($, clawdRows), e.props.maxRows)
    const columns = Math.min(CLAWD_MAX_COLUMNS, e.props.bodyColumns)
    const isShown = (await read($, isClawdOn)) && rows > 0 && columns > 0
    // With Clawd hidden the menu draws its own top edge.
    const room = e.props.maxRows - (isShown ? rows : 1) - 1
    const menu = columns >= MENU_MIN_COLUMNS && room >= 0 ? await read($, clawdMenu) : null
    if (!isShown) clawd.requestId = null
    if (!isShown && !menu) return next(e)
    const engine = await next(e)
    const { Box, Raster, Text } = $.ui.resolve(e)
    const out = [engine]
    if (isShown) {
      if (!clawd.world) {
        clawd.world = createWorld(columns, rows, mod.rand)
        setSkin(clawd.world, mod.skin, true) // no puff as the band starts
      }
      clawd.world.antenna = mod.isRemote
      if (clawd.world.cols !== columns || clawd.world.rows !== rows) resize(clawd.world, columns, rows)
      setEdge(clawd.world, menu ? menu.title : null, menu?.note)
      clawd.requestId = e.requestId
      clawd.last = frameCells(clawd.world)
      out.push(<Raster key="clawd" columns={columns} rows={rows} cells={clawd.last} />)
    }
    if (menu) {
      const rule = (text: string) => <Text color={FLOOR_TEXT}>{text}</Text>
      if (!isShown) {
        const [head, tail] = edgeLine(menu.title, menu.note, columns)
        out.push(
          <Box key="menu-top" width={columns}>
            {rule('╭─ ')}
            <Text bold>{head}</Text>
            <Text dimColor>{tail}</Text>
            {rule(`${head ? ' ' : ''}${'─'.repeat(Math.max(0, columns - 5 - head.length - tail.length))}╮`)}
          </Box>,
        )
      }
      const { rows: shown, foot } = menuLayout(menu, Math.min(MENU_ROWS, room))
      const nameW = Math.min(Math.max(4, ...shown.map(r => r.name.length)), Math.floor((columns - 2) * 0.4))
      const whatW = Math.max(0, columns - 8 - nameW)
      shown.forEach((r, i) => {
        const name = cut(r.name, nameW)
        const [from, to] = [Math.min(r.from, name.length), Math.min(r.to, name.length)]
        const color = menu.isOne ? 'success' : undefined
        out.push(
          <Box key={`menu-${i}`} width={columns}>
            {rule('│')}
            <Text color="success">{menu.isOne ? ' ❯ ' : '   '}</Text>
            <Text bold color={color}>{name.slice(0, from)}</Text>
            <Text bold color="success" underline>{name.slice(from, to)}</Text>
            <Text bold color={color}>{name.slice(to).padEnd(nameW - to + 2)}</Text>
            <Text dimColor>{cut(clean(r.what), whatW).padEnd(whatW + 1)}</Text>
            {rule('│')}
          </Box>,
        )
      })
      const tail = cut(clean(foot), columns - 6)
      out.push(
        <Box key="menu-bottom" width={columns}>
          {rule(tail ? '╰─ ' : '╰─')}
          <Text dimColor>{tail}</Text>
          {rule(`${tail ? ' ' : ''}${'─'.repeat(Math.max(0, columns - (tail ? 5 + tail.length : 3)))}╯`)}
        </Box>,
      )
    }
    return <Box flexDirection="column">{out}</Box>
  })
}
