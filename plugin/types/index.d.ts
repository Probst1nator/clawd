/** Clawd's band state, as kept in $.state. */
export type ClawdState = {
  isClawdOn: boolean
  isClawdTall: boolean
  isTracing: boolean
  isDebugging: boolean
  clawdMenu: {
    title: string
    note: string
    rows: { name: string; what: string; from: number; to: number }[]
    isOne: boolean
    count: string
    next: string
  } | null
}

declare module 'claude-code' {
  interface PluginState {
    'clawd': {
      /** Clawd, the logo, running in the band above the prompt (/clawd on|off). */
      isClawdOn: boolean
      /** Clawd's band is a row taller during a big jump. */
      isClawdTall: boolean
      /** Each pick goes to picks/<session id>.jsonl in the data folder (/clawd trace [off]). */
      isTracing: boolean
      /** Each pick's whole reply, tokens and outcome go to the transcript (/clawd debug [on|off]). */
      isDebugging: boolean
      /** The framed list above the prompt while a /clawd command is typed (clawd-words.ts `Menu`); null otherwise. */
      clawdMenu: {
        title: string
        note: string
        rows: { name: string; what: string; from: number; to: number }[]
        isOne: boolean
        count: string
        next: string
      } | null
    }
  }
}
