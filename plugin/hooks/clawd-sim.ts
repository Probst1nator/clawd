// Clawd, the Claude Code logo, as a small creature living in the band above
// the prompt, and a mini Clawd for each running subagent. This file is the
// pure part: the world, the behaviours, and the drawing into Raster cells. It
// never touches `$`; register.tsx drives it.
//
// Units: the band is a grid of sub-pixels, 2 x 2 per terminal cell, drawn
// with the quadrant blocks the logo itself uses (▐▛███▜▌). x grows to the
// right and `row` downwards. A body's height above the ground, `y`, grows
// upwards. Nothing is a stored frame: every pose comes from the current
// motion (speed, distance walked, vertical speed, time since landing).

export const TICK_MS = 50
const DT = TICK_MS / 1000
const GRAVITY = 120 // sub-pixels per second squared
export const WALK = 12 // sub-pixels per second
const RUN = 36
// A wiggly look's ripple: one stride per this many sub-pixels walked, twice as
// many running, so a sprint's wave stays slower than the frames.
const STRIDE = 8
const EASE_S = 0.4 // an eased move takes this long to reach full speed, and to stop from it
export const SLEEP_AFTER_S = 180 // idle seconds without any session event
export const MINI_STALE_S = 900 // a mini whose subagent was silent this long leaves
export const MAX_MINIS = 6 // minis on screen at once; more subagents get none
export const MAX_DELAY_S = 5 // how far ahead a model's call may start
const LAYERS = [4, 3, 2, 1] // bricks per pile layer, bottom up, as far as the band is tall
/** The band's height in rows, and its height while a body does a big jump. */
export const BAND_ROWS = 4
export const TALL_ROWS = 5
/** The band's height while Clawd wears a tall look and the Remote Control antenna. */
export const ANTENNA_ROWS = 6
const TALL_HOLD_S = 0.6 // the band stays tall this long after a big jump, so a second one does not resize it
export const READ_HOLD_S = 1.2 // the scroll stays up this long after the last reading call

const ORANGE = 0xd77757 // the logo's colour
// One colour per mini, in turn, so the label can say which mini is which.
const MINI_COLORS = [0x6fb3d2, 0x8fc96f, 0xc89be0, 0xe0c060, 0x5fc7b0, 0xe08fa8]
const BODY_COLORS = new Set([ORANGE, ...MINI_COLORS])
const BRICK = 0x8696a8
const BRICK_DARK = 0x67788d
const DUST = 0x8a8a9a
const GOLD = 0xffc857
const SNOOZE = 0xa8b4ff
const WHITE = 0xf0f0f0
const PAPER = 0xe8dcb8 // the scroll a reading body holds
const ROLL = 0x8b5e34 // its rolled ends
const SWEAT = 0x7fd4ff
const ANTENNA = 0xa8a8a8 // the antenna Clawd wears while Remote Control is on
const SIGNAL = 0x5fd47a // its tip
const SIGNAL_DIM = 0x2f6b3d // its tip as it blinks
const FLOOR = 0x7a7a7a // the floor line, grey like the prompt border
export const FLOOR_TEXT = '#7a7a7a' // FLOOR as a Text color, for the menu's frame below the band
const LABEL = 0x9a9aa8 // the line at the top right: what was picked
const LABEL_SPARE = 4 // cells right of the label: the engine's `[-]` and a gap
const DEFAULT = 0x01000000 // Raster: the terminal's own colour
const EMPTY = -1

// Quadrant glyph by mask: upper-left 1, upper-right 2, lower-left 4, lower-right 8.
const QUAD = [
  0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b, 0x2597, 0x259a, 0x2590, 0x259c,
  0x2584, 0x2599, 0x259f, 0x2588,
]

type Shape = 'normal' | 'squash' | 'stretch' | 'flat'
type Arms = 'out' | 'up' | 'down' | 'wave' | 'flail' | 'none'
type Eyes = 'open' | 'closed' | 'wide' | 'down' // down: reading, at the scroll; no routine or emote sets it
type Size = { w: number; h: number; eyes: [number, number]; eyeRow: number; armRow: number }

// Body sizes in sub-pixels. `normal` is the logo: 12 x 4 with eye holes at
// x 2 and 9 on row 1, arms on row 2 and four one-pixel legs below.
const SHAPES: Record<Shape, Size> = {
  normal: { w: 12, h: 4, eyes: [2, 9], eyeRow: 1, armRow: 2 },
  squash: { w: 14, h: 3, eyes: [3, 10], eyeRow: 1, armRow: 1 },
  stretch: { w: 10, h: 5, eyes: [2, 7], eyeRow: 1, armRow: 2 },
  flat: { w: 16, h: 2, eyes: [3, 12], eyeRow: 0, armRow: 1 },
}
// A mini is half the logo: 6 x 3 with eye holes at x 1 and 4 on row 1, one
// pixel of arm a side and two legs.
const MINI_SHAPES: Record<Shape, Size> = {
  normal: { w: 6, h: 3, eyes: [1, 4], eyeRow: 1, armRow: 2 },
  squash: { w: 8, h: 2, eyes: [2, 5], eyeRow: 0, armRow: 1 },
  stretch: { w: 6, h: 4, eyes: [1, 4], eyeRow: 1, armRow: 2 },
  flat: { w: 9, h: 1, eyes: [2, 6], eyeRow: 0, armRow: 0 },
}

export const ACTS = [
  'idle', 'wander', 'run', 'hop', 'jump', 'celebrate', 'trip', 'sleep', 'wake', 'wave', 'look',
  'think', 'chase', 'peek', 'carry', 'alert', 'kick', 'read',
] as const
// Acts only a routine plays: hold a pose, put a glyph over the head, throw
// sparks, move at a chosen speed, play another made act.
const STEP_ONLY = ['pose', 'mark', 'sparks', 'move', 'play'] as const
// `leave`: a mini whose subagent finished runs off the band. `emote`: Clawd
// takes an emote's look.
export type ActKind = (typeof ACTS)[number] | (typeof STEP_ONLY)[number] | 'routine' | 'leave' | 'emote'

/** The acts a model may pick, with what each looks like. */
export const PICKABLE: Partial<Record<ActKind, string>> = {
  idle: 'stands and looks around',
  wander: 'walks somewhere nearby',
  run: 'runs across the band',
  hop: 'a small hop',
  jump: 'a big jump sideways',
  celebrate: 'two hops with sparks, then a wave',
  trip: 'trips, lies flat with dizzy stars, gets up',
  wave: 'waves',
  look: 'looks left and right',
  think: 'looks up with a question mark',
  chase: 'chases a sparkle and jumps to catch it',
  peek: 'runs off one edge and comes back from the other',
  alert: 'an exclamation mark, eyes wide',
}

// What a routine step may be: the pickable acts, the step-only ones, and an emote by name.
const STEP_KINDS = [...Object.keys(PICKABLE), ...STEP_ONLY, 'emote'] as ActKind[]
const ARMS: Arms[] = ['out', 'up', 'down', 'wave', 'flail', 'none']
const EYES: Eyes[] = ['open', 'closed', 'wide']
const SHAPE_NAMES = ['normal', 'squash', 'stretch', 'flat'] as const
// ASCII only: a glyph a terminal draws two cells wide would shift the row.
const MARKS: Record<string, number> = { '!': 0xf0f0f0, '?': 0xf0f0f0, '*': 0xffc857, '+': 0xffc857, '~': 0x7fd4ff, z: 0xa8b4ff, o: 0x7fd4ff, '^': 0xf0f0f0, '#': 0xd77757 }
export const MAX_STEPS = 12

/** One step of a routine; `routineFrom` checks it and fills in nothing. */
export type Step = {
  do: ActKind
  to?: number // wander, run, move: where to, 0 left edge to 1 right edge
  dir?: number // jump, a run or move with wrap: -1 left, 1 right
  n?: number // hop: how many; sparks: how many
  height?: number // hop, jump: sub-pixels
  dur?: number // idle, wave, look, think, pose: seconds; emote: how long the look stays
  // arms, eyes, look and up apply on top of any step, so a run can wave
  arms?: Arms
  eyes?: Eyes
  shape?: Shape // pose
  look?: number // -1 back, 0 centre, 1 forward
  up?: boolean // looks up
  sit?: boolean // pose
  glyph?: string // mark
  sparks?: boolean // hop
  wrap?: boolean // run, move: off the edge in `dir`, straight back in from the other one, on to `to`
  speed?: 'walk' | 'run' | number // wander, run, move: a number counts walking speeds, run is 3
  ease?: boolean // wander, run, move: speeds up from a stand and slows to a stop
  name?: string // emote: the look to put on; play: the made act to play
  worn?: Emote // emote: the look `name` found, filled in by `linkRoutine`
  inner?: Step[] // play: the steps of the act `name` found, filled in by `linkRoutine`
}

/** A named act made of steps, written by a model and kept in data/acts/. */
export type Routine = { name: string; title: string; steps: Step[] }

/**
 * A look Clawd takes for a while (user, 2026-10-04): a sprite drawn and
 * animated the way Clawd is, from a JSON file in emotes/ (drawn by hand) or
 * data/emotes/ (drawn by a model). A shape is rows of characters: `#` body,
 * `o` an eye (a hole while open), `+` the accent colour, anything else empty.
 */
export type Emote = {
  name: string
  title: string
  color: number
  accent: number
  shapes: Record<Shape, string[]> // a shape the file leaves out is the normal one
  legs: number[] // leg columns, counted in the normal shape
  legLength: number
  isWiggly: boolean // the legs sway like tentacles and crawl in a ripple instead of stepping
  armRow: number | null // the normal shape's row the arms grow from; null: no arms
  armPoses: Record<ArmPose, [number, number][]> // [dx, dy] from the body's edge, as Clawd's
  isTall: boolean // the band grows a row while Clawd wears it, as for a big jump
  dur: number // seconds it stays on when played
  prop: Prop | null
  tool: Tool | null
}

/**
 * A thing Clawd holds in its front hand while it wears the look (user,
 * 2026-10-06: a pointer for the Rietveld chart). It has its own colours, so it
 * does not read as a horn or a tail the way a tool drawn into the arms does.
 * The first pixel of its bottom row sits one pixel past the front arm's tip,
 * so it follows the arm's pose without turning.
 */
export type Tool = {
  rows: string[] // `#` the tool's colour, `+` the emote's accent, anything else empty
  color: number
}

/**
 * An object beside Clawd that is not part of its body (user, 2026-10-05): it
 * starts `x` sub-pixels from Clawd's centre, forward as Clawd faces when the
 * look starts, and from then on keeps to its path, wherever Clawd goes.
 */
export type Prop = {
  rows: string[] // `#` the prop's colour, `+` the emote's accent, anything else empty
  color: number
  x: number
  path: PropKey[] // in time order; straight lines between keys, then the last key holds
  hasTrail: boolean // sparks below it while it rises, a rocket's flame
}

/** `t` seconds after the look starts the prop is `x` forward and its bottom `y` above the floor. */
type PropKey = { t: number; x: number; y: number }

/** The arm positions an emote may draw its own way; the other arm acts are made of them. */
type ArmPose = 'out' | 'up' | 'down' | 'raised'

export type Act = {
  kind: ActKind
  t0: number // world time the current stage started
  stage: number
  dur?: number
  to?: number
  speed?: number
  dir?: number // a run or move with wrap: -1 left, 1 right
  wrap?: boolean // run, move: a lap through the edges
  ease?: boolean // wander, run, move: an arrive, EASE_S each way
  n?: number
  height?: number
  look?: number
  next?: number
  gaze?: number // a routine step's look, on top of what the act sets; idle uses `look` for its glances
  arms?: Arms
  sparks?: boolean
  eyes?: Eyes
  shape?: Shape
  lookUp?: boolean
  sit?: boolean
  glyph?: string
  steps?: Step[] // routine
  routine?: string // the routine this act is, or is a step of
  step?: number // the routine's step this act comes from, counted from 1
  via?: string // the made act a play step plays, for its acts
  emote?: Emote // emote
  isPick?: boolean // a model's call
  isReflex?: boolean // a reaction to a session event; a model's call waits for it
  isRandom?: boolean // rolled from the idle tables; a read cuts it short
}

export type Particle = {
  x: number
  row: number
  vx: number
  vrow: number
  fall: number // added to vrow per second
  age: number
  life: number
  glyph: string
  color: number
}

/** One creature: Clawd itself, or a mini Clawd for a subagent. */
export type Body = {
  id: string // 'clawd', or a mini's: a1, a2, ...
  color: number
  isMini: boolean
  x: number // centre, sub-pixels
  y: number // feet above the ground
  vx: number
  vy: number
  facing: 1 | -1
  walked: number // distance travelled; drives the gait
  strides: number // a wiggly look's strides taken; drives its ripple
  dustAt: number
  landedAt: number
  blinkAt: number
  act: Act | null
  queue: Act[]
  // this tick's intent, set by the act
  arms: Arms
  eyes: Eyes
  look: number // -1 back, 0 centre, 1 forward
  lookUp: boolean
  shape: Shape | null
  sitting: boolean
  reading: boolean // holds a scroll
  carrying: boolean
  wearing: Emote | null // the emote whose look it has
  wornAt: number
  wornUntil: number
  propStart: { left: number; dir: 1 | -1 } | null // the prop's left column and the way the body faced, as the look started
}

