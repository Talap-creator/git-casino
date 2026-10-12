import type { Bank } from '../types'

export const SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣'] as const
const WEIGHTS = [30, 25, 20, 13, 8, 4]
const TOTAL = WEIGHTS.reduce((sum, w) => sum + w, 0)

export const EMPTY_BANK: Bank = {
  coins: 100,
  spins: 0,
  jackpots: 0,
  streak: 0,
  bestStreak: 0,
  ciWins: 0,
  ciLosses: 0,
}

export const CI_BONUS = 300
export const CI_PENALTY = 50

export function pick(rand: () => number): string {
  let roll = rand() * TOTAL
  for (let i = 0; i < SYMBOLS.length; i++) {
    roll -= WEIGHTS[i] ?? 0
    if (roll < 0) return SYMBOLS[i] ?? SYMBOLS[0]
  }
  return SYMBOLS[0]
}

export function roll(rand: () => number): string[] {
  return [pick(rand), pick(rand), pick(rand)]
}

export function score(reels: readonly string[], isClean: boolean): { payout: number; label: string; isJackpot: boolean } {
  const [a, b, c] = reels
  let payout: number
  let label: string
  const isJackpot = a === b && b === c

  if (isJackpot) {
    payout = a === '7️⃣' ? 1000 : a === '💎' ? 500 : 200
    label = a === '7️⃣' ? 'MEGA JACKPOT' : 'JACKPOT'
  } else if (a === b || b === c || a === c) {
    payout = 30
    label = 'Пара'
  } else {
    payout = -10
    label = 'Мимо'
  }

  if (isClean && payout > 0) payout *= 2

  return { payout, label, isJackpot }
}

export function isCommit(command: string): boolean {
  return /\bgit\b(?:\s+-C\s+\S+)?\s+commit\b/.test(command) && !/--dry-run/.test(command)
}

export function isPush(command: string): boolean {
  return /\bgit\b(?:\s+-C\s+\S+)?\s+push\b/.test(command) && !/--dry-run/.test(command)
}

function unquote(s: string): string {
  return s.replace(/^["']|["']$/g, '')
}

// Git Bash spells C:\x as /c/x; host processes want the native form.
export function toNativePath(p: string): string {
  const m = /^\/([a-zA-Z])\/(.*)$/.exec(p)
  return m?.[1] !== undefined ? `${m[1].toUpperCase()}:/${m[2] ?? ''}` : p
}

// The repo a command ran in: `git -C <dir>`, or a leading `cd <dir> &&`.
export function repoDir(command: string): string | undefined {
  const gitC = /\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/.exec(command)
  if (gitC?.[1] !== undefined) return toNativePath(unquote(gitC[1]))
  const cd = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)/.exec(command)
  if (cd?.[1] !== undefined) return toNativePath(unquote(cd[1]))
  return undefined
}
