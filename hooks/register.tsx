import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Bank, Ci, Spin } from '../types'
import { CI_BONUS, CI_PENALTY, EMPTY_BANK, SYMBOLS, isCommit, isPush, repoDir, roll, score } from './lib'
import { REEL_SECONDS, slotSvg } from './svg'
import type { Mode } from './svg'

const PANE = 'git-casino'
const TITLE = '🎰 Git Casino'

const REELS = { plugin: 'git-casino', key: 'reels' } as const
const PENDING = { plugin: 'git-casino', key: 'pending' } as const
const SPINNING = { plugin: 'git-casino', key: 'isSpinning' } as const
const LAST = { plugin: 'git-casino', key: 'last' } as const
const BANK = { plugin: 'git-casino', key: 'bank' } as const
const FAILS = { plugin: 'git-casino', key: 'fails' } as const
const MUTED = { plugin: 'git-casino', key: 'muted' } as const
const CONFIRM_RESET = { plugin: 'git-casino', key: 'isConfirmingReset' } as const
const CI = { plugin: 'git-casino', key: 'ci' } as const

type CiRun = { status: string; conclusion: string; attempt: number; name: string }

let ciTimer: Timer | undefined
// The trigger file the resident player watches; unset until it reports ready.
let playerFile: string | undefined