/** A mini Clawd: it comes when its subagent starts and leaves when it ends. */
export type Mini = Body & {
  agentId: string
  title: string // the Agent tool's description
  kind: string // the subagent type
  since: number // world time it came
  tools: number // its subagent's tool calls
  lastEventAt: number
  isLeaving: boolean
  isGone: boolean
}

/** What a body can be told to play: a built-in act, a routine, or an emote. */
export type Playable = ActKind | Routine | Emote

/** A model's call: `who` (a body's id, or 'all') plays `what` after `delay` seconds. */
export type Call = { who: string; what: Playable; delay: number }

/** A part of the label, in its own colour. */
export type LabelPart = { text: string; color: number }

/** The world is Clawd itself plus everything around it. */
export type World = Body & {
  cols: number
  rows: number
  t: number
  rand: () => number
  mode: 'idle' | 'work'
  lastEventAt: number
  tallUntil: number // the band stays tall until this time
  pile: number
  pileAt: number // left edge of the pile, an even sub-pixel x
  spark: { x: number; row: number; vx: number; age: number; isFleeing: boolean } | null
  particles: Particle[]
  label: LabelPart[] // drawn at the top right of the band
  edge: LabelPart[] | null // while /clawd is typed: the floor is the menu's top edge, with this title
  minis: Mini[]
  minisMade: number // for the minis' ids and colours
  due: { at: number; who: string; acts: Act[] }[] // model calls waiting for their time
  base: Emote | null // the look Clawd wears whenever it wears no other; null: Clawd's own
  baseWorn: Emote | null // the base as Clawd wears it now; null while it wears another look or none
  antenna: boolean // Remote Control is on: Clawd wears an antenna on whatever look it has
}

// --- setup -------------------------------------------------------------------

function newBody(id: string, color: number, isMini: boolean, x: number): Body {
  return {
    id,
    color,
    isMini,
    x,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    walked: 0,
    strides: 0,
    dustAt: 0,
    landedAt: -1,
    blinkAt: 2,
    act: null,
    queue: [],
    arms: 'out',
    eyes: 'open',
    look: 0,
    lookUp: false,
    shape: null,
    sitting: false,
    reading: false,
    carrying: false,
    wearing: null,
    wornAt: 0,
    wornUntil: 0,
    propStart: null,
  }
}

export function createWorld(cols: number, rows: number, rand: () => number = Math.random): World {
  const w: World = {
    ...newBody('clawd', ORANGE, false, -12),
    cols,
    rows,
    t: 0,
    rand,
    mode: 'idle',
    lastEventAt: 0,
    tallUntil: 0,
    pile: 0,
    pileAt: 0,
    spark: null,
    particles: [],
    label: [],
    edge: null,
    minis: [],
    minisMade: 0,
    due: [],
    base: null,
    baseWorn: null,
    antenna: false,
  }
  resize(w, cols, rows)
  // Clawd walks in from the left and says hello.
  w.queue.push(make(w, 'wander', { to: Math.round(cols * 0.5) }), make(w, 'wave', { dur: 1.2 }))
  return w
}

export function resize(w: World, cols: number, rows: number): void {
  // Rows count from the top, so when the band grows upwards the particles
  // move down with the floor.
  const shift = 2 * (rows - w.rows)
  for (const p of w.particles) p.row += shift
  if (w.spark) w.spark.row += shift
  w.cols = cols
  w.rows = rows
  const W = cols * 2
  // Even, about 80% across, with room on its right for Clawd to drop bricks.
  w.pileAt = Math.max(0, 2 * Math.round(Math.min(W * 0.8, W - 34) / 2))
  for (const c of bodies(w)) if (c.x > W + 16) c.x = W + 16
}

/** A deterministic random source for tests. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let r = Math.imul(s ^ (s >>> 15), 1 | s)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/** Clawd first, then the minis. */
export function bodies(w: World): Body[] {
  return [w, ...w.minis]
}

/** The body a model's call names: 'clawd' or a mini's id; none for a mini on its way out. */
export function bodyOf(w: World, who: string): Body | undefined {
  if (who === 'clawd') return w
  return w.minis.find(m => m.id === who && !m.isLeaving)
}

function make(w: World, kind: ActKind, extra: Partial<Act> = {}): Act {
  return { kind, t0: w.t, stage: 0, ...extra }
}

function reflex(w: World, kind: ActKind, extra: Partial<Act> = {}): Act {
  return make(w, kind, { ...extra, isReflex: true })
}

function between(w: World, lo: number, hi: number): number {
  return lo + w.rand() * (hi - lo)
}

function width(w: World): number {
  return w.cols * 2
}

// The feet stand on the upper half of the band's last row, as in the logo
// (`▘▘ ▝▝`), and the rest of that row is a floor line (`─`) for them to stand
// on. Claude Code keeps a blank row above the prompt box that no mod reaches,
// so the floor is as close to the prompt as Clawd gets (user, 2026-10-03).
function ground(w: World): number {
  return w.rows * 2 - 2
}

/** Sub-pixel rows above standing Clawd's head; jumps stay within them. */
function headroom(w: World): number {
  return Math.max(0, w.rows * 2 - 6)
}

/** How far a standing body's top is above its feet, in sub-pixels. */
function bodyHeight(c: Body): number {
  if (c.wearing) return c.wearing.shapes.normal.length + c.wearing.legLength - 1
  return c.isMini ? 3 : 4
}

/** Sub-pixel rows above a standing body's head; its jumps stay within them. */
function roomAbove(w: World, c: Body): number {
  return c.wearing ? Math.max(0, ground(w) - bodyHeight(c)) : headroom(w)
}

function pileCapacity(w: World): number {
  let n = 0
  while (brickSpot(w, n)) n += 1
  return n
}

function isAirborne(c: Body): boolean {
  return c.y > 0 || c.vy > 0
}

// --- session events (called by register.tsx) ---------------------------------------

/** Replaces what `c` is doing with `acts`; a carried brick falls off. */
export function interrupt(w: World, c: Body, acts: Act[]): void {
  if (c.carrying && acts[0]?.kind !== 'trip') dropBrick(w, c)
  c.act = null
  c.queue = [...acts, ...c.queue.filter(a => a.kind === 'carry')]
}

export function onPrompt(w: World): void {
  const wasAsleep = w.act?.kind === 'sleep'
  w.lastEventAt = w.t
  w.mode = 'work'
  const plan = wasAsleep ? [reflex(w, 'wake')] : [reflex(w, 'alert'), reflex(w, 'hop', { n: 1, height: 2 })]
  if (w.pile > 0) plan.push(reflex(w, 'kick'))
  interrupt(w, w, plan)
}

/**
 * A tool call: a brick for the pile, a read when the call only read
 * (`isReading`), or a trip when it failed. A subagent's call goes to its mini;
 * without one, to Clawd.
 */
export function onTool(w: World, isError: boolean, agentId?: string, isReading = false): void {
  const mini = agentId === undefined ? undefined : w.minis.find(m => m.agentId === agentId && !m.isLeaving)
  const c: Body = mini ?? w
  if (mini) {
    mini.lastEventAt = w.t
    mini.tools += 1
  } else {
    w.lastEventAt = w.t
  }
  if (isError) {
    interrupt(w, c, [reflex(w, 'trip')])
    return
  }
  if (!mini && w.mode !== 'work') return
  if (isReading) {
    read(w, c)
    return
  }
  const pending = (b: Body) => b.queue.filter(a => a.kind === 'carry').length + (b.act?.kind === 'carry' ? 1 : 0)
  const all = bodies(w).reduce((sum, b) => sum + pending(b), 0)
  if (pending(c) < 2 && w.pile + all < pileCapacity(w)) c.queue.push(reflex(w, 'carry'))
}

// Reads in a row make one read that ends READ_HOLD_S after the last. A read
// cuts an act from the idle tables short (not a peek, which may be off the
// band) and waits behind everything else.
function read(w: World, c: Body): void {
  if (c.act?.kind === 'read') {
    c.act.dur = Math.max(c.act.dur ?? 0, w.t - c.act.t0 + READ_HOLD_S)
    return
  }
  if (c.queue.some(a => a.kind === 'read')) return
  const act = reflex(w, 'read', { dur: READ_HOLD_S })
  if (c.act?.isRandom && c.act.kind !== 'peek') {
    c.act = null
    c.queue.unshift(act)
  } else {
    c.queue.push(act)
  }
}

export function onTurnEnd(w: World, reason: string): void {
  w.lastEventAt = w.t
  w.mode = 'idle'
  w.queue = w.queue.filter(a => a.kind !== 'carry')
  if (reason === 'error') interrupt(w, w, [reflex(w, 'trip')])
  else if (reason === 'aborted') interrupt(w, w, [reflex(w, 'look', { dur: 1.5 }), reflex(w, 'think', { dur: 1.5 })])
  else interrupt(w, w, [reflex(w, 'celebrate')])
}

/** A subagent started: its mini runs in from an edge. None past MAX_MINIS. */
export function spawnMini(w: World, agentId: string, title: string, kind: string): Mini | null {
  if (w.minis.filter(m => !m.isLeaving).length >= MAX_MINIS) return null
  const n = w.minisMade
  w.minisMade += 1
  const W = width(w)
  const fromLeft = w.rand() < 0.5
  const mini: Mini = {
    ...newBody(`a${n + 1}`, MINI_COLORS[n % MINI_COLORS.length] ?? ORANGE, true, fromLeft ? -8 : W + 8),
    agentId,
    title,
    kind,
    since: w.t,
    tools: 0,
    lastEventAt: w.t,
    isLeaving: false,
    isGone: false,
  }
  mini.queue.push(reflex(w, 'run', { to: between(w, 0.1, 0.7) * W }), reflex(w, 'alert'))
  w.minis.push(mini)
  return mini
}

/** A subagent ended: its mini celebrates (or trips) and runs off the band. */
export function endMini(w: World, agentId: string, reason: string): Mini | undefined {
  const mini = w.minis.find(m => m.agentId === agentId && !m.isLeaving)
  if (mini) leave(w, mini, reason)
  return mini
}

function leave(w: World, mini: Mini, reason: string): void {
  mini.isLeaving = true
  mini.queue = []
  w.due = w.due.filter(d => d.who !== mini.id)
  interrupt(w, mini, [reflex(w, reason === 'answer' ? 'celebrate' : 'trip'), reflex(w, 'leave')])
}

/** True while a body wants the tall band: during a big jump and shortly after. */
export function wantsTall(w: World): boolean {
  return w.t < w.tallUntil
}

/** The band's height in rows that the world wants now: a row more while tall, two with the antenna on a tall look. */
export function bandRows(w: World): number {
  if (!wantsTall(w)) return BAND_ROWS
  return w.antenna && w.wearing?.isTall ? ANTENNA_ROWS : TALL_ROWS
}

/** `/clawd [who] <act> [n]`: do it now, `n` times in a row; false when `who` is not there. */
export function perform(w: World, what: Playable, n = 1, who = 'clawd'): boolean {
  const c = bodyOf(w, who)
  if (!c) return false
  if (c === w) w.lastEventAt = w.t
  interrupt(w, c, Array.from({ length: n }, () => actFor(w, what)))
  return true
}

/**
 * A model's calls, like parallel tool calls: each named body (or 'all') plays
 * its calls in the order given, starting at the smallest `delay` (0 to 5 s)
 * among them. At its time a call cuts in on what the body does, except a
 * reaction to a session event, which it waits for. Calls replace a body's
 * earlier calls still waiting. Answers the ids that got calls.
 */
export function callActs(w: World, calls: Call[]): string[] {
  const slots = new Map<string, { at: number; acts: Act[] }>()
  for (const call of calls) {
    const targets = call.who === 'all' ? bodies(w).filter(b => bodyOf(w, b.id)) : [bodyOf(w, call.who)]
    const at = w.t + Math.min(MAX_DELAY_S, Math.max(0, Number.isFinite(call.delay) ? call.delay : 0))
    for (const b of targets) {
      if (!b) continue
      const slot = slots.get(b.id) ?? { at, acts: [] }
      slot.at = Math.min(slot.at, at)
      slot.acts.push(actFor(w, call.what, { isPick: true }))
      slots.set(b.id, slot)
    }
  }
  w.due = w.due.filter(d => !slots.has(d.who))
  for (const [who, slot] of slots) {
    const b = bodyOf(w, who)
    if (b) b.queue = b.queue.filter(a => !a.isPick)
    w.due.push({ at: slot.at, who, acts: slot.acts })
  }
  startDue(w)
  return [...slots.keys()]
}

// Starts the calls whose time has come.
function startDue(w: World): void {
  if (!w.due.some(d => d.at <= w.t + 1e-9)) return
  const now = w.due.filter(d => d.at <= w.t + 1e-9)
  w.due = w.due.filter(d => d.at > w.t + 1e-9)
  for (const d of now) {
    const b = bodyOf(w, d.who)
    if (!b) continue
    // Reactions to session events go first, bricks to fetch after the call.
    const ahead = b.queue.filter(a => a.isReflex && a.kind !== 'carry')
    const after = b.queue.filter(a => !a.isPick && !(a.isReflex && a.kind !== 'carry'))
    b.queue = [...ahead, ...d.acts, ...after]
    if (!b.act?.isReflex && ahead.length === 0) b.act = null
  }
}

export function isAsleep(w: World): boolean {
  return w.act?.kind === 'sleep'
}

/** The text with only characters one cell wide (Latin-1 and Latin Extended). */
export function clean(text: string): string {
  return text.replace(/[^\x20-\x7e -ɏ]/g, '')
}

