import { describe, expect, test } from 'claude-code/testing'

import { isCommit, isPush, repoDir, roll, score } from './lib'

describe('git-casino lib', () => {
  test('spots commits and pushes', async () => {
    expect(isCommit('git add . && git commit -m "x"')).toBe(true)
    expect(isCommit('git -C repo commit -am x')).toBe(true)
    expect(isCommit('git commit --dry-run')).toBe(false)
    expect(isCommit('git status')).toBe(false)
    expect(isPush('git push origin main')).toBe(true)
    expect(isPush('git pull')).toBe(false)
  })

  test('finds the repo dir', async () => {
    expect(repoDir('cd /c/Users/me/proj && git commit -m x')).toBe('C:/Users/me/proj')
    expect(repoDir('git -C "my repo" push')).toBe('my repo')
    expect(repoDir('git commit -m x')).toBe(undefined)
  })

  test('scores reels', async () => {
    expect(score(['7️⃣', '7️⃣', '7️⃣'], false).payout).toBe(1000)
    expect(score(['🍒', '🍒', '🍒'], true).payout).toBe(400)
    expect(score(['🍒', '🍋', '🍒'], false).payout).toBe(30)
    expect(score(['🍒', '🍋', '🔔'], true).payout).toBe(-10)
  })

  test('rolls three symbols', async () => {
    expect(roll(() => 0)).toEqual(['🍒', '🍒', '🍒'])
    expect(roll(() => 0.999).length).toBe(3)
  })
})