const isWindows = (root: string) => /^[A-Za-z]:[\\/]/.test(root)
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`

// The engine's own player is macOS-only. On Windows a fresh PowerShell costs ~600 ms
// before the first sample, so one resident PowerShell preloads every clip and plays
// whatever name lands in its trigger file, within ~15 ms. It exits with its parent.
function startPlayer($: EngineInterface) {
  const root = $.plugin.root
  if (!isWindows(root)) return
  const script = [
    `$ErrorActionPreference = 'SilentlyContinue'`,
    `$players = @{}`,
    `Get-ChildItem ${psQuote(`${root}/sounds`)} -Filter *.wav | ForEach-Object { $p = New-Object Media.SoundPlayer $_.FullName; $p.Load(); $players[$_.BaseName] = $p }`,
    `$parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId`,
    `$t = Join-Path ([IO.Path]::GetTempPath()) ("git-casino-" + $PID + ".txt")`,
    `[Console]::Out.WriteLine("READY " + $t); [Console]::Out.Flush()`,
    `$n = 0`,
    `while ($true) {`,
    `  if (Test-Path -LiteralPath $t) { $name = (Get-Content -LiteralPath $t -Raw).Trim(); Remove-Item -LiteralPath $t -Force; if ($players.ContainsKey($name)) { $players[$name].Play() } }`,
    `  Start-Sleep -Milliseconds 15`,
    `  $n++; if ($n % 130 -eq 0 -and -not (Get-Process -Id $parent)) { break }`,
    `}`,
  ].join('\n')

  void (async () => {
    try {
      const child = $.process.spawn({ argv: ['powershell', '-NoProfile', '-NonInteractive', '-Command', script] })
      for await (const { text } of child) {
        const ready = /READY (.+)/.exec(text)
        if (ready?.[1] !== undefined) playerFile = ready[1].trim()
      }
    } catch {
      // no resident player: play() falls back to a PowerShell per clip
    }
    playerFile = undefined
  })()
}

async function play($: EngineInterface, name: string) {
  if ((await $.state.get(MUTED)).value === true) return
  const root = $.plugin.root
  if (!isWindows(root)) {
    await $.audio.play({ asset: `sounds/${name}.wav` }).catch(() => undefined)
    return
  }
  if (playerFile !== undefined) {
    await $.fs.write(playerFile, name).catch(() => undefined)
    return
  }
  await $.process
    .run(['powershell', '-NoProfile', '-NonInteractive', '-Command', `(New-Object Media.SoundPlayer ${psQuote(`${root}/sounds/${name}.wav`)}).PlaySync()`], { timeoutMs: 15000 })
    .catch(() => undefined)
}

async function saveBank($: EngineInterface, change: (b: Bank) => Bank): Promise<Bank> {
  const next = change((await $.state.get(BANK)).value ?? EMPTY_BANK)
  await $.state.set(BANK, next)
  await $.store.set('bank', next)
  $.ui.status(`🎰 ${next.coins}`)
  return next
}

async function commitSubject($: EngineInterface, cwd: string | undefined): Promise<string> {
  try {
    const { exitCode, stdout } = await $.process.run(['git', 'log', '-1', '--format=%s'], { cwd, timeoutMs: 5000 })
    return exitCode === 0 ? stdout.trim() : ''
  } catch {
    return ''
  }
}

const SPIN_COST = 10

const fmt = (n: number) => n.toLocaleString('ru-RU')
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0')
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = Math.abs(n) % 10
  const m100 = Math.abs(n) % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

// A commit spins for free; a button spin costs SPIN_COST, never pays ×2 and leaves the clean streak alone.
async function spin($: EngineInterface, cwd: string | undefined, isPaid = false): Promise<void> {
  if ((await $.state.get(SPINNING)).value ?? false) return

  let isClean = false
  if (isPaid) {
    const coins = ((await $.state.get(BANK)).value ?? EMPTY_BANK).coins
    if (coins < SPIN_COST) {
      $.ui.toast(`Нужно ${SPIN_COST} фишек, на счету ${fmt(coins)}. Коммит крутит бесплатно.`)
      return
    }
    await saveBank($, old => ({ ...old, coins: old.coins - SPIN_COST }))
  } else {
    isClean = ((await $.state.get(FAILS)).value ?? 0) === 0
    await $.state.set(FAILS, 0)
  }
  await $.state.set(SPINNING, true)
  void $.ui.open({ id: PANE, title: TITLE })

  const final = roll(Math.random)
  const id = Math.floor(await $.clock.now())
  await $.state.set(PENDING, { id, reels: final })
  const outcome = score(final, isClean)
  void play($, outcome.isJackpot ? 'spin-jackpot' : outcome.payout > 0 ? 'spin-win' : 'spin-lose')
  const subject = isPaid ? `ручной спин −${SPIN_COST}` : await commitSubject($, cwd)

  // Terminal frames: each reel a 3-row window that scrolls, stopping on the SVG's beats.
  const TICK = 80
  const stopAt = REEL_SECONDS.map(s => Math.round((s * 1000) / TICK))
  const settleAt = (stopAt[2] ?? 25) + 4
  const any = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)] ?? '🎰'
  const windows = final.map(() => [any(), any(), any()])
  let tick = 0

  return new Promise<void>(resolve => {
    const timer = $.clock.every(TICK, () => {
      tick += 1
      windows.forEach((w, r) => {
        const at = stopAt[r] ?? 25
        if (tick < at) {
          w.pop()
          w.unshift(any())
        } else if (tick === at) {
          w.splice(0, 3, any(), final[r] ?? '🎰', any())
        }
      })
      void $.state.set(REELS, [0, 1, 2].flatMap(row => windows.map(w => w[row] ?? '')))
      if (tick >= settleAt) {
        timer.cancel()
        void settle($, id, final, isClean, subject, isPaid).then(resolve, resolve)
      }
    })
  })
}

async function spinMany($: EngineInterface, times: number) {
  for (let i = 0; i < times; i++) {
    if (i > 0) await new Promise<void>(resolve => $.clock.after(900, resolve))
    const before = ((await $.state.get(BANK)).value ?? EMPTY_BANK).spins
    await spin($, undefined, true)
    if (((await $.state.get(BANK)).value ?? EMPTY_BANK).spins === before) return
  }
}

async function settle($: EngineInterface, id: number, final: string[], isClean: boolean, subject: string, isPaid: boolean) {
  const { payout, label, isJackpot } = score(final, isClean)
  await $.state.set(LAST, { id, reels: final, payout, label, subject, isClean })
  await $.state.set(SPINNING, false)
  const b = await saveBank($, old => {
    const streak = isPaid ? old.streak : isClean ? old.streak + 1 : 0
    return {
      ...old,
      coins: old.coins + payout,
      spins: old.spins + 1,
      jackpots: old.jackpots + (isJackpot ? 1 : 0),
      streak,
      bestStreak: Math.max(old.bestStreak, streak),
    }
  })
  if (isJackpot) {
    $.ui.toast(`🎰 ${final.join(' ')} ${label}! +${fmt(payout)}, на счету ${fmt(b.coins)}`)
  }
}

function watchCi($: EngineInterface, cwd: string | undefined, sha: string) {
  ciTimer?.cancel()
  let polls = 0
  let isBusy = false
  void $.state.set(CI, ({ sha, status: 'watching', detail: 'жду, когда CI стартует…' }))

  const stop = (status: Ci['status'], detail: string) => {
    timer.cancel()
    void $.state.set(CI, ({ sha, status, detail }))
  }

  const poll = async () => {
    if (isBusy) return
    isBusy = true
    polls += 1
    try {
      const r = await $.process.run(
        ['gh', 'run', 'list', '--commit', sha, '--json', 'status,conclusion,attempt,name'],
        { cwd, timeoutMs: 15000 },
      )
      if (r.exitCode !== 0) {
        if (polls >= 3) stop('none', `gh: ${r.stderr.trim().split('\n')[0] || 'ошибка'}`)
        return
      }
      const runs = JSON.parse(r.stdout || '[]') as CiRun[]
      if (runs.length === 0) {
        if (polls >= 9) stop('none', 'CI на этот коммит не нашёлся')
        return
      }
      const done = runs.filter(run => run.status === 'completed')
      if (done.length < runs.length) {
        if (polls >= 60) stop('none', 'CI думает дольше 20 минут, я ушёл')
        else void $.state.set(CI, ({ sha, status: 'watching', detail: `${done.length}/${runs.length} джобов готово` }))
        return
      }

      const isGreen = runs.every(run => ['success', 'skipped', 'neutral'].includes(run.conclusion))
      const isFirstTry = runs.every(run => run.attempt === 1)
      if (isGreen && isFirstTry) {
        stop('won', `💎 зелёный с первого раза +${CI_BONUS}`)
        const b = await saveBank($, old => ({ ...old, coins: old.coins + CI_BONUS, ciWins: old.ciWins + 1 }))
        void play($, 'ci-win')
        $.ui.toast(`💎 CI зелёный с первой попытки: +${CI_BONUS}, на счету ${fmt(b.coins)}`)
      } else if (isGreen) {
        stop('won', 'зелёный, но не с первой попытки: без бонуса')
      } else {
        const failed = runs.filter(run => run.conclusion !== 'success').map(run => run.name)
        stop('lost', `🔥 упал: ${failed.join(', ')} −${CI_PENALTY}`)
        const b = await saveBank($, old => ({ ...old, coins: old.coins - CI_PENALTY, ciLosses: old.ciLosses + 1 }))
        void play($, 'ci-lose')
        $.ui.toast(`🔥 CI упал: −${CI_PENALTY}, на счету ${fmt(b.coins)}`)
      }
    } catch {
      if (polls >= 3) stop('none', 'gh недоступен')
    } finally {
      isBusy = false
    }
  }

  const timer = $.clock.every(20000, () => void poll())
  ciTimer = timer
}

async function toggleMute($: EngineInterface): Promise<boolean> {
  const muted = (await $.state.get(MUTED)).value !== true
  await $.state.set(MUTED, muted)
  await $.store.set('muted', muted)
  return muted
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get('bank')) as Bank | undefined
    const b: Bank = { ...EMPTY_BANK, ...saved }
    await $.state.set(BANK, b)
    $.ui.status(`🎰 ${b.coins}`)
    startPlayer($)
    await $.state.set(MUTED, (await $.store.get('muted')) === true)
    await $.command.register({ name: 'casino', description: 'Открыть Git Casino' })
    await $.command.register({ name: 'casino-mute', description: 'Включить или выключить звук Git Casino' })

    return next(e)
  })

  on('command.run', { command: 'casino' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Git Casino открыт. Каждый коммит через Claude крутит бесплатно.' }
  })

  on('command.run', { command: 'casino-mute' }, async $ => {
    const muted = await toggleMute($)

    return { text: muted ? '🔇 Звук казино выключен.' : '🔊 Звук казино включён.' }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) return ran

    const command = e.command
    const cwd = repoDir(command)

    if (ran.isError) {
      await $.state.set(FAILS, ((await $.state.get(FAILS)).value ?? 0) + 1)
      return ran
    }
    if (isCommit(command)) {
      void spin($, cwd)
    }
    if (isPush(command)) {
      try {
        const head = await $.process.run(['git', 'rev-parse', 'HEAD'], { cwd, timeoutMs: 5000 })
        if (head.exitCode === 0) watchCi($, cwd, head.stdout.trim())
      } catch {
        // not a repo the host can reach: no CI bet
      }
    }

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const spinning = (await $.state.get(SPINNING)).value ?? false
    const result = (await $.state.get(LAST)).value ?? null
    const b = (await $.state.get(BANK)).value ?? EMPTY_BANK
    const bet = (await $.state.get(CI)).value ?? null
    const strikes = (await $.state.get(FAILS)).value ?? 0
    const muted = (await $.state.get(MUTED)).value ?? false
    const isConfirmingReset = (await $.state.get(CONFIRM_RESET)).value ?? false

    const isJackpot = result !== null && result.reels.every(s => s === result.reels[0])
    const isDoubled = result !== null && result.isClean && result.payout > 0
    const resultColor = result === null ? 'subtle' : isJackpot ? 'warning' : result.payout > 0 ? 'success' : 'error'
    const canAfford = b.coins >= SPIN_COST
    const canAffordThree = b.coins >= SPIN_COST * 3

    let machine
    if (e.surface === 'desktop' || e.surface === 'mobile') {
      const { Svg } = $.ui.resolve(e)
      const pending = spinning ? (await $.state.get(PENDING)).value ?? null : null
      const mode: Mode =
        pending !== null ? 'spin'
        : result === null ? 'idle'
        : isJackpot ? 'jackpot'
        : result.payout > 0 ? 'win'
        : 'lose'
      const caption =
        mode === 'spin' ? 'Крутим…'
        : result === null ? 'Коммить, чтобы крутить'
        : `${result.label} ${signed(result.payout)}${isDoubled ? '  ×2' : ''}`
      const source = slotSvg({
        id: pending?.id ?? result?.id ?? 1,
        final: pending?.reels ?? result?.reels ?? ['7️⃣', '7️⃣', '7️⃣'],
        mode,
        caption,
      })
      machine = <Svg key={`slot-${mode}-${pending?.id ?? result?.id ?? 0}`} source={source} alt={`Игровой автомат: ${caption}`} isInteractive />
    } else {
      // Only the terminal reads the tick frames, so the SVG is not redrawn 12 times a second.
      const frame = (await $.state.get(REELS)).value ?? []
      const rows = frame.length === 9 ? [frame.slice(0, 3), frame.slice(3, 6), frame.slice(6, 9)] : [['🎰', '🎰', '🎰']]
      machine = (
        <Box borderStyle="double" borderColor="warning" paddingX={2} flexDirection="column" alignItems="center">
          {rows.map((row, i) => (
            <Text bold={rows.length === 1 || i === 1} dimColor={rows.length === 3 && i !== 1}>
              {rows.length === 3 && i === 1 ? '▶ ' : '  '}
              {row.join('  ┃  ')}
              {rows.length === 3 && i === 1 ? ' ◀' : '  '}
            </Text>
          ))}
        </Box>
      )
    }

    // No disabled prop on Button: an unaffordable spin is drawn dim and answers with a toast.
    const spinButtons = spinning ? (
      <Box flexDirection="row" gap={1}>
        <Button key="spin" dimColor label="Крутится…" onPress={() => undefined} />
      </Box>
    ) : (
      <Box flexDirection="row" gap={1}>
        <Button key="spin" hotkey="s" dimColor={!canAfford} onPress={() => void spinMany($, 1)}>
          Крутить <Text dimColor>{SPIN_COST}</Text>
        </Button>
        <Button key="spin3" hotkey="3" dimColor={!canAffordThree} onPress={() => void spinMany($, 3)}>
          Три спина <Text dimColor>{SPIN_COST * 3}</Text>
        </Button>
        <Button key="mute" hotkey="m" dimColor label={muted ? '🔇 Без звука' : '🔊 Со звуком'} onPress={() => void toggleMute($)} />
      </Box>
    )

    const ciColor = bet?.status === 'won' ? 'success' : bet?.status === 'lost' ? 'error' : 'subtle'

    return (
      <Box flexDirection="column" padding={1} gap={1}>
        {machine}

        <Box flexDirection="column">
          <Text>
            <Text bold>{fmt(b.coins)}</Text> {plural(b.coins, 'фишка', 'фишки', 'фишек')}
            {!spinning && result !== null && (
              <Text color={resultColor}>
                {'   '}
                {signed(result.payout)} за спин{isDoubled ? ', ×2 за чистый коммит' : ''}
              </Text>
            )}
          </Text>
          {!spinning && result !== null && result.subject !== '' && <Text dimColor>{result.subject}</Text>}
          {!spinning && result === null && (
            <Text dimColor>Каждый коммит через Claude крутит бесплатно, ручной спин стоит {SPIN_COST}.</Text>
          )}
        </Box>

        {spinButtons}
        {!canAfford && !spinning && <Text color="warning">На ручной спин не хватает фишек. Коммит крутит бесплатно.</Text>}

        <Box flexDirection="column">
          <Text color={strikes === 0 ? 'success' : 'warning'}>
            {strikes === 0
              ? 'Следующий коммит ×2: после прошлого ничего не упало'
              : `×2 сгорел: ${strikes} ${plural(strikes, 'команда упала', 'команды упали', 'команд упало')} после прошлого коммита`}
          </Text>
          {bet !== null && (
            <Text color={ciColor}>
              CI {bet.sha.slice(0, 7)} · {bet.detail}
            </Text>
          )}
        </Box>

        <Text dimColor>
          {fmt(b.spins)} {plural(b.spins, 'спин', 'спина', 'спинов')} · {b.jackpots} {plural(b.jackpots, 'джекпот', 'джекпота', 'джекпотов')} · серия {b.streak}, рекорд {b.bestStreak} · CI {b.ciWins}:{b.ciLosses}
        </Text>

        {isConfirmingReset ? (
          <Box flexDirection="row" gap={1}>
            <Text color="error">Сбросить {fmt(b.coins)} {plural(b.coins, 'фишку', 'фишки', 'фишек')} и статистику?</Text>
            <Button
              key="reset-yes"
              label="Да, сбросить"
              onPress={async () => {
                await saveBank($, () => EMPTY_BANK)
                await $.state.set(LAST, null)
                await $.state.set(CONFIRM_RESET, false)
              }}
            />
            <Button key="reset-no" dimColor label="Отмена" onPress={() => void $.state.set(CONFIRM_RESET, false)} />
          </Box>
        ) : (
          <Box flexDirection="row">
            <Button key="reset" label="Сбросить банк…" onPress={() => void $.state.set(CONFIRM_RESET, true)} />
          </Box>
        )}
      </Box>
    )
  })
}