/** The line at the top right of the band; only characters one cell wide. */
export function setLabel(w: World, label: string | LabelPart[]): void {
  const parts = typeof label === 'string' ? [{ text: label, color: LABEL }] : label
  w.label = parts.map(p => ({ text: clean(p.text), color: p.color })).filter(p => p.text)
  const first = w.label[0]
  if (first) first.text = first.text.trimStart()
  const last = w.label[w.label.length - 1]
  if (last) last.text = last.text.trimEnd()
}

/** The floor as the top edge of the `/clawd` menu: the title in the terminal's colour, the note dim; null for the plain floor. */
export function setEdge(w: World, title: string | null, note = ''): void {
  if (title === null) w.edge = null
  else w.edge = [{ text: clean(title), color: DEFAULT }, { text: note ? clean(` · ${note}`) : '', color: LABEL }].filter(p => p.text)
}

/**
 * The label for a model's calls: `clawd: wave · a1: hop+peek`, each part in
 * its body's colour, then `note` in grey.
 */
export function callLabel(w: World, calls: { who: string; name: string }[], note = ''): void {
  const byWho = new Map<string, string[]>()
  for (const c of calls) byWho.set(c.who, [...(byWho.get(c.who) ?? []), c.name])
  const parts: LabelPart[] = []
  for (const [who, names] of byWho) {
    if (parts.length > 0) parts.push({ text: ' · ', color: LABEL })
    const b = who === 'all' ? undefined : w.minis.find(m => m.id === who) ?? (who === 'clawd' ? w : undefined)
    parts.push({ text: `${who}: ${names.join('+')}`, color: b?.color ?? LABEL })
  }
  // Without calls, a note starts the label, so it loses its leading ` · `.
  if (note) parts.push({ text: parts.length > 0 ? note : note.replace(/^ · /, ''), color: LABEL })
  setLabel(w, parts)
}

function actFor(w: World, what: Playable, extra: Partial<Act> = {}): Act {
  if (typeof what === 'string') return make(w, what, extra)
  if ('shapes' in what) return make(w, 'emote', { emote: what, ...extra })
  return make(w, 'routine', { routine: what.name, steps: what.steps, ...extra })
}

/**
 * Checks a routine a model wrote: a snake_case name, a title, and 1 to 12
 * steps of known acts. Numbers are clamped and unknown fields dropped; the
 * answer is the routine, or what is wrong with it.
 */
export function routineFrom(raw: unknown): Routine | string {
  if (typeof raw !== 'object' || raw === null) return 'not an object'
  const r = raw as Record<string, unknown>
  const name = typeof r.name === 'string' ? r.name : ''
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(name)) return `bad name ${JSON.stringify(r.name)}`
  if ((ACTS as readonly string[]).includes(name) || STEP_KINDS.includes(name as ActKind)) return `${name} is a built-in act`
  const title = typeof r.title === 'string' ? r.title.trim().slice(0, 80) : ''
  if (!title) return 'no title'
  if (!Array.isArray(r.steps) || r.steps.length === 0) return 'no steps'
  const steps: Step[] = []
  for (const raw of r.steps.slice(0, MAX_STEPS)) {
    const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const kind = s.do as ActKind
    if (!STEP_KINDS.includes(kind)) return `unknown step ${JSON.stringify(s.do)}`
    const num = (v: unknown, lo: number, hi: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined
    const one = <T>(v: unknown, from: readonly T[]) => (from.includes(v as T) ? (v as T) : undefined)
    const step: Step = { do: kind }
    const set = <K extends keyof Step>(key: K, value: Step[K] | undefined) => {
      if (value !== undefined) step[key] = value
    }
    set('to', num(s.to, 0, 1))
    set('dir', s.dir === -1 || s.dir === 1 ? s.dir : undefined)
    set('n', num(s.n, 1, kind === 'sparks' ? 8 : 3))
    set('height', num(s.height, 1, 6))
    set('dur', kind === 'emote' ? num(s.dur, 1, 20) : num(s.dur, 0.2, 4))
    set('arms', one(s.arms, ARMS))
    set('eyes', one(s.eyes, EYES))
    set('shape', one(s.shape, SHAPE_NAMES))
    set('look', s.look === -1 || s.look === 0 || s.look === 1 ? s.look : undefined)
    set('up', typeof s.up === 'boolean' ? s.up : undefined)
    set('sit', typeof s.sit === 'boolean' ? s.sit : undefined)
    set('sparks', typeof s.sparks === 'boolean' ? s.sparks : undefined)
    set('wrap', typeof s.wrap === 'boolean' ? s.wrap : undefined)
    set('speed', s.speed === 'walk' || s.speed === 'run' ? s.speed : num(s.speed, 0.25, 4))
    set('ease', typeof s.ease === 'boolean' ? s.ease : undefined)
    if (kind === 'mark') {
      if (typeof s.glyph !== 'string' || !(s.glyph in MARKS)) return `bad glyph ${JSON.stringify(s.glyph)}`
      step.glyph = s.glyph
    }
    if (kind === 'emote' || kind === 'play') {
      if (typeof s.name !== 'string' || !/^[a-z][a-z0-9_]{1,30}$/.test(s.name)) return `bad ${kind} name ${JSON.stringify(s.name)}`
      if (kind === 'play' && s.name === name) return `${name} plays itself`
      step.name = s.name
    }
    steps.push(step)
  }
  return { name, title, steps }
}

const EMOTE_MAX_W = 20 // sub-pixels, the arms come on top
// Clawd's arms: [dx, dy] from the body's edge on the arm row.
const CLAWD_ARMS: Record<ArmPose, [number, number][]> = {
  out: [[1, 0], [2, 0]],
  up: [[1, -1], [2, -2]],
  down: [[1, 1]],
  raised: [[1, -1], [1, -2]],
}
// High with the legs, so a sub-pixel stays free above the head: in the 4-row
// band, and in the 5-row band for a tall emote.
const EMOTE_MAX_H = 6
const TALL_EMOTE_MAX_H = 8
const PROP_MAX_W = 8
const PROP_MAX_KEYS = 8
const PROP_MAX_Y = 24 // sub-pixels; past about 10 the prop has left the band
const TOOL_MAX_W = 8
const TOOL_MAX_H = 4

const colorOf = (v: unknown) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? Number.parseInt(v.slice(1), 16) : undefined)

// Rows of pixel characters: only the `marks` count, the rest become `.`, and
// empty rows above and below go.
function pixelRows(v: unknown, marks: string): string[] | undefined {
  if (!Array.isArray(v) || !v.every(line => typeof line === 'string')) return undefined
  const other = new RegExp(`[^${marks}]`, 'g')
  const lines = (v as string[]).map(line => line.replace(other, '.'))
  const isEmpty = (line: string | undefined) => line !== undefined && !/[^.]/.test(line)
  while (isEmpty(lines[0])) lines.shift()
  while (isEmpty(lines[lines.length - 1])) lines.pop()
  return lines.length > 0 ? lines : undefined
}

/** Checks an emote's prop; the prop, or what is wrong with it. */
function propOf(raw: unknown, isTall: boolean, dur: number, accent: number): Prop | string {
  if (typeof raw !== 'object' || raw === null) return 'not an object'
  const r = raw as Record<string, unknown>
  const rows = pixelRows(r.rows, '#+')
  if (!rows) return 'no rows'
  const wide = Math.max(...rows.map(line => line.length))
  if (wide > PROP_MAX_W) return `rows are ${wide} wide, at most ${PROP_MAX_W}`
  const maxH = isTall ? TALL_EMOTE_MAX_H : EMOTE_MAX_H
  if (rows.length > maxH) return `rows are ${rows.length} high, at most ${maxH}`
  const color = r.color === undefined ? accent : colorOf(r.color)
  if (color === undefined) return `bad color ${JSON.stringify(r.color)}, want #rrggbb`
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const keys = Array.isArray(r.path) ? r.path : []
  if (keys.length === 0) return 'no path'
  if (keys.length > PROP_MAX_KEYS) return `path has ${keys.length} keys, at most ${PROP_MAX_KEYS}`
  const path: PropKey[] = []
  for (const key of keys) {
    const k = (typeof key === 'object' && key !== null ? key : {}) as Record<string, unknown>
    const t = num(k.t)
    const y = num(k.y)
    if (t === undefined || y === undefined) return 'a path key needs t and y'
    if (t < 0 || t > dur) return `path t ${t} is outside 0 to dur (${dur})`
    if (t < (path[path.length - 1]?.t ?? 0)) return 'path keys are not in time order'
    path.push({ t, x: Math.min(40, Math.max(-40, num(k.x) ?? 0)), y: Math.min(PROP_MAX_Y, Math.max(0, y)) })
  }
  const x = Math.min(30, Math.max(-30, Math.round(num(r.x) ?? -12)))
  return { rows, color, x, path, hasTrail: r.trail === true }
}

/** Checks an emote's tool; the tool, or what is wrong with it. */
function toolOf(raw: unknown, accent: number): Tool | string {
  if (typeof raw !== 'object' || raw === null) return 'not an object'
  const r = raw as Record<string, unknown>
  const rows = pixelRows(r.rows, '#+')
  if (!rows) return 'no rows'
  const wide = Math.max(...rows.map(line => line.length))
  if (wide > TOOL_MAX_W) return `rows are ${wide} wide, at most ${TOOL_MAX_W}`
  if (rows.length > TOOL_MAX_H) return `rows are ${rows.length} high, at most ${TOOL_MAX_H}`
  const color = r.color === undefined ? accent : colorOf(r.color)
  if (color === undefined) return `bad color ${JSON.stringify(r.color)}, want #rrggbb`
  return { rows, color }
}

/**
 * Checks an emote from a file or a model: a snake_case name that is no
 * built-in act, a title, a colour, and a normal shape that fits the band.
 * Shapes it leaves out are the normal one; numbers are clamped. The answer is
 * the emote, or what is wrong with it.
 */
export function emoteFrom(raw: unknown): Emote | string {
  if (typeof raw !== 'object' || raw === null) return 'not an object'
  const r = raw as Record<string, unknown>
  const name = typeof r.name === 'string' ? r.name : ''
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(name)) return `bad name ${JSON.stringify(r.name)}`
  if ((ACTS as readonly string[]).includes(name) || STEP_KINDS.includes(name as ActKind)) return `${name} is a built-in act`
  const title = typeof r.title === 'string' ? r.title.trim().slice(0, 80) : ''
  if (!title) return 'no title'
  const color = colorOf(r.color)
  if (color === undefined) return `bad color ${JSON.stringify(r.color)}, want #rrggbb`
  const raws = (typeof r.shapes === 'object' && r.shapes !== null ? r.shapes : {}) as Record<string, unknown>
  // Only body, eye and accent pixels count.
  const rowsOf = (v: unknown) => pixelRows(v, '#o+')
  const normal = rowsOf(raws.normal)
  if (!normal) return 'no normal shape'
  const legLength = typeof r.legLength === 'number' && Number.isFinite(r.legLength) ? Math.min(3, Math.max(0, Math.round(r.legLength))) : 1
  const isTall = r.tall === true
  const maxH = isTall ? TALL_EMOTE_MAX_H : EMOTE_MAX_H
  const shapes = { normal } as Record<Shape, string[]>
  for (const shape of SHAPE_NAMES) {
    const lines = shape === 'normal' ? normal : (rowsOf(raws[shape]) ?? normal)
    const wide = Math.max(...lines.map(line => line.length))
    if (wide > EMOTE_MAX_W) return `${shape} is ${wide} wide, at most ${EMOTE_MAX_W}`
    const high = lines.length + (shape === 'normal' || shape === 'stretch' ? legLength : 0)
    if (high > maxH) return `${shape} is ${high} high with its legs, at most ${maxH}${isTall ? '' : ' (8 with "tall": true)'}`
    shapes[shape] = lines
  }
  const nw = Math.max(...normal.map(line => line.length))
  const legs = (Array.isArray(r.legs) ? r.legs : [])
    .filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < nw)
    .slice(0, 8)
  const armRow = typeof r.armRow === 'number' && Number.isInteger(r.armRow) && r.armRow >= 0 && r.armRow < normal.length ? r.armRow : null
  const dur = typeof r.dur === 'number' && Number.isFinite(r.dur) ? Math.min(20, Math.max(3, r.dur)) : 8
  // Arm poses the file gives replace Clawd's: up to 4 pixels each, within 3 of the edge, in one
  // line: the first touches the edge, each next one the one before. Any other pose keeps Clawd's,
  // since a fork drawn as a tool reads as horns or a tail.
  const arms = (typeof r.arms === 'object' && r.arms !== null ? r.arms : {}) as Record<string, unknown>
  const armPoses = { ...CLAWD_ARMS }
  for (const pose of Object.keys(CLAWD_ARMS) as ArmPose[]) {
    const v = arms[pose]
    if (!Array.isArray(v)) continue
    const pixels = v
      .filter(
        (p): p is [number, number] =>
          Array.isArray(p) && p.length === 2 && p.every(n => Number.isInteger(n) && Math.abs(n) <= 3),
      )
      .slice(0, 4)
    const isLine = pixels.every(([dx, dy], i) => {
      const [px, py] = pixels[i - 1] ?? [0, 0]
      return Math.abs(dx - px) <= 1 && Math.abs(dy - py) <= 1
    })
    if (pixels.length > 0 && isLine) armPoses[pose] = pixels
  }
  const accent = colorOf(r.accent) ?? WHITE
  const prop = r.prop === undefined || r.prop === null ? null : propOf(r.prop, isTall, dur, accent)
  if (typeof prop === 'string') return `prop: ${prop}`
  const tool = r.tool === undefined || r.tool === null ? null : toolOf(r.tool, accent)
  if (typeof tool === 'string') return `tool: ${tool}`
  return { name, title, color, accent, shapes, legs, legLength, isWiggly: r.wiggle === true, armRow, armPoses, isTall, dur, prop, tool }
}

