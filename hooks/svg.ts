import { SYMBOLS } from './lib'

export type Mode = 'idle' | 'spin' | 'win' | 'jackpot' | 'lose'

// Seconds each reel spins; the terminal's ticks stop on the same beats.
export const REEL_SECONDS = [1.2, 1.6, 2.0]

const CELL = 60
const STRIP = 22
const REEL_X = [34, 124, 214]
const WIN_Y = 62
const W = 360
const H = 290

function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A reel's strip: random symbols, the final one second to last so one shows below it.
function strip(final: string, rand: () => number): string[] {
  const out: string[] = []
  for (let i = 0; i < STRIP; i++) out.push(SYMBOLS[Math.floor(rand() * SYMBOLS.length)] ?? '🍒')
  out[STRIP - 2] = final
  return out
}

const END = -(STRIP - 3) * CELL

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function slotSvg(opts: { id: number; final: readonly string[]; mode: Mode; caption: string }): string {
  const { id, final, mode, caption } = opts
  const rand = seeded(id)
  const isSpin = mode === 'spin'
  const isHot = mode === 'win' || mode === 'jackpot'

  const reels = REEL_X.map((x, r) => {
    const symbols = isSpin
      ? strip(final[r] ?? '🍒', rand)
      : [SYMBOLS[(id + r) % SYMBOLS.length] ?? '', final[r] ?? '', SYMBOLS[(id + r + 3) % SYMBOLS.length] ?? '']
    const cells = symbols
      .map((s, i) =>
        s === '7️⃣'
          ? `<text x="${x + 40}" y="${WIN_Y + i * CELL + 47}" class="seven">7</text>`
          : `<text x="${x + 40}" y="${WIN_Y + i * CELL + 42}" class="sym">${s}</text>`,
      )
      .join('')
    const anim = isSpin ? ` class="strip" style="animation-duration:${REEL_SECONDS[r]}s,${REEL_SECONDS[r]}s"` : ''
    return `<g clip-path="url(#reel${r})"><rect x="${x}" y="${WIN_Y}" width="80" height="${CELL * 3}" fill="url(#reelbg)"/><g${anim}>${cells}</g><rect x="${x}" y="${WIN_Y}" width="80" height="${CELL * 3}" fill="url(#shade)"/></g>`
  }).join('')

  const bulbs = Array.from({ length: 13 }, (_, i) => {
    const cx = 30 + i * 25
    return `<circle cx="${cx}" cy="18" r="5" class="bulb ${i % 2 ? 'odd' : ''}"/><circle cx="${cx}" cy="${H - 14}" r="4" class="bulb ${i % 2 ? '' : 'odd'}"/>`
  }).join('')

  const coins = mode === 'jackpot'
    ? Array.from({ length: 18 }, (_, i) => {
        const x = 20 + ((i * 53 + id * 17) % (W - 40))
        const delay = ((i * 0.37) % 1.4).toFixed(2)
        return `<g class="coin" style="animation-delay:${delay}s"><circle cx="${x}" cy="-16" r="10" fill="#ffd84a" stroke="#b8860b" stroke-width="2.5"/><text x="${x}" y="-11.5" class="buck">$</text></g>`
      }).join('')
    : ''

  const lineClass = isHot ? 'payline hot' : mode === 'lose' ? 'payline cold' : 'payline'
  const blink = mode === 'jackpot' ? '0.18s' : isSpin ? '0.35s' : '0.9s'

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
  <linearGradient id="cab" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a0f1c"/><stop offset="1" stop-color="#2a0409"/></linearGradient>
  <linearGradient id="trim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe38a"/><stop offset=".5" stop-color="#c8962c"/><stop offset="1" stop-color="#fff1b8"/></linearGradient>
  <linearGradient id="reelbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9d9d9"/><stop offset=".5" stop-color="#ffffff"/><stop offset="1" stop-color="#d9d9d9"/></linearGradient>
  <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".28" stop-color="#000" stop-opacity="0"/><stop offset=".72" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>
  ${REEL_X.map((x, r) => `<clipPath id="reel${r}"><rect x="${x}" y="${WIN_Y}" width="80" height="${CELL * 3}" rx="6"/></clipPath>`).join('')}
</defs>
<style>
  .sym { font: 38px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif; text-anchor: middle; }
  .strip { animation-name: roll, blur; animation-fill-mode: forwards; animation-timing-function: linear; }
  @keyframes roll {
    0%   { transform: translateY(0); animation-timing-function: cubic-bezier(.35,0,.9,.4); }
    12%  { transform: translateY(${-CELL}px); animation-timing-function: cubic-bezier(.1,.5,.3,1); }
    86%  { transform: translateY(${END - 16}px); animation-timing-function: ease-in-out; }
    94%  { transform: translateY(${END + 6}px); animation-timing-function: ease-in-out; }
    100% { transform: translateY(${END}px); }
  }
  @keyframes blur { 0% { filter: none } 15% { filter: blur(2.5px) } 70% { filter: blur(1.5px) } 86% { filter: none } 100% { filter: none } }
  .bulb { fill: #ffd84a; animation: blink ${blink} steps(1) infinite; }
  .bulb.odd { animation-delay: ${blink === '0.9s' ? '0.45s' : blink === '0.35s' ? '0.175s' : '0.09s'}; }
  @keyframes blink { 0% { fill: #ffd84a; opacity: 1 } 50% { fill: #5a1a1a; opacity: .6 } }
  .payline { fill: none; stroke: #ffd84a; stroke-width: 2; stroke-dasharray: 6 4; opacity: .7; }
  .payline.hot { stroke-width: 4; stroke-dasharray: none; animation: glow .5s ease-in-out infinite alternate; }
  .payline.cold { stroke: #ff5a5a; animation: fade 1.2s forwards; }
  @keyframes glow { from { opacity: .5; stroke: #ffd84a } to { opacity: 1; stroke: #fff6c2 } }
  @keyframes fade { from { opacity: 1 } to { opacity: .25 } }
  .knob { animation: ${isSpin ? 'pull .7s ease-in-out' : 'none'}; }
  @keyframes pull { 0% { transform: translateY(0) } 40% { transform: translateY(110px) } 100% { transform: translateY(0) } }
  .seven { font: 900 46px "Arial Black",Impact,sans-serif; text-anchor: middle; fill: #e2202c; stroke: #ffd84a; stroke-width: 2.5; paint-order: stroke; }
  .coin { transform-box: fill-box; transform-origin: center; animation: fall 1.6s ease-in 3 both; }
  .buck { font: 900 13px Arial,sans-serif; text-anchor: middle; fill: #8a5a00; }
  @keyframes fall { from { transform: translateY(0) rotate(0deg) } to { transform: translateY(${H + 40}px) rotate(540deg) } }
  .title { font: 900 20px "Arial Black",Impact,sans-serif; fill: url(#trim); text-anchor: middle; letter-spacing: 3px; }
  .cap { font: 700 15px "Segoe UI",sans-serif; text-anchor: middle; fill: ${isHot ? '#ffe38a' : mode === 'lose' ? '#ff9a9a' : '#f5e9d0'}; }
  .cap.pop { animation: pop .6s cubic-bezier(.2,1.6,.4,1) both; transform-origin: 180px 272px; }
  @keyframes pop { from { transform: scale(.3); opacity: 0 } to { transform: scale(1); opacity: 1 } }
  @media (prefers-reduced-motion: reduce) {
    .strip { animation-name: roll !important; animation-duration: .25s !important; }
    .bulb, .knob, .coin, .payline.hot, .cap.pop { animation: none !important; }
    .coin { display: none; }
  }
</style>
<rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="22" fill="url(#cab)" stroke="url(#trim)" stroke-width="4"/>
${bulbs}
<text x="${W / 2}" y="50" class="title">GIT CASINO</text>
<rect x="26" y="${WIN_Y - 8}" width="276" height="${CELL * 3 + 16}" rx="10" fill="#14020a" stroke="url(#trim)" stroke-width="3"/>
${reels}
<rect x="28" y="${WIN_Y + CELL}" width="272" height="${CELL}" rx="6" class="${lineClass}"/>
<rect x="326" y="80" width="10" height="150" rx="5" fill="#2a0409" stroke="#c8962c"/>
<g class="knob"><rect x="328" y="70" width="6" height="40" fill="#bbb"/><circle cx="331" cy="66" r="11" fill="#e2202c" stroke="#fff" stroke-width="2"/></g>
<text x="${W / 2}" y="${H - 28}" class="cap${isSpin ? '' : ' pop'}">${esc(caption)}</text>
${coins}
</svg>`
}
