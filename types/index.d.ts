export type Spin = {
  id: number
  reels: string[]
  payout: number
  label: string
  subject: string
  isClean: boolean
}

export type Bank = {
  coins: number
  spins: number
  jackpots: number
  streak: number
  bestStreak: number
  ciWins: number
  ciLosses: number
}

export type Ci = {
  sha: string
  status: 'watching' | 'won' | 'lost' | 'none'
  detail: string
}

declare module 'claude-code' {
  interface PluginState {
    'git-casino': {
      reels: string[]
      pending: { id: number; reels: string[] } | null
      isSpinning: boolean
      last: Spin | null
      bank: Bank
      fails: number
      muted: boolean
      isConfirmingReset: boolean
      ci: Ci | null
    }
  }
}