/** An emote as JSON, the way emoteFrom reads it. */
export function emoteJson(look: Emote): Record<string, unknown> {
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`
  return {
    name: look.name,
    title: look.title,
    color: hex(look.color),
    accent: hex(look.accent),
    shapes: look.shapes,
    legs: look.legs,
    legLength: look.legLength,
    wiggle: look.isWiggly,
    armRow: look.armRow,
    arms: look.armPoses,
    tall: look.isTall,
    dur: look.dur,
    ...(look.prop
      ? { prop: { rows: look.prop.rows, color: hex(look.prop.color), x: look.prop.x, path: look.prop.path, trail: look.prop.hasTrail } }
      : {}),
    ...(look.tool ? { tool: { rows: look.tool.rows, color: hex(look.tool.color) } } : {}),
  }
}

/**
 * Fills in what a routine's emote and play steps name; `find` answers a made
 * act or an emote by name. The played act's own play steps are dropped, so
 * acts play each other one level deep. A step whose name finds nothing, or
 * the wrong kind, stays empty and plays nothing.
 */
export function linkRoutine<R extends Routine>(r: R, find: (name: string) => Playable | undefined, isInner = false): R {
  const steps = r.steps.map(s => {
    if (s.do !== 'emote' && s.do !== 'play') return s
    const step: Step = { ...s }
    delete step.worn
    delete step.inner
    const found = s.name ? find(s.name) : undefined
    if (typeof found !== 'object') return step
    if (s.do === 'emote' && 'shapes' in found) step.worn = found
    if (s.do === 'play' && !isInner && 'steps' in found) step.inner = linkRoutine(found, find, true).steps
    return step
  })
  return { ...r, steps }
}

/** A routine's steps as acts, in the units the acts use; a play step becomes the acts of the steps it plays. */
function stepActs(w: World, a: Act, steps = a.steps ?? [], outer?: { step: number; via: string }): Act[] {
  return steps.flatMap((s, i) => {
    if (s.do === 'play') return outer || !s.inner ? [] : stepActs(w, a, s.inner, { step: i + 1, via: s.name ?? '' })
    if (s.do === 'emote' && !s.worn) return []
    const act = make(w, s.do, { routine: a.routine, step: outer?.step ?? i + 1, isPick: a.isPick, isReflex: a.isReflex })
    if (outer) act.via = outer.via
    if (s.worn) act.emote = s.worn
    const isMove = s.do === 'wander' || s.do === 'run' || s.do === 'move'
    if (s.to !== undefined && isMove) act.to = s.to * width(w)
    if (s.dir !== undefined && s.do === 'jump') act.to = s.dir
    if (s.wrap && (s.do === 'run' || s.do === 'move')) {
      act.wrap = true
      if (s.dir !== undefined) act.dir = s.dir
    }
    if (s.speed !== undefined && isMove) act.speed = s.speed === 'walk' ? WALK : s.speed === 'run' ? RUN : s.speed * WALK
    if (s.ease && isMove) act.ease = true
    if (s.n !== undefined) act.n = Math.round(s.n)
    if (s.height !== undefined) act.height = s.height
    if (s.dur !== undefined) act.dur = s.dur
    if (s.arms) act.arms = s.arms
    if (s.eyes) act.eyes = s.eyes
    if (s.shape) act.shape = s.shape
    if (s.look !== undefined) act.gaze = s.look
    if (s.up) act.lookUp = true
    if (s.sit) act.sit = true
    if (s.sparks) act.sparks = true
    if (s.glyph) act.glyph = s.glyph
    return [act]
  })
}

// --- the tick --------------------------------------------------------------------

export function step(w: World): void {
  w.t += DT
  startDue(w)
  for (const c of bodies(w)) {
    c.arms = 'out'
    c.eyes = 'open'
    c.look = 0
    c.lookUp = false
    c.shape = null
    c.sitting = false
    c.reading = false
    if (!isAirborne(c)) c.vx = 0
    const act = (c.act ??= nextAct(w, c))
    if (isBigJump(act)) w.tallUntil = w.t + TALL_HOLD_S
    if (runAct(w, c, act)) c.act = null
    overlay(c, act)
    physics(w, c)
    if (c.wearing?.prop) moveProp(w, c, c.wearing.prop)
    if (c.wearing && w.t >= c.wornUntil && !isAirborne(c)) {
      puff(w, c, c.wearing.color)
      const prop = c.wearing.prop
      if (prop) {
        // A prop left on the floor breaks apart like a mined block; one still in the air goes in a puff.
        const box = propBox(w, c, prop)
        if (box.bottom >= ground(w)) breakProp(w, c, c.wearing, prop)
        else if (box.bottom >= 0) puffAt(w, box.left + box.width / 2, box.bottom - box.height + 1, box.height, box.width / 2 + 2, prop.color)
      }
      c.wearing = null
    }
    if (c === w) wearBase(w)
    if (c.wearing?.isTall) w.tallUntil = w.t + TALL_HOLD_S
  }
  if (w.antenna) w.tallUntil = w.t + TALL_HOLD_S // the antenna's tip needs the second row of headroom
  moveParticles(w)
  moveSpark(w)
  for (const c of bodies(w)) {
    if (w.t > c.blinkAt + 0.12) c.blinkAt = w.t + between(w, 2, 6)
  }
  for (const m of w.minis) {
    if (!m.isLeaving && w.t - m.lastEventAt > MINI_STALE_S) leave(w, m, 'stale')
  }
  w.minis = w.minis.filter(m => !m.isGone)
}

const WORK_TABLE: [ActKind, number][] = [['wander', 22], ['run', 18], ['think', 18], ['look', 10], ['idle', 10], ['hop', 6], ['jump', 6], ['chase', 4], ['peek', 3], ['wave', 3]]
const IDLE_TABLE: [ActKind, number][] = [['wander', 28], ['idle', 26], ['look', 10], ['wave', 5], ['hop', 6], ['jump', 5], ['run', 7], ['chase', 6], ['peek', 4], ['think', 3]]
const MINI_TABLE: [ActKind, number][] = [['wander', 28], ['think', 18], ['idle', 16], ['look', 12], ['run', 10], ['hop', 8], ['jump', 4], ['wave', 4]]

function nextAct(w: World, c: Body): Act {
  const queued = c.queue.shift()
  if (queued) return { ...queued, t0: w.t, stage: 0 }
  if (!c.isMini && w.mode === 'idle' && w.t - w.lastEventAt > SLEEP_AFTER_S) return make(w, 'sleep')
  const table = c.isMini ? MINI_TABLE : w.mode === 'work' ? WORK_TABLE : IDLE_TABLE
  let roll = w.rand() * table.reduce((sum, [, weight]) => sum + weight, 0)
  for (const [kind, weight] of table) {
    roll -= weight
    if (roll <= 0) return make(w, kind, { isRandom: true })
  }
  return make(w, 'idle', { isRandom: true })
}

// The jump act, the sparkle chase and the turn-end hops get the tall band
// (user, 2026-10-03: "Grow for big jumps").
function isBigJump(a: Act): boolean {
  return a.kind === 'jump' || a.kind === 'chase' || (a.kind === 'hop' && a.sparks === true)
}

/**
 * A routine step's arms, eyes, look and up win over what its act set: the
 * upper-body layer of a layered animation (ANIMATION.md, S1).
 */
function overlay(c: Body, a: Act): void {
  if (a.arms) c.arms = a.arms
  if (a.eyes) c.eyes = a.eyes
  if (a.gaze !== undefined) c.look = a.gaze
  if (a.lookUp) c.lookUp = true
}

/**
 * Reynolds' arrive: from a stand the speed grows to full in EASE_S, and near
 * the target it falls so that a constant braking stops it there in EASE_S.
 * `e` is the time since the move started.
 */
function eased(speed: number, e: number, gap: number, isStart: boolean, isEnd: boolean): number {
  const rate = speed / EASE_S
  let v = speed
  if (isStart) v = Math.min(v, rate * (e + DT))
  if (isEnd) v = Math.min(v, Math.sqrt(2 * rate * Math.abs(gap)))
  return v
}

/** Moves towards `to`; true once there. */
function moveTo(c: Body, to: number, speed: number): boolean {
  const gap = to - c.x
  if (Math.abs(gap) <= speed * DT) {
    c.x = to
    return true
  }
  c.vx = Math.sign(gap) * speed
  c.look = 1
  return false
}

function jumpUp(w: World, c: Body, height: number): void {
  const room = roomAbove(w, c)
  // The half step makes up for what the stepwise integration loses, so the
  // apex reaches `height` instead of half a sub-pixel below it.
  if (room > 0) c.vy = Math.sqrt(2 * GRAVITY * Math.max(0.5, Math.min(height, room))) + (GRAVITY * DT) / 2
}

function nextStage(w: World, a: Act): void {
  a.stage += 1
  a.t0 = w.t
}

/** Runs one tick of `c`'s act; true when it is done. */
function runAct(w: World, c: Body, a: Act): boolean {
  const e = w.t - a.t0
  const W = width(w)
  switch (a.kind) {
    case 'idle': {
      a.dur ??= between(w, 2, 5)
      if (e >= (a.next ?? 0)) {
        a.look = [-1, 0, 0, 1][Math.floor(w.rand() * 4)] ?? 0
        a.next = e + between(w, 0.8, 2.3)
      }
      c.look = a.look ?? 0
      return e > a.dur
    }
    case 'wander':
    case 'run':
    case 'move': {
      // wander and run are move with a preset speed and target (ANIMATION.md, S2).
      const speed =
        a.speed ?? (a.kind === 'run' ? RUN : a.kind === 'wander' && (w.mode === 'work' || c.isMini) ? WALK * 1.5 : WALK)
      const go = (to: number, isStart: boolean, isEnd: boolean) =>
        moveTo(c, to, a.ease ? eased(speed, e, to - c.x, isStart, isEnd) : speed)
      if (a.wrap) {
        // A lap (user, 2026-10-06): off the edge ahead, straight back in from the
        // other edge, on to `to`, by default where it started.
        if (isAirborne(c)) return false
        if (a.stage === 0) {
          a.dir ??= c.facing
          a.to ??= c.x
          if (!go(a.dir < 0 ? -14 : W + 14, true, false)) return false
          c.x = a.dir < 0 ? W + 14 : -14
          nextStage(w, a)
        }
        return go(a.to, false, true)
      }
      if (a.to === undefined) {
        a.to =
          a.kind === 'run'
            ? (c.x < W / 2 ? between(w, 0.7, 0.92) : between(w, 0.08, 0.3)) * W
            : Math.min(W - 8, Math.max(8, c.x + (w.rand() < 0.5 ? -1 : 1) * between(w, 20, 70)))
      }
      if (isAirborne(c)) return false
      return go(a.to, true, true)
    }
    case 'hop':
    case 'jump': {
      c.arms = a.arms ?? (a.kind === 'jump' ? 'up' : 'out')
      if (a.kind === 'jump' && a.to === undefined) {
        a.to = c.x < 30 ? 1 : c.x > W - 30 ? -1 : w.rand() < 0.5 ? 1 : -1 // direction
      }
      if (a.stage === 0) {
        if (isAirborne(c)) return false
        c.shape = 'squash'
        if (e < 0.09) return false
        // A big jump waits up to 0.3 s for the band to grow; a short terminal keeps it small.
        if (isBigJump(a) && w.rows < TALL_ROWS && e < 0.3) return false
        if (a.sparks) burst(w, c, 3)
        if (roomAbove(w, c) === 0) {
          // No room above the head: bounce in place, tall with legs tucked.
          a.stage = 2
          a.t0 = w.t
          return false
        }
        if (a.kind === 'jump') c.vx = (a.to ?? 1) * 18
        jumpUp(w, c, a.height ?? (a.kind === 'jump' ? between(w, 4, 5.5) : 2))
        nextStage(w, a)
        return false
      }
      if (a.stage === 2) {
        c.shape = 'stretch'
        c.sitting = true
        if (a.kind === 'jump') c.vx = (a.to ?? 1) * 18
        if (e < (a.kind === 'jump' ? 0.3 : 0.14)) return false
      } else if (isAirborne(c)) {
        return false
      }
      a.n = (a.n ?? 1) - 1
      if (a.kind === 'jump' || a.n <= 0) return true
      a.stage = 0
      a.t0 = w.t
      return false
    }
    case 'celebrate': {
      const flags = { isPick: a.isPick, isReflex: a.isReflex }
      c.queue.unshift(
        make(w, 'hop', { n: 2, height: 3, arms: 'up', sparks: true, ...flags }),
        make(w, 'wave', { dur: 1.2, ...flags }),
      )
      return true
    }
    case 'trip': {
      const reach = c.isMini ? 5 : 9
      if (a.stage === 0) {
        if (c.carrying) dropBrick(w, c)
        c.shape = 'stretch'
        c.arms = 'flail'
        c.eyes = 'wide'
        if (!isAirborne(c)) c.vx = c.facing * 14
        if (e > 0.25) {
          nextStage(w, a)
          spawn(w, { x: c.x + c.facing * reach, row: ground(w) - bodyHeight(c), vx: c.facing * 4, vrow: -4, fall: 20, life: 1, glyph: "'", color: SWEAT })
        }
        return false
      }
      if (a.stage === 1) {
        c.shape = 'flat'
        c.arms = 'none'
        c.eyes = 'closed'
        if (e >= (a.next ?? 0)) {
          spawn(w, { x: c.x + between(w, -reach + 3, reach - 3), row: ground(w) - 3, vx: between(w, -4, 4), vrow: -5, fall: 0, life: 0.6, glyph: '*', color: GOLD })
          a.next = e + 0.35
        }
        if (e > 1.4) nextStage(w, a)
        return false
      }
      if (a.stage === 2) {
        c.shape = 'squash'
        if (e > 0.15) nextStage(w, a)
        return false
      }
      c.look = Math.floor(e / 0.3) % 2 ? 1 : -1
      return e > 0.9
    }
    case 'sleep': {
      c.sitting = true
      c.eyes = 'closed'
      c.arms = 'down'
      if (e >= (a.next ?? 1)) {
        spawn(w, { x: c.x + c.facing * 8, row: ground(w) - 4, vx: c.facing * 3, vrow: -0.8, fall: 0, life: 2.6, glyph: 'z', color: SNOOZE })
        a.next = e + 1.7
      }
      return false
    }
    case 'wake': {
      if (a.stage === 0) {
        if (e === 0) mark(w, c, '!', WHITE)
        c.eyes = 'wide'
        if (e > 0.3) nextStage(w, a)
        return false
      }
      c.shape = 'stretch'
      c.arms = 'up'
      return e > 0.45
    }
    case 'alert': {
      if (e === 0) mark(w, c, '!', WHITE)
      c.eyes = 'wide'
      return e > 0.35
    }
    case 'wave': {
      a.dur ??= between(w, 1, 2)
      c.arms = 'wave'
      return e > a.dur
    }
    case 'look': {
      a.dur ??= between(w, 1.5, 2.5)
      c.look = Math.floor(e / 0.45) % 2 ? 1 : -1
      return e > a.dur
    }
    case 'think': {
      a.dur ??= between(w, 1.6, 2.6)
      if (e === 0) mark(w, c, '?', WHITE)
      c.lookUp = true
      c.arms = 'down'
      return e > a.dur
    }
    case 'read': {
      // Holds a scroll in front and looks down at it. onTool stretches dur.
      a.dur ??= 2
      if (isAirborne(c)) return e > a.dur
      c.reading = true
      c.eyes = 'down'
      c.look = 1
      return e > a.dur
    }
    case 'chase': {
      if (a.stage === 0) {
        if (!w.spark) {
          const sx = (c.x < W / 2 ? between(w, 0.6, 0.9) : between(w, 0.1, 0.4)) * W
          w.spark = { x: sx, row: 2, vx: between(w, -8, 8), age: 0, isFleeing: false }
        }
        nextStage(w, a)
      }
      const s = w.spark
      if (!s) return true // caught
      if (e > 10) {
        s.isFleeing = true
        c.queue.unshift(make(w, 'look', { dur: 1.2 }))
        return true
      }
      if (isAirborne(c)) return false
      const gap = s.x - c.x
      if (Math.abs(gap) > 3) {
        c.vx = Math.sign(gap) * RUN * 0.75
        c.look = 1
        c.lookUp = true
      } else {
        c.shape = 'squash'
        jumpUp(w, c, ground(w) - bodyHeight(c) - s.row + 1)
      }
      return false
    }
    case 'peek': {
      if (a.stage === 0) {
        a.to ??= c.x < W / 2 ? -14 : W + 14
        if (isAirborne(c) || !moveTo(c, a.to, RUN)) return false
        nextStage(w, a)
        a.dur = between(w, 1.5, 3)
        return false
      }
      if (a.stage === 1) {
        if (e < (a.dur ?? 2)) return false
        c.x = c.x < 0 ? W + 14 : -14
        a.to = c.x < 0 ? W * 0.12 : W * 0.88
        nextStage(w, a)
        return false
      }
      if (a.stage === 2) {
        if (!moveTo(c, a.to ?? W / 2, WALK)) return false
        nextStage(w, a)
        return false
      }
      c.look = Math.floor(e / 0.4) % 2 ? -1 : 1
      return e > 1
    }
    case 'carry': {
      // Bricks come from just past the right edge, a short run from the pile.
      const pileMid = w.pileAt + 8
      const source = W + 10
      if (a.stage === 0) {
        if (w.pile >= pileCapacity(w)) return true
        if (isAirborne(c) || !moveTo(c, source, RUN)) return false
        nextStage(w, a)
        return false
      }
      if (a.stage === 1) {
        c.shape = 'squash'
        c.arms = 'down'
        if (e < 0.15) return false
        c.carrying = true
        nextStage(w, a)
        return false
      }
      if (a.stage === 2) {
        c.arms = 'down'
        const drop = source > pileMid ? w.pileAt + 16 + 7 : w.pileAt - 7
        if (!moveTo(c, drop, RUN * 0.7)) return false
        c.facing = source > pileMid ? -1 : 1
        nextStage(w, a)
        return false
      }
      c.arms = 'up'
      if (e < 0.2) return false
      c.carrying = false
      if (w.pile < pileCapacity(w)) {
        const spot = brickSpot(w, w.pile)
        w.pile += 1
        if (spot) dust(w, spot.x + 2, spot.row + 1, 2)
      }
      return true
    }
    case 'kick': {
      if (w.pile === 0) return true
      if (a.stage === 0) {
        const side = c.x < w.pileAt + 8 ? w.pileAt - 7 : w.pileAt + 16 + 7
        if (isAirborne(c) || !moveTo(c, side, RUN)) return false
        c.facing = side < w.pileAt ? 1 : -1
        nextStage(w, a)
        return false
      }
      c.shape = 'stretch'
      c.arms = 'up'
      if (e < 0.15) return false
      for (let k = 0; k < w.pile; k++) {
        const spot = brickSpot(w, k)
        if (!spot) continue
        for (const dx of [1, 3]) {
          spawn(w, {
            x: spot.x + dx, row: spot.row, vx: c.facing * between(w, 6, 30), vrow: -between(w, 12, 26),
            fall: 70, life: 1.4, glyph: '▀', color: k % 2 ? BRICK : BRICK_DARK,
          })
        }
      }
      w.pile = 0
      return true
    }
    case 'routine': {
      c.queue.unshift(...stepActs(w, a))
      return true
    }
    case 'pose': {
      // arms, eyes, look and up come from `overlay`.
      if (a.shape) c.shape = a.shape
      if (a.sit) c.sitting = true
      return e > (a.dur ?? 1)
    }
    case 'mark': {
      const glyph = a.glyph ?? '!'
      mark(w, c, glyph, MARKS[glyph] ?? WHITE)
      return true
    }
    case 'sparks': {
      burst(w, c, a.n ?? 4)
      return true
    }
    case 'play': {
      // `stepActs` replaces a play step with the acts it plays.
      return true
    }
    case 'emote': {
      // Emotes are drawn at Clawd's size, so a mini plays none.
      const look = a.emote
      if (!look || c.isMini) return true
      if (isAirborne(c)) return false
      c.shape = 'squash'
      if (look.isTall) w.tallUntil = w.t + TALL_HOLD_S
      if (e < 0.15 || (look.isTall && w.rows < TALL_ROWS && e < 0.3)) return false
      // A tall emote in a terminal too short for the tall band would lose its head.
      if (look.isTall && w.rows < TALL_ROWS) return true
      puff(w, c, look.color)
      wear(w, c, look, a.dur)
      // A routine's emote step goes straight on with the routine.
      if (a.routine) return true
      // Shows itself off, then goes on with whatever comes, still in the look.
      const flags = { isPick: a.isPick, isReflex: a.isReflex }
      c.queue.unshift(
        make(w, 'idle', { dur: 1.2, next: 99, look: 0, ...flags }),
        make(w, 'wave', { dur: 1.2, ...flags }),
        make(w, 'hop', { n: 2, height: 2, ...flags }),
      )
      return true
    }
    case 'leave': {
      a.to ??= c.x < W / 2 ? -12 : W + 12
      if (isAirborne(c) || !moveTo(c, a.to, RUN * 0.8)) return false
      if ('isGone' in c) c.isGone = true
      return true
    }
  }
}

function physics(w: World, c: Body): void {
  const half = c.isMini ? 3 : 6
  if (isAirborne(c)) {
    c.vy -= GRAVITY * DT
    c.y += c.vy * DT
    if (c.y <= 0) {
      c.y = 0
      c.vy = 0
      c.landedAt = w.t
      dust(w, c.x - half, ground(w), 1)
      dust(w, c.x + half, ground(w), 1)
    }
  }
  const before = c.x
  c.x += c.vx * DT
  c.walked += Math.abs(c.x - before)
  c.strides += Math.abs(c.x - before) / (Math.abs(c.vx) >= RUN * 0.7 ? 2 * STRIDE : STRIDE)
  if (c.vx > 0.1) c.facing = 1
  else if (c.vx < -0.1) c.facing = -1
  if (!isAirborne(c) && Math.abs(c.vx) >= RUN * 0.7 && c.walked - c.dustAt > 7) {
    c.dustAt = c.walked
    dust(w, c.x - c.facing * half, ground(w), 1)
  }
}

// --- particles and the spark ------------------------------------------------------

function spawn(w: World, p: Omit<Particle, 'age'>): void {
  w.particles.push({ ...p, age: 0 })
  if (w.particles.length > 60) w.particles.shift()
}

// `!` or `?` above the head, or in front of it when the band has no room above.
function mark(w: World, c: Body, glyph: string, color: number): void {
  const top = ground(w) - Math.round(c.y) - bodyHeight(c)
  const isAbove = top >= 2
  const reach = isAbove ? (c.isMini ? 1 : 3) : c.isMini ? 5 : 9
  spawn(w, {
    x: c.x + c.facing * reach, row: isAbove ? top - 2 : top, vx: 0, vrow: 0, fall: 0, life: 0.9, glyph, color,
  })
}

function dust(w: World, x: number, row: number, n: number): void {
  for (let i = 0; i < n; i++) {
    spawn(w, { x, row: row - 1, vx: between(w, -8, 8), vrow: -between(w, 1, 4), fall: 0, life: 0.35, glyph: '.', color: DUST })
  }
}

function burst(w: World, c: Body, n: number): void {
  const top = ground(w) - Math.round(c.y) - bodyHeight(c) - 2
  const reach = c.isMini ? 5 : 9
  for (let i = 0; i < n; i++) {
    spawn(w, {
      x: c.x + between(w, -reach, reach), row: top + between(w, -1, 2), vx: between(w, -10, 10), vrow: -between(w, 4, 10),
      fall: 6, life: between(w, 0.6, 1.1), glyph: w.rand() < 0.5 ? '*' : '+', color: GOLD,
    })
  }
}

// A puff of smoke as a body takes or drops an emote's look.
function puff(w: World, c: Body, color: number): void {
  puffAt(w, c.x, ground(w) - Math.round(c.y) - bodyHeight(c), bodyHeight(c), 9, color)
}

// A puff `reach` sub-pixels either side of x, over the rows from `top` down `h`.
function puffAt(w: World, x: number, top: number, h: number, reach: number, color: number): void {
  for (let i = 0; i < 6; i++) {
    spawn(w, {
      x: x + between(w, -reach, reach), row: top + between(w, 0, h), vx: between(w, -12, 12), vrow: -between(w, 2, 6),
      fall: 0, life: between(w, 0.4, 0.8), glyph: i % 2 ? 'o' : '*', color: i % 2 ? color : WHITE,
    })
  }
}

// --- an emote's prop ---------------------------------------------------------------

/**
 * Clawd wears its base look (user, 2026-10-07: the MatSci octopus in
 * clawd-matsci) whenever it wears no other, with no puff when the band starts.
 * Another emote takes over for its time, and the base comes back after it. A
 * base the world no longer names goes the way a look's time ends. A tall base
 * keeps the band tall all the time, so the prompt does not move between looks;
 * the base goes on once the band has grown.
 */
function wearBase(w: World): void {
  const base = w.base
  if (w.baseWorn && w.wearing !== w.baseWorn) w.baseWorn = null // another look took over
  if (w.baseWorn && w.baseWorn.name !== base?.name) {
    w.wornUntil = w.t
    w.baseWorn = null
  }
  if (base?.isTall) w.tallUntil = w.t + TALL_HOLD_S
  if (!base || w.wearing || isAirborne(w) || (base.isTall && w.rows < TALL_ROWS)) return
  wear(w, w, base, Infinity)
  w.baseWorn = base
}

/** A body takes on an emote's look for `dur` seconds; its prop starts beside the body, forward as it faces. */
function wear(w: World, c: Body, look: Emote, dur = look.dur): void {
  c.wearing = look
  c.wornAt = w.t
  c.wornUntil = w.t + dur
  const prop = look.prop
  if (!prop) {
    c.propStart = null
    return
  }
  const pw = Math.max(...prop.rows.map(line => line.length))
  // On a cell's first column, so the prop's pixel pairs share cells as drawn.
  c.propStart = { left: 2 * Math.round((c.x + c.facing * prop.x - pw / 2) / 2), dir: c.facing }
}

/** Where a path is `s` seconds in: straight lines between keys, the first key before it starts, the last after it ends. */
function along(path: PropKey[], s: number): { x: number; y: number } {
  let a = path[0] ?? { t: 0, x: 0, y: 0 }
  for (const b of path) {
    if (b.t <= s) {
      a = b
      continue
    }
    const f = s > a.t ? (s - a.t) / (b.t - a.t) : 0
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
  }
  return a
}

/** The box a body's prop fills `s` seconds into the look; `bottom` is its lowest row. */
function propBox(w: World, c: Body, prop: Prop, s = w.t - c.wornAt): { left: number; bottom: number; width: number; height: number } {
  const start = c.propStart ?? { left: 0, dir: 1 }
  const at = along(prop.path, s)
  return {
    left: start.left + 2 * Math.round((start.dir * at.x) / 2),
    bottom: ground(w) - Math.round(at.y),
    width: Math.max(...prop.rows.map(line => line.length)),
    height: prop.rows.length,
  }
}

// Dust as the prop leaves the floor and, with a trail, sparks below it while it rises.
function moveProp(w: World, c: Body, prop: Prop): void {
  const s = w.t - c.wornAt
  const before = along(prop.path, s - DT).y
  const now = along(prop.path, s).y
  if (now <= before) return
  const box = propBox(w, c, prop, s)
  if (Math.round(before) === 0 && Math.round(now) > 0) {
    dust(w, box.left - 1, ground(w), 2)
    dust(w, box.left + box.width, ground(w), 2)
  }
  if (prop.hasTrail && box.bottom >= 0 && w.rand() < 0.6) {
    spawn(w, {
      x: box.left + box.width / 2 + between(w, -1, 1), row: box.bottom + 1, vx: between(w, -3, 3), vrow: between(w, 4, 10),
      fall: 0, life: between(w, 0.3, 0.6), glyph: w.rand() < 0.5 ? '*' : '+', color: GOLD,
    })
  }
}

// The prop's pixels where its path has it now, mirrored the way the body faced as the look started.
function propPixels(w: World, c: Body, look: Emote, prop: Prop): { x: number; row: number; color: number; isAccent: boolean }[] {
  const box = propBox(w, c, prop)
  const top = box.bottom - box.height + 1
  const dir = c.propStart?.dir ?? 1
  const pixels: { x: number; row: number; color: number; isAccent: boolean }[] = []
  prop.rows.forEach((line, r) => {
    for (let col = 0; col < line.length; col++) {
      const ch = line[col]
      if (ch !== '#' && ch !== '+') continue
      const isAccent = ch === '+'
      pixels.push({ x: dir === 1 ? box.left + col : box.left + box.width - 1 - col, row: top + r, color: isAccent ? look.accent : prop.color, isAccent })
    }
  })
  return pixels
}

function drawProp(w: World, c: Body, look: Emote, put: Put): void {
  const prop = look.prop
  if (!prop || !c.propStart) return
  for (const p of propPixels(w, c, look, prop)) put(p.x, p.row, p.color)
}

// Up to 16 of the prop's own pixels, the accent ones first, hop apart and fall, each a quarter
// block on its place in the cell.
function breakProp(w: World, c: Body, look: Emote, prop: Prop): void {
  const pixels = propPixels(w, c, look, prop)
  const plain = pixels.filter(p => !p.isAccent)
  const step = Math.max(1, Math.ceil(plain.length / 16))
  const pieces = [...pixels.filter(p => p.isAccent), ...plain.filter((_, i) => i % step === 0)].slice(0, 16)
  const box = propBox(w, c, prop)
  const middle = box.left + (box.width - 1) / 2
  for (const p of pieces) {
    spawn(w, {
      x: p.x, row: p.row, vx: (p.x - middle) * 4 + between(w, -3, 3), vrow: -between(w, 10, 18),
      fall: 60, life: between(w, 0.5, 0.9), glyph: String.fromCodePoint(QUAD[1 << (2 * (p.row & 1) + (p.x & 1))] ?? 0x2588), color: p.color,
    })
  }
}

function dropBrick(w: World, c: Body): void {
  c.carrying = false
  const top = ground(w) - Math.round(c.y) - bodyHeight(c) - 3
  for (const dx of [-1, 1]) {
    spawn(w, { x: c.x + dx, row: top, vx: c.facing * 10 + dx * 4, vrow: -8, fall: 60, life: 1, glyph: '▀', color: BRICK })
  }
}

function moveParticles(w: World): void {
  const W = width(w)
  const H = w.rows * 2
  w.particles = w.particles.filter(p => {
    p.age += DT
    p.x += p.vx * DT
    p.row += p.vrow * DT
    p.vrow += p.fall * DT
    if (p.glyph === 'z' && p.age > 1.1) p.glyph = 'Z'
    return p.age < p.life && p.x > -2 && p.x < W + 2 && p.row > -3 && p.row < H
  })
}

function moveSpark(w: World): void {
  const s = w.spark
  if (!s) return
  const W = width(w)
  s.age += DT
  if (s.isFleeing) {
    s.row -= 10 * DT
    s.x += s.vx * DT
    if (s.row < -2) w.spark = null
    return
  }
  if (w.rand() < 0.02) s.vx = between(w, -10, 10)
  s.x += s.vx * DT
  if (s.x < 4 || s.x > W - 4) s.vx = -s.vx
  // It floats in the headroom, out of reach unless someone jumps.
  const high = Math.max(0, headroom(w) - 1.5)
  s.row = Math.max(0, Math.min(high, high / 2 + 1.5 * Math.sin(s.age * 2.5)))
  // Caught when it touches a body's outline.
  for (const c of bodies(w)) {
    const feet = ground(w) - Math.round(c.y)
    if (Math.abs(s.x - c.x) <= (c.isMini ? 4 : 7) && s.row >= feet - bodyHeight(c) - 1 && s.row <= feet) {
      w.spark = null
      burst(w, c, 6)
      return
    }
  }
}

// --- drawing -----------------------------------------------------------------

type Put = (x: number, row: number, color: number) => void

function brickSpot(w: World, k: number): { x: number; row: number } | null {
  let left = k
  for (let layer = 0; layer < LAYERS.length; layer++) {
    const count = LAYERS[layer] ?? 0
    const row = ground(w) - 1 - 2 * layer
    if (row < 2 * Math.max(0, w.rows - BAND_ROWS)) return null // never in the tall band's extra row
    if (left < count) return { x: w.pileAt + 2 * layer + 4 * left, row }
    left -= count
  }
  return null
}

function drawPile(w: World, put: Put): void {
  for (let k = 0; k < w.pile; k++) {
    const spot = brickSpot(w, k)
    if (!spot) continue
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 4; dx++) put(spot.x + dx, spot.row + dy, k % 2 ? BRICK : BRICK_DARK)
    }
  }
}

/** The shape a body shows now: the one its act set, else from its motion. */
function shapeNow(w: World, c: Body): Shape {
  if (c.shape) return c.shape
  if (isAirborne(c) && c.vy > 8) return 'stretch'
  if (!isAirborne(c) && w.t - c.landedAt < 0.12) return 'squash'
  return 'normal'
}

// A body in an emote's look. The same motion drives it as Clawd: the shape
// follows the jump, the eyes look and blink, the legs follow the distance
// walked. Wiggly legs sway at the tips while standing, trail straight while
// rising and flare out while falling. Walking and running, a ripple runs from
// the back tentacle to the front one.
function drawWorn(w: World, c: Body, look: Emote, put: Put): void {
  const airborne = isAirborne(c)
  const speed = Math.abs(c.vx)
  const shape = shapeNow(w, c)
  const rows = look.shapes[shape]
  const h = rows.length
  const sw = Math.max(...rows.map(r => r.length))
  const nw = Math.max(...look.shapes.normal.map(r => r.length))
  const nh = look.shapes.normal.length

  let legLen = look.legLength
  if (shape === 'flat' || shape === 'squash' || c.sitting) legLen = 0
  else if (airborne && !look.isWiggly) legLen = c.vy > 0 ? 0 : look.legLength + 1
  legLen = Math.max(0, Math.min(legLen, ground(w) - Math.round(c.y) - h + 1))
  let legs = look.legs.map(x => (nw > 1 ? Math.round((x * (sw - 1)) / (nw - 1)) : x))
  if (!look.isWiggly && !airborne && speed > 0.5) {
    // Clawd's walk: all legs down, the odd ones up, all down, the even ones up.
    const phase = Math.floor(c.walked / 2) % 4
    if (phase === 1) legs = legs.filter((_, k) => k % 2 === 0)
    if (phase === 3) legs = legs.filter((_, k) => k % 2 === 1)
  }
  // A wiggly walk ripples: a wave runs from the back tentacle to the front one, and each
  // tip in turn lifts, reaches forward and slides back. Running, it ripples with longer
  // strides (user, 2026-10-07: the leg animation also when it sprints; the tips trailed
  // until then).
  const crawl = look.isWiggly && !airborne && speed > 0.5 && legLen > 0
  const nLegs = look.legs.length
  const swing = nLegs > 1 ? 1 / nLegs : 0 // the share of a stride a tip is lifted
  // How far leg k is through its stride, 0 to 1. The arms are k = -1 behind and k = nLegs in front.
  const stride = (k: number) => {
    const v = c.strides - k / nLegs
    return v - Math.floor(v)
  }
  const lifted = (k: number) => crawl && stride(k) < swing
  const wave = speed > 0.5 ? c.walked / 2.5 : w.t * 2.5
  const sway = (k: number, side: number): number => {
    if (!look.isWiggly) return 0
    if (airborne) return c.vy > 0 ? 0 : side
    if (crawl) return Math.round(1 - (2 * (stride(k) - swing)) / (1 - swing))
    return Math.round(Math.sin(wave + k * 2.1))
  }

  const feet = ground(w) - Math.round(c.y)
  const top = feet - legLen - h + 1
  const left = Math.round(c.x - sw / 2)
  // Running, the top leans forward; carrying a brick on its head, the body
  // stays upright, since its arms hang low and the lean would leave a notch
  // at the front shoulder (user, 2026-10-07).
  const lean = !airborne && !c.carrying && speed >= RUN * 0.7 ? 1 : 0
  const at = (lx: number, row: number, color: number) =>
    put(c.facing === 1 ? left + lx : left + sw - 1 - lx, top + row, color)

  const eyes = w.t >= c.blinkAt && w.t < c.blinkAt + 0.12 ? 'closed' : c.eyes
  const holes = new Set<string>()
  if (eyes !== 'closed') {
    const eyePixels: [number, number][] = []
    rows.forEach((line, ey) => {
      for (let ex = 0; ex < line.length; ex++) {
        if (line[ex] === 'o') eyePixels.push([ex + Math.max(-1, Math.min(1, c.look)), c.lookUp && ey > 0 ? ey - 1 : ey])
      }
    })
    // Reading, the eyes look down a row, at their size, where the shape has
    // body under them and under that, so an eye never opens into a gap.
    const isBody = (ch: string | undefined) => ch === '#' || ch === 'o' || ch === '+'
    const down = eyes === 'down' && eyePixels.every(([x, y]) => isBody(rows[y + 1]?.[x]) && isBody(rows[y + 2]?.[x]))
    for (const [hx, ey] of eyePixels) {
      const hy = down ? ey + 1 : ey
      holes.add(`${hx},${hy}`)
      if (eyes === 'wide') holes.add(`${hx},${hy > 0 ? hy - 1 : hy + 1}`)
    }
  }
  // The lean moves the rows above the eyes, so it never splits an eye.
  const eyeTop = rows.findIndex(line => line.includes('o'))
  const leanRows = eyeTop > 0 ? eyeTop : h / 2
  rows.forEach((line, r) => {
    const shift = lean && r < leanRows ? 1 : 0
    for (let col = 0; col < line.length; col++) {
      const ch = line[col]
      if (ch === '#' || ch === 'o' || ch === '+') {
        if (!holes.has(`${col},${r}`)) at(col + shift, r, ch === '+' ? look.accent : look.color)
      }
    }
  })

  const ar = look.armRow === null ? h - 2 : nh > 1 ? Math.min(h - 1, Math.round((look.armRow * (h - 1)) / (nh - 1))) : 0
  if (look.armRow !== null) {
    const line = rows[ar] ?? ''
    const first = line.search(/[#o+]/)
    const last = Math.max(line.lastIndexOf('#'), line.lastIndexOf('o'), line.lastIndexOf('+'))
    const flip = Math.floor(w.t * 6) % 2 === 1
    const { up, down, raised } = look.armPoses
    // Wiggly arms curl their tips up now and then. Crawling, each curls for the first half of its stride.
    const lift = (k: number, at: number) => (crawl ? (stride(at) < 0.5 ? 1 : 0) : Math.max(0, sway(k, 0)))
    const curl = (k: number, at: number) => look.armPoses.out.map(([dx, dy], i, all): [number, number] =>
      look.isWiggly && i === all.length - 1 ? [dx, dy - lift(k, at)] : [dx, dy])
    let back = curl(6, -1)
    let front = curl(7, nLegs)
    if (c.arms === 'up') back = front = up
    else if (c.arms === 'down') back = front = down
    else if (c.arms === 'wave') front = flip ? up : raised
    else if (c.arms === 'flail') [back, front] = flip ? [up, down] : [down, up]
    else if (c.arms === 'none') back = front = []
    if (first >= 0) {
      for (const [dx, dy] of back) at(first - dx, ar + dy, look.color)
      for (const [dx, dy] of front) at(last + dx, ar + dy, look.color)
      // The tool's bottom row starts one pixel past the front hand. Reading, that hand holds the scroll.
      const hand = front.at(-1)
      if (look.tool && hand && !c.reading) {
        const tool = look.tool
        const bottom = tool.rows.length - 1
        const grip = (tool.rows[bottom] ?? '').search(/[#+]/)
        tool.rows.forEach((line, r) => {
          for (let col = 0; col < line.length; col++) {
            const ch = line[col]
            if (ch === '#' || ch === '+') at(last + hand[0] + 1 + col - grip, ar + hand[1] + r - bottom, ch === '+' ? look.accent : tool.color)
          }
        })
      }
    }
  }

  legs.forEach((lx, k) => {
    const side = lx < sw / 2 ? -1 : 1
    const len = lifted(k) ? legLen - 1 : legLen // a lifted tip is not drawn
    for (let r = 1; r <= len; r++) at(lx + (r === legLen ? sway(k, side) : 0), h - 1 + r, look.color)
  })

  if (c.reading) {
    const line = rows[ar] ?? ''
    const last = Math.max(line.lastIndexOf('#'), line.lastIndexOf('o'), line.lastIndexOf('+'))
    const reach = Math.max(1, ...look.armPoses.out.map(([dx]) => dx))
    drawScroll(c, left, sw, (last >= 0 ? last : sw - 1) + reach, [ar - 2, ar - 1, ar, ar + 1], at)
  }

  if (w.antenna && !c.isMini) {
    const mount = antennaMount(rows, top + Math.round(c.y))
    if (mount) {
      const lx = mount.x + (lean && mount.row < leanRows ? 1 : 0)
      drawAntenna(w, c, c.facing === 1 ? left + lx : left + sw - 1 - lx, top + mount.row, put)
    }
  }

  if (c.carrying) {
    const bx = Math.round(sw / 2) - 2
    for (let dy = -2; dy < 0; dy++) for (let dx = 0; dx < 4; dx++) at(bx + dx, dy, BRICK)
  }
}

function drawBody(w: World, c: Body, put: Put): void {
  if (c.wearing) return drawWorn(w, c, c.wearing, put)
  const airborne = isAirborne(c)
  const speed = Math.abs(c.vx)
  let shape: Shape = c.shape ?? 'normal'
  if (!c.shape) {
    if (airborne && c.vy > 8) shape = 'stretch'
    else if (!airborne && w.t - c.landedAt < 0.12) shape = 'squash'
  }
  const s = (c.isMini ? MINI_SHAPES : SHAPES)[shape]

  // Legs, in local x (forward = +x), and how long they are.
  let legs = c.isMini ? [1, s.w - 2] : [1, 3, s.w - 4, s.w - 2]
  let legLen = 1
  if (shape === 'flat' || shape === 'squash' || c.sitting) legLen = 0
  // Falling legs are long, but never so long that the head leaves the band.
  else if (airborne) legLen = c.vy > 0 ? 0 : Math.max(0, Math.min(c.isMini ? 1 : 2, ground(w) - Math.round(c.y) - s.h + 1))
  else if (speed >= RUN * 0.7) {
    const phase = Math.floor(c.walked / 3) % 2
    if (c.isMini) legs = phase ? [0, s.w - 3] : [2, s.w - 1]
    else legs = phase ? [0, 2, s.w - 3, s.w - 1] : [2, 4, s.w - 5, s.w - 3]
  } else if (speed > 0.5) {
    const phase = Math.floor(c.walked / 2) % 4
    if (c.isMini) {
      if (phase === 1) legs = [legs[0] ?? 1]
      if (phase === 3) legs = [legs[1] ?? 4]
    } else {
      if (phase === 1) legs = [legs[1] ?? 3, legs[3] ?? 10]
      if (phase === 3) legs = [legs[0] ?? 1, legs[2] ?? 8]
    }
  }

  const feet = ground(w) - Math.round(c.y)
  const bottom = feet - legLen
  const top = bottom - s.h + 1
  const left = Math.round(c.x - s.w / 2)
  // Running, the top leans forward; carrying a brick on its head, the body
  // stays upright, since its arms hang low and the lean would leave a notch
  // at the front shoulder (user, 2026-10-07).
  const lean = !airborne && !c.carrying && speed >= RUN * 0.7 ? 1 : 0
  const at = (lx: number, row: number, color: number) =>
    put(c.facing === 1 ? left + lx : left + s.w - 1 - lx, top + row, color)

  // Eye holes.
  const eyes = w.t >= c.blinkAt && w.t < c.blinkAt + 0.12 ? 'closed' : c.eyes
  const holes = new Set<string>()
  if (eyes !== 'closed') {
    // Reading, the eyes look down a row where a row of body stays under them.
    const isDown = eyes === 'down' && s.eyeRow + 2 < s.h
    for (const ex of s.eyes) {
      const hx = ex + Math.max(-1, Math.min(1, c.look))
      const hy = c.lookUp && s.eyeRow > 0 ? s.eyeRow - 1 : isDown ? s.eyeRow + 1 : s.eyeRow
      holes.add(`${hx},${hy}`)
      if (eyes === 'wide') holes.add(`${hx},${hy > 0 ? hy - 1 : hy + 1}`)
    }
  }
  for (let r = 0; r < s.h; r++) {
    const shift = lean && r < s.h / 2 ? 1 : 0
    for (let col = 0; col < s.w; col++) {
      if (!holes.has(`${col},${r}`)) at(col + shift, r, c.color)
    }
  }

  // Arms: [dx, dy] from the body's edge on the arm row, back arm then front arm.
  const flip = Math.floor(w.t * 6) % 2 === 1
  const OUT: [number, number][] = c.isMini ? [[1, 0]] : [[1, 0], [2, 0]]
  const UP: [number, number][] = c.isMini ? [[1, -1]] : [[1, -1], [2, -2]]
  const DOWN: [number, number][] = [[1, 1]]
  const RAISED: [number, number][] = c.isMini ? [[1, 0]] : [[1, -1], [1, -2]]
  let back: [number, number][] = OUT
  let front: [number, number][] = OUT
  if (c.arms === 'up') back = front = UP
  else if (c.arms === 'down') back = front = DOWN
  else if (c.arms === 'wave') front = flip ? UP : RAISED
  else if (c.arms === 'flail') [back, front] = flip ? [UP, DOWN] : [DOWN, UP]
  else if (c.arms === 'none') back = front = []
  for (const [dx, dy] of back) at(-dx, s.armRow + dy, c.color)
  for (const [dx, dy] of front) at(s.w - 1 + dx, s.armRow + dy, c.color)
  if (c.reading) {
    const rows = c.isMini ? [s.armRow - 2, s.armRow - 1, s.armRow] : [s.armRow - 2, s.armRow - 1, s.armRow, s.armRow + 1]
    drawScroll(c, left, s.w, s.w - 1 + OUT.length, rows, at)
  }

  for (const lx of legs) {
    for (let r = 1; r <= legLen; r++) at(lx, s.h - 1 + r, c.color)
  }

  if (w.antenna && !c.isMini) {
    const ax = lean // the back edge of the top row, which leans with the run
    drawAntenna(w, c, c.facing === 1 ? left + ax : left + s.w - 1 - ax, top, put)
  }

  if (c.carrying) {
    const bx = Math.round(s.w / 2) - 2
    for (let dy = -2; dy < 0; dy++) for (let dx = 0; dx < 4; dx++) at(bx + dx, dy, BRICK)
  }
}

/**
 * The scroll a reading body holds in front, from local x `from` (the arm's
 * tip) on: two sub-pixels wide, rolled at the first and last row. It starts
 * on a cell's first column, so its two colours never share a cell with the arm.
 */
function drawScroll(c: Body, left: number, width: number, from: number, rows: number[], at: Put): void {
  const screen = (lx: number) => (c.facing === 1 ? left + lx : left + width - 1 - lx)
  const lx = Math.min(screen(from), screen(from + 1)) % 2 === 0 ? from : from + 1
  rows.forEach((row, k) => {
    const color = k === 0 || k === rows.length - 1 ? ROLL : PAPER
    at(lx, row, color)
    at(lx + 1, row, color)
  })
}

/**
 * Where the antenna stands on a look: on the back edge of the part that holds
 * the eyes (pixels 8-connected to an `o`, or all pixels when it has none), so
 * not on a tentacle or a mark beside the head. On the part's top row, or, on a
 * round head, as far down its back edge as the whole antenna needs to fit in
 * the band (user, 2026-10-08, after a sheet of placements on the real emotes).
 * `restTop` is the look's top row with Clawd on the ground, so the mount does
 * not slide during a hop. Local x from the back, and the row in the look.
 */
function antennaMount(rows: string[], restTop: number): { x: number; row: number } | null {
  const isPixel = (ch: string | undefined) => ch === '#' || ch === 'o' || ch === '+'
  const part = new Set<string>()
  const todo: [number, number][] = []
  rows.forEach((line, r) => [...line].forEach((ch, x) => ch === 'o' && todo.push([x, r])))
  if (todo.length === 0) rows.forEach((line, r) => [...line].forEach((ch, x) => isPixel(ch) && part.add(`${x},${r}`)))
  for (const [x, r] of todo) part.add(`${x},${r}`)
  while (todo.length > 0) {
    const [x, r] = todo.pop() as [number, number]
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const key = `${x + dx},${r + dy}`
        if (!part.has(key) && isPixel(rows[r + dy]?.[x + dx])) {
          part.add(key)
          todo.push([x + dx, r + dy])
        }
      }
    }
  }
  let first: { x: number; row: number } | null = null
  for (let row = 0; row < rows.length; row++) {
    const x = [...(rows[row] ?? '')].findIndex((_, col) => part.has(`${col},${row}`))
    if (x < 0) continue
    first ??= { x, row }
    if (antennaTip(restTop + row) >= 0) return { x, row }
  }
  return first
}

/** The row of the antenna's tip over a head whose top row is `top`: alone in the lower half of a cell. */
function antennaTip(top: number): number {
  return top - 3 - (((top % 2) + 2) % 2)
}

/**
 * The antenna Clawd wears while Remote Control is on: a gray stalk from the
 * head pixel at screen column x, whose top is row `top`, leaning back a pixel
 * per row, with a green tip that blinks (user, 2026-10-08: gray, a coloured tip,
 * "at an angle, not that static straight up"). A cell shows two colours, so the
 * tip sits alone in the lower half of a cell: the stalk is two pixels high, or
 * three where the head's top row is the lower half of a cell. The tip needs the
 * band's second row of headroom, so the band stays 5 rows high while the
 * antenna is on, and 6 while Clawd wears a tall look (`bandRows`).
 */
function drawAntenna(w: World, c: Body, x: number, top: number, put: Put): void {
  const tip = antennaTip(top)
  const at = (row: number) => x - c.facing * (top - 1 - row)
  for (let row = top - 1; row > tip; row--) put(at(row), row, ANTENNA)
  put(at(tip), tip, w.t % 1.6 < 1.4 ? SIGNAL : SIGNAL_DIM)
}

/** The band as Raster cells: standard base64 of [codePoint, fg, bg] u32 triplets. */
export function frameCells(w: World): string {
  const W = w.cols * 2
  const H = w.rows * 2
  const px = new Int32Array(W * H).fill(EMPTY)
  const put: Put = (x, row, color) => {
    const ix = Math.round(x)
    if (ix >= 0 && ix < W && row >= 0 && row < H) px[row * W + ix] = color
  }
  drawPile(w, put)
  for (const b of bodies(w)) if (b.wearing?.prop) drawProp(w, b, b.wearing, put)
  for (const m of w.minis) drawBody(w, m, put)
  drawBody(w, w, put)

  const glyphs = new Map<number, Particle>()
  for (const p of w.particles) glyphs.set(Math.floor(p.row / 2) * w.cols + Math.floor(p.x / 2), p)
  if (w.spark) {
    const s = w.spark
    const twinkle = Math.floor(s.age * 4) % 2 ? '+' : '*'
    glyphs.set(Math.floor(s.row / 2) * w.cols + Math.floor(s.x / 2), { ...s, vrow: 0, fall: 0, life: 1, glyph: twinkle, color: GOLD })
  }

  // The label on the top row, right-aligned, clear of the last LABEL_SPARE
  // cells: the engine draws the band's `[-]` there. The bodies pass in front
  // of it; it covers the pile, particles and the sparkle.
  const room = Math.max(0, w.cols - LABEL_SPARE - 1)
  let label = w.label.flatMap(p => [...p.text].map(ch => ({ ch, color: p.color })))
  if (label.length > room) label = [...label.slice(0, Math.max(0, room - 3)), ...[...'...'].map(ch => ({ ch, color: LABEL }))]
  const labelFrom = w.cols - LABEL_SPARE - label.length

  // While /clawd is typed, the floor row is the top edge of the menu the band
  // draws below it: `╭─ title ───╮`. Any pixel stands in front of the edge's
  // corners and title; they cover particles and the sparkle.
  const edge = new Map<number, { ch: string; color: number }>()
  if (w.edge) {
    const room = Math.max(0, w.cols - 6)
    let title = w.edge.flatMap(p => [...p.text].map(ch => ({ ch, color: p.color })))
    if (title.length > room) title = [...title.slice(0, Math.max(0, room - 3)), ...[...'...'].map(ch => ({ ch, color: LABEL }))]
    const rule = (ch: string) => ({ ch, color: FLOOR })
    const marks = [rule('╭'), rule('─'), rule(' '), ...title, ...(title.length > 0 ? [rule(' ')] : [])]
    marks.forEach((m, cx) => edge.set(cx, m))
    edge.set(w.cols - 1, rule('╮'))
  }

  // An emote's colours, its prop's, its tool's, the scroll and the antenna count as a body's; Clawd's own colour, whatever it is now, comes first.
  const bodyColors = new Set([...BODY_COLORS, PAPER, ROLL, ANTENNA, SIGNAL, SIGNAL_DIM])
  for (const b of bodies(w)) {
    if (b.wearing) bodyColors.add(b.wearing.color).add(b.wearing.accent)
    if (b.wearing?.prop) bodyColors.add(b.wearing.prop.color)
    if (b.wearing?.tool) bodyColors.add(b.wearing.tool.color)
  }
  const main = w.wearing?.color ?? ORANGE

  const words = new Uint32Array(w.cols * w.rows * 3)
  for (let cy = 0; cy < w.rows; cy++) {
    for (let cx = 0; cx < w.cols; cx++) {
      const i = (cy * w.cols + cx) * 3
      const base = 2 * cy * W + 2 * cx
      const quad = [px[base] ?? EMPTY, px[base + 1] ?? EMPTY, px[base + W] ?? EMPTY, px[base + W + 1] ?? EMPTY]
      const lc = cy === 0 && cx >= labelFrom ? label[cx - labelFrom] : undefined
      if (lc !== undefined && !quad.some(c => bodyColors.has(c))) {
        words[i] = lc.ch.codePointAt(0) ?? 0x20
        words[i + 1] = lc.color
        words[i + 2] = DEFAULT
        continue
      }
      const ec = cy === w.rows - 1 ? edge.get(cx) : undefined
      if (ec !== undefined && quad.every(c => c === EMPTY)) {
        words[i] = ec.ch.codePointAt(0) ?? 0x20
        words[i + 1] = ec.color
        words[i + 2] = DEFAULT
        continue
      }
      if (quad.every(c => c === EMPTY)) {
        const p = glyphs.get(cy * w.cols + cx)
        const isFloor = !p && cy === w.rows - 1
        words[i] = p ? (p.glyph.codePointAt(0) ?? 0x20) : isFloor ? 0x2500 : 0x20
        words[i + 1] = p ? p.color : isFloor ? FLOOR : DEFAULT
        words[i + 2] = DEFAULT
        continue
      }
      // A body wins the foreground, Clawd first; the rest of the cell becomes the background.
      const fg = quad.includes(main) ? main : (quad.find(c => bodyColors.has(c)) ?? quad.find(c => c !== EMPTY) ?? main)
      let mask = 0
      const rest: number[] = []
      quad.forEach((c, bit) => {
        if (c === fg) mask |= 1 << bit
        else rest.push(c)
      })
      const filled = rest.filter(c => c !== EMPTY)
      words[i] = QUAD[mask] ?? 0x2588
      words[i + 1] = fg
      words[i + 2] = filled.length * 2 >= rest.length && filled[0] !== undefined ? filled[0] : DEFAULT
    }
  }
  return (new Uint8Array(words.buffer) as Uint8Array & { toBase64(): string }).toBase64()
}

// --- the preview -----------------------------------------------------------------

// An emote's preview is a sheet of panels, each the band as a terminal shows
// it, with the body held in one pose. The panels go through the real drawing,
// frameCells included, so what the preview shows is what the band will show.
const POSES: [string, (w: World) => void][] = [
  ['standing', () => {}],
  ['standing, 0.4 s later', w => { w.t += 0.4 }],
  ['standing, 0.8 s later', w => { w.t += 0.8 }],
  ['blinking', w => { w.eyes = 'closed' }],
  ['looking back', w => { w.look = -1 }],
  ['looking up', w => { w.lookUp = true }],
  ['eyes wide', w => { w.eyes = 'wide' }],
  ['walking', w => { w.vx = WALK; w.walked = 2 }],
  ['walking, a step on', w => { w.vx = WALK; w.walked = 6 }],
  ['running', w => { w.vx = RUN; w.walked = 3 }],
  ['landing (squash)', w => { w.landedAt = w.t }],
  ['rising in a jump (stretch)', w => { w.y = 2; w.vy = 20 }],
  ['falling', w => { w.y = 2; w.vy = -10 }],
  ['lying flat after a trip', w => { w.shape = 'flat'; w.arms = 'none'; w.eyes = 'closed' }],
  ['arms up', w => { w.arms = 'up' }],
  ['waving', w => { w.arms = 'wave' }],
  ['asleep, sitting', w => { w.sitting = true; w.eyes = 'closed'; w.arms = 'down' }],
  ['carrying a brick', w => { w.carrying = true; w.arms = 'down' }],
]
/** What the preview's panels show, left to right, then line by line. */
export const PREVIEW_POSES = POSES.map(([label]) => label)
export const PREVIEW_PER_LINE = 6
// An emote with a prop gets one more line: the prop a quarter, half,
// three quarters and all of its path's time in.
const PROP_POSES: [string, (w: World) => void][] = [1, 2, 3, 4].map(k => [
  k === 4 ? 'the prop at the end of its path' : `the prop ${['', 'a quarter', 'half', 'three quarters'][k]} of its path's time in`,
  w => {
    w.t += (k / 4) * (w.wearing?.prop?.path.at(-1)?.t ?? 0)
  },
])
/** What the extra line of an emote with a prop shows, left to right. */
export const PREVIEW_PROP_POSES = PROP_POSES.map(([label]) => label)
// A drafts sheet shows each draft in five poses, one line per draft.
const SHEET = POSES.filter(([label]) => ['standing', 'walking', 'rising in a jump (stretch)', 'lying flat after a trip', 'waving'].includes(label))
/** What each line of a drafts sheet shows, left to right. */
export const SHEET_POSES = SHEET.map(([label]) => label)
const PREVIEW_COLS = 14
const CELL_W = 10 // pixels; a terminal cell is about twice as high as wide
const CELL_H = 20
const GAP = 4
const SCREEN = 0x1e1f22 // the terminal's background
const GAP_COLOR = 0x3a3b40

