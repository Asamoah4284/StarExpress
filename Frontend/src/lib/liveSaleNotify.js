/** @type {AudioContext | null} */
let audioCtx = null

/**
 * Short notification beep when a new sale arrives (Web Audio — no asset file).
 * @param {number} [count]
 */
export function playLiveSaleBeep(count = 1) {
  if (typeof window === "undefined") return
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    if (!audioCtx) audioCtx = new Ctx()
    const ctx = audioCtx
    if (ctx.state === "suspended") void ctx.resume()

    const beeps = Math.min(Math.max(1, count), 3)
    for (let i = 0; i < beeps; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.value = i === 0 ? 880 : 988
      gain.gain.value = 0.035
      osc.connect(gain)
      gain.connect(ctx.destination)
      const t = ctx.currentTime + i * 0.18
      osc.start(t)
      osc.stop(t + 0.1)
      gain.gain.setValueAtTime(0.035, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1)
    }
  } catch {
    /* Audio unavailable — visual pulse still runs */
  }
}