const NUMBER_W = 20 // the left margin of a drafts sheet, for each line's number
// The digits 1 to 9, 3 x 5 pixels each, row by row.
const DIGITS = [
  '.#.##..#..#.###', '##...#.#.#..###', '##...#.#...###.', '#.##.####..#..#', '####..##...###.',
  '.###..####.####', '###..#.#..#..#.', '####.#####.####', '####.####..###.',
]

/** The preview of an emote: a PNG of the band in every pose of PREVIEW_POSES, then PREVIEW_PROP_POSES if it has a prop. */
export function emotePreview(look: Emote): Uint8Array {
  const poses = look.prop ? [...POSES, ...PROP_POSES] : POSES
  return sheet(poses.map(([, set]) => ({ look, set })), PREVIEW_PER_LINE, 0)
}

/**
 * Drafts of an emote side by side: a PNG with one line per draft, in the poses
 * of SHEET_POSES, and the draft's number at the left of its line.
 */
export function emoteSheet(looks: Emote[]): Uint8Array {
  return sheet(looks.flatMap(look => SHEET.map(([, set]) => ({ look, set }))), SHEET.length, NUMBER_W)
}

// Where Clawd stands in a panel: in the middle, or with a prop off the middle,
// so that Clawd, its arms and the prop at its start are centred together.
function previewX(look: Emote): number {
  const prop = look.prop
  if (!prop) return PREVIEW_COLS
  const half = Math.max(...look.shapes.normal.map(line => line.length)) / 2 + 2
  const pw = Math.max(...prop.rows.map(line => line.length))
  const lo = Math.min(-half, prop.x - pw / 2)
  const hi = Math.max(half, prop.x + pw / 2)
  return Math.round(PREVIEW_COLS - (lo + hi) / 2)
}

// A PNG of panels, perLine to a line, each the band with Clawd in a look and
// held in a pose. A margin of `numbers` pixels gets each line's number.
function sheet(panels: { look: Emote; set: (w: World) => void }[], perLine: number, numbers: number): Uint8Array {
  const rows = TALL_ROWS
  const panelW = PREVIEW_COLS * CELL_W
  const panelH = rows * CELL_H
  const lines = Math.ceil(panels.length / perLine)
  const width = numbers + perLine * (panelW + GAP) + GAP
  const height = lines * (panelH + GAP) + GAP
  const palette = new Map<number, number>()
  const ink = (color: number) => {
    const rgb = color === DEFAULT ? SCREEN : color & 0xffffff
    let i = palette.get(rgb)
    if (i === undefined) {
      i = palette.size
      palette.set(rgb, i)
    }
    return i
  }
  const image = new Uint8Array(width * height).fill(ink(GAP_COLOR))
  const fill = (x: number, y: number, w: number, h: number, color: number) => {
    const i = ink(color)
    for (let yy = y; yy < y + h; yy++) image.fill(i, yy * width + x, yy * width + x + w)
  }
  const masks = new Map(QUAD.map((cp, mask) => [cp, mask]))
  panels.forEach(({ look, set }, k) => {
    const w = createWorld(PREVIEW_COLS, rows, seeded(1))
    w.queue = []
    Object.assign(w, { x: previewX(look), t: 5, blinkAt: 999 })
    wear(w, w, look)
    w.wornUntil = Infinity
    set(w)
    const bytes = (Uint8Array as unknown as { fromBase64(s: string): Uint8Array }).fromBase64(frameCells(w))
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const ox = numbers + GAP + (k % perLine) * (panelW + GAP)
    const oy = GAP + Math.floor(k / perLine) * (panelH + GAP)
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < PREVIEW_COLS; cx++) {
        const i = (cy * PREVIEW_COLS + cx) * 12
        const glyph = view.getUint32(i, true)
        const fg = view.getUint32(i + 4, true)
        const bg = view.getUint32(i + 8, true)
        const x = ox + cx * CELL_W
        const y = oy + cy * CELL_H
        const mask = masks.get(glyph)
        if (mask !== undefined) {
          for (let q = 0; q < 4; q++) {
            fill(x + (q % 2) * (CELL_W / 2), y + Math.floor(q / 2) * (CELL_H / 2), CELL_W / 2, CELL_H / 2, mask & (1 << q) ? fg : bg)
          }
          continue
        }
        fill(x, y, CELL_W, CELL_H, bg)
        if (glyph === 0x2500) fill(x, y + CELL_H / 2 - 1, CELL_W, 2, fg) // the floor line
        else if (glyph !== 0x20) fill(x + CELL_W / 2 - 2, y + CELL_H / 2 - 2, 4, 4, fg) // a particle
      }
    }
  })
  // Each number in pixels of 4 x 4, centred left of its line.
  if (numbers > 0) {
    for (let line = 0; line < lines; line++) {
      const digit = DIGITS[line] ?? ''
      const oy = GAP + line * (panelH + GAP) + (panelH - 20) / 2
      for (let i = 0; i < digit.length; i++) {
        if (digit[i] === '#') fill((numbers + GAP - 12) / 2 + (i % 3) * 4, oy + Math.floor(i / 3) * 4, 4, 4, 0xd8d8d8)
      }
    }
  }
  return png(width, height, image, [...palette.keys()])
}

// A palette PNG, its pixel data in stored (uncompressed) deflate blocks: the
// mod has no zlib, and a few hundred kilobytes do no harm.
function png(width: number, height: number, image: Uint8Array, palette: number[]): Uint8Array {
  const raw = new Uint8Array(height * (width + 1))
  for (let y = 0; y < height; y++) raw.set(image.subarray(y * width, (y + 1) * width), y * (width + 1) + 1)
  const blocks = Math.max(1, Math.ceil(raw.length / 65535))
  const z = new Uint8Array(2 + raw.length + 5 * blocks + 4)
  z[0] = 0x78
  z[1] = 0x01
  let at = 2
  for (let b = 0; b < blocks; b++) {
    const part = raw.subarray(b * 65535, (b + 1) * 65535)
    z[at] = b === blocks - 1 ? 1 : 0
    z[at + 1] = part.length & 0xff
    z[at + 2] = part.length >> 8
    z[at + 3] = ~part.length & 0xff
    z[at + 4] = (~part.length >> 8) & 0xff
    z.set(part, at + 5)
    at += 5 + part.length
  }
  let s1 = 1
  let s2 = 0
  for (const byte of raw) {
    s1 = (s1 + byte) % 65521
    s2 = (s2 + s1) % 65521
  }
  new DataView(z.buffer).setUint32(at, ((s2 << 16) | s1) >>> 0)
  const header = new Uint8Array(13)
  const hv = new DataView(header.buffer)
  hv.setUint32(0, width)
  hv.setUint32(4, height)
  header.set([8, 3, 0, 0, 0], 8) // 8 bits, palette, deflate, no filter, no interlace
  const plte = new Uint8Array(palette.flatMap(c => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]))
  const chunks = [chunk('IHDR', header), chunk('PLTE', plte), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(8 + chunks.reduce((sum, c) => sum + c.length, 0))
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  let pos = 8
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.length
  }
  return out
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  let crc = 0xffffffff
  for (const byte of out.subarray(4, 8 + data.length)) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0)
  return out
}
