// The Eliacube workshop, played on the GPU.
//
// The painting arrives stretched to fill the window (preserveAspectRatio none),
// so the shader does the cropping itself: it covers the window without
// distortion, pinned to the right edge, whatever size the window is.
//
// Built to be cheap. Each effect is worked out only where it shows, in a
// small buffer of its own, and the full-resolution picture pass mostly looks
// those buffers up (the input box's fill, rim and aura are drawn there, as the
// box's place reaches only the picture pass):
//   motion      the arms' joints, and how the light falls on the cube's faces
//   energy      the cube's halo, its bursts and motes, and where the cube is
// The first two live in the painting's own units, so their cost does not
// grow with the window.
import { abs, buffer, clamp, composer, cos, dot, exp, floor, fract, length, max, min, mix, normalize, picture, scene, shader, sin, size, smoothstep, step, still, time, vec2, vec3, vec4 } from 'claude-code/shader'

// The painting's viewBox and where the cube sits in it (y down, as drawn).
const VB = vec2(640, 360)
const CUBE = vec2(449, 171)
// The energy's sizes were tuned on a 560-wide painting; keep them.
const UNIT = 560 / 640

// The parts of the painting each buffer covers: origin and size, in its units.
const ARM_O = vec2(296, 0) // the three arms, shoulders to claws, and the cube
const ARM_S = vec2(344, 360)
const EN_O = vec2(-100, 0) // the whole painting and the mirrored strip left of it
const EN_S = vec2(740, 360)
// 8-bit buffers can't hold 0.5 exactly; this is the value that stands for "no offset"
const ZERO = 128 / 255

// Every buffer here reads as "nothing" at its edge (no offset, no light, no
// fill), and clamps there: so a lookup past it needs no bounds test.

const hash = (q: vec2) => fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453)

// A point on screen (points, y up) to the painting's units (y down), covering
// the window pinned to its right edge and centred vertically.
// Then it slides right, so the cube sits near 78% of the window's width, clear
// of the conversation column: the far-right gears crop off, the claws' joints
// always stay in view, and the gap it opens at the left is filled by mirroring
// the painting's dark left edge.
const toPainting = (pt: vec2) => {
  const s = max(max(size.x / VB.x, size.y / VB.y), 0.0001)
  const pinned = size.x - VB.x * s
  const slide = clamp(size.x * 0.78 - (pinned + CUBE.x * s), 0, 95 * s)
  const o = vec2(pinned + slide, (size.y - VB.y * s) * 0.5)
  const down = vec2(pt.x, size.y - pt.y)
  return vec2((down - o) / s)
}

// Turns `q` by `a` radians around `c`.
const turn = (q: vec2, c: vec2, a: number) => {
  const d = vec2(q - c)
  const cs = cos(a)
  const sn = sin(a)
  return vec2(c.x + d.x * cs - d.y * sn, c.y + d.x * sn + d.y * cs)
}

// A servo's position, -1 to 1: it holds still, then makes a quick eased move
// to a new target, then holds again, so the arms work step by step like a
// machine rather than swaying. `seed` gives each joint its own targets.
const servo = (t: number, period: number, seed: number) => {
  const x = t / period + seed
  const k = floor(x)
  const from = hash(vec2(k, seed)) * 2 - 1
  const to = hash(vec2(k + 1, seed)) * 2 - 1
  return mix(from, to, smoothstep(0.6, 0.82, fract(x)))
}

// How near `q` is to the band from `a` to `b`, `r` wide: 1 on it, 0 off it,
// and 0 behind `a`.
const band = (q: vec2, a: vec2, b: vec2, r: number) => {
  const span = vec2(b - a)
  const rel = vec2(q - a)
  const along = dot(rel, span) / max(dot(span, span), 0.0001)
  const off = length(vec2(rel - span * clamp(along, 0, 1)))
  return (1 - smoothstep(r * 0.7, r * 1.15, off)) * smoothstep(-0.05, 0.1, along)
}

// One whole mech arm, articulated from the shoulder: the upper arm swings on
// its shoulder and carries everything past it, the forearm swings on its
// elbow, the claw head turns on its wrist, and the two prongs grip and
// release. Each joint is a servo of its own. The painting is pulled back
// through the joints outermost first, so each piece moves on its own pivot;
// nothing moves near the cube.
const arm = (q: vec2, t: number, shoulder: vec2, elbow: vec2, wrist: vec2, head: vec2, armR: number, clawR: number, seed: number) => {
  const clear = smoothstep(17, 27, length(vec2(q - CUBE)))
  const onHead = (p: vec2) => 1 - smoothstep(clawR * 0.55, clawR, length(vec2(p - head)))
  // the shoulder carries the whole arm
  const whole = max(max(band(q, shoulder, elbow, armR * 1.15), band(q, elbow, head, armR)), onHead(q)) * clear
  let r = turn(q, shoulder, -0.028 * servo(t, 3.9, seed + 11.7) * whole)
  // the elbow carries the forearm and the claw
  const fore = max(band(r, elbow, head, armR), onHead(r)) * clear
  r = turn(r, elbow, -0.05 * servo(t, 3.0, seed) * fore)
  // the claw head on its wrist, and its prongs on either side of the line
  // from the wrist to the cube
  const headMask = onHead(r) * clear
  const toCube = vec2(CUBE - wrist)
  const w = vec2(r - wrist)
  const side = smoothstep(-1.2, 1.2, (w.x * toCube.y - w.y * toCube.x) / max(length(toCube), 0.0001)) * 2 - 1
  const turnHead = 0.07 * servo(t, 2.25, seed + 7.3)
  const grip = 0.09 * (0.5 + 0.5 * servo(t, 1.65, seed + 3.1))
  return turn(r, wrist, -(turnHead + grip * side) * headMask)
}

// How the light falls on the cube, as a solid: a light circles it in 3D, so
// each face shades smoothly by how it turns toward the light (x), and a soft
// highlight glides across the faces with it (y). `d` is the offset from the
// cube's centre, in painting units.
const cubeShading = (d: vec2, t: number) => {
  // the face under this point, blended softly across the edges (y up)
  const onTop = 1 - smoothstep(-11, -5, d.y)
  const onRight = smoothstep(-2.5, 2.5, d.x)
  const sideN = vec3(mix(vec3(-0.75, 0, 0.66), vec3(0.75, 0, 0.66), onRight))
  const n = normalize(vec3(mix(sideN, vec3(0, 0.86, 0.5), onTop)))
  // a light that circles the cube, rising and falling as it goes
  const lightDir = normalize(vec3(cos(t * 0.45) * 0.85, 0.35 + 0.35 * sin(t * 0.31), 0.55 + 0.3 * sin(t * 0.45)))
  const shade = 0.62 + 0.55 * clamp(dot(n, lightDir), 0, 1)
  // the highlight it casts, gliding over the faces
  const gap = vec2(d - vec2(cos(t * 0.45) * 10, -4 - sin(t * 0.31) * 7))
  return vec2(shade, exp(-dot(gap, gap) / 55))
}
// shade runs 0.62 to 1.17; stored over this so it fits 0 to 1
const SHADE_MAX = 1.25

// Over the arms' part of the painting, two units a texel, both of them
// smooth enough for the picture to sample: the arms' motion as an offset
// (x, y), and the cube's shading and highlight (z, w).
const motion = buffer({ size: [172, 180], wrap: 'clamp' }, p => {
  const t = time * (1 - still)
  const at = vec2(ARM_O + p.uv * ARM_S)
  let q = at
  // upper, right and lower-left arms: shoulder, elbow, wrist and prongs each on their own servo
  q = arm(q, t, vec2(628, 92), vec2(578, 67), vec2(520, 102), vec2(488, 128), 16, 36, 1.7)
  q = arm(q, t, vec2(617, 258), vec2(567, 194), vec2(533, 182), vec2(505, 174), 14, 32, 5.3)
  q = arm(q, t, vec2(330, 350), vec2(347, 287), vec2(403, 224), vec2(414, 204), 16, 36, 9.1)
  const shading = cubeShading(vec2(at - CUBE), t)
  // offsets of up to 16 painting units each way, stored 0 to 1
  return vec4(vec2(clamp((q - at) / 32 + ZERO, 0, 1)), shading.x / SHADE_MAX, shading.y)
})

// Over the painting: the cube's halo and the wakfu it fires off, as light,
// and in the fourth lane where the cube's box is, for relighting its faces.
const energy = buffer({ size: [518, 252], wrap: 'clamp' }, p => {
  const t = time * (1 - still)
  const fromCube = vec2(EN_O + p.uv * EN_S - CUBE)
  const q = vec2(fromCube * UNIT)
  const cubeBox = smoothstep(19, 15, abs(fromCube.x)) * smoothstep(-19, -15, fromCube.y) * smoothstep(17, 13, fromCube.y)
  const dist = length(q)

  // a soft halo beyond the cube, breathing with the light in its faces
  const pulse = 0.5 + 0.5 * sin(t * 1.25)
  const halo = exp(-dist / 18) * smoothstep(16, 24, dist) * (0.25 + 0.35 * pulse * pulse)
  const cubeLight = vec3(vec3(0.25, 0.95, 0.85) * halo * 0.6)

  // wakfu bursts: now and then the cube fires a burst of neon cyan light in
  // a random direction. The burst races out with a long tail still pouring
  // from the cube; then the tail lets go of the cube and follows the head
  // away, and that channel is dark until its next burst. The light snakes
  // and widens as it travels, with pulses streaming along it, and breathes
  // with the cube.
  // Bursts come in volleys every 9 seconds: some volleys are quiet or a
  // single burst, now and then several fire together, each a moment apart.
  const volley = t / 9
  const k = floor(volley)
  const intoVolley = fract(volley) * 9
  const lively = hash(vec2(k, 0.37))
  const breathe = 0.7 + 0.45 * pulse
  let shots = vec3(0)
  for (let i = 0; i < 5; i++) {
    // one roll of the dice a burst, read four ways
    const roll = hash(vec2(k, i + 0.71))
    const fires = step(fract(roll * 7.31), 0.12 + 0.7 * lively * lively)
    const since = intoVolley - fract(roll * 13.77) * 1.6 // seconds since this burst fired
    const live = fires * step(0, since)
    const ang = fract(roll * 29.13) * 6.2832
    const dir = vec2(cos(ang), sin(ang))
    const side = vec2(-dir.y, dir.x)
    const along = dot(q, dir)
    const ahead = max(along, 0)
    const bend = sin(ahead * 0.03 - t * 1.6 + i * 2.1) * (2 + ahead * 0.04) + sin(ahead * 0.08 - t * 2.6 + i) * 1.4
    const across = dot(q, side) - bend
    const width = (3.2 + ahead * 0.045) * (0.85 + 0.3 * pulse)
    const core = exp(-(across * across) / (width * width))
    // the head races out; the cube pours light behind it for a moment
    const speed = 200
    const pour = 0.6 + 0.6 * fract(roll * 57.91)
    const front = 16 + speed * since
    const back = 16 + speed * max(since - pour, 0)
    const extent =
      smoothstep(front + 8, front - 8, along) *
      exp(-(front - along) / 150) *
      smoothstep(back - 4, back + 28, along) *
      smoothstep(14, 24, along) *
      exp(-ahead / 380)
    // pulses of light streaming outward along it: smooth noise down the
    // beam's length, irregular so it never reads as beads
    const flow = ahead * 0.045 - t * 2.4
    const knot = floor(flow)
    const ease = fract(flow)
    const lane = i * 3.7 + k
    const stream = 0.55 + 0.42 * mix(hash(vec2(knot, lane)), hash(vec2(knot + 1, lane)), ease * ease * (3 - 2 * ease))
    // wakfu neon cyan all the way: a light, bright cyan at the head, neon
    // cyan behind it, settling to a muted cyan down the tail; the heart of
    // the beam a touch lighter than its edges
    const down = clamp((front - along) / 220, 0, 1)
    const lengthwise = vec3(mix(mix(vec3(0.5, 1, 1), vec3(0.12, 0.92, 1), smoothstep(0, 0.35, down)), vec3(0.18, 0.55, 0.62), smoothstep(0.35, 1, down)))
    const hue = vec3(mix(lengthwise, vec3(0.6, 1, 1), core * core * 0.2))
    // a bright round aura round the head
    const hx = along - front
    const reachR = 9 + ahead * 0.02
    const aura = exp(-(hx * hx + across * across) / (reachR * reachR)) * smoothstep(14, 30, front) * exp(-ahead / 420)
    shots = vec3(shots + (hue * core * extent * stream * 1.05 + vec3(0.45, 1, 1) * aura * 0.9) * breathe * live)
  }

  // the light that moves through the cube spills out of it as a soft neon
  // bloom, following the highlight on its faces
  const lightAt = vec2(vec2(cos(t * 0.45) * 10, -4 - sin(t * 0.31) * 7) * UNIT)
  const gap = vec2(q - lightAt)
  const bloom = exp(-dot(gap, gap) / 160) * (0.35 + 0.25 * pulse)
  const neonBloom = vec3(vec3(0.3, 1, 0.9) * bloom)

  // motes drifting up through the light
  const g = vec2(q + vec2(0, t * 6))
  const cell = vec2(floor(g / 14))
  const h = hash(cell)
  const spot = vec2(fract(g / 14) - 0.5 - (vec2(h, hash(vec2(cell + 3.7))) - 0.5) * 0.6)
  const mote = smoothstep(0.11, 0, length(spot)) * smoothstep(0.86, 0.95, h) * smoothstep(120, 30, dist) * (0.6 + 0.4 * sin(t * 0.6 + h * 40))

  return vec4(vec3(clamp(cubeLight + neonBloom + shots + vec3(0.5, 1, 0.92) * mote * 0.5, 0, 1)), cubeBox)
})

const step01 = (x: number) => smoothstep(0, 1, x)

// How far past the prompt box its aura reaches, in points.
const STRIP_MARGIN = 34

// The prompt box as the app reports it: how far `pt` is outside its rounded
// edge (negative inside), the direction from its centre as a unit vector
// (stretched so a long box reads as round), and whether there is a box.
const promptBox = (pt: vec2) => {
  const lo = vec2(composer.x * size.x, composer.y * size.y)
  const hi = vec2(composer.z * size.x, composer.w * size.y)
  const has = step01(hi.x - lo.x - 4) * step01(hi.y - lo.y - 4)
  const c = vec2((lo + hi) * 0.5)
  const half = vec2((hi - lo) * 0.5)
  const k = vec2(abs(vec2(pt - c)) - half + 12)
  const outside = length(vec2(max(k, 0))) + min(max(k.x, k.y), 0) - 12
  const d = vec2(pt.x - c.x, (pt.y - c.y) * (half.x / max(half.y, 1)))
  const dir = vec2(d / max(length(d), 0.0001))
  return vec4(outside, dir.x, dir.y, has)
}

// The input box's light: a soft teal-violet aura spilling outward that
// slowly travels round the edge, and a gradient rim, wakfu cyan, sea green
// and deep blue, that turns round it. The turning is the box's direction
// rotated by the time: sines of the angle come from the vector itself, so a
// pixel does no trigonometry of its own.
const promptLight = (box: vec4, t: number) => {
  const turnBy = t * 0.4
  const ct = cos(turnBy)
  const st = sin(turnBy)
  // sin and cos of (angle - turn)
  const sx = box.z * ct - box.y * st
  const cx = box.y * ct + box.z * st
  const s2 = 2 * sx * cx // sin of twice it
  const c2 = 1 - 2 * sx * sx // cos of twice it
  // the aura
  const falloff = exp(-max(box.x, 0) / 9) * smoothstep(-2, 2, box.x) * smoothstep(STRIP_MARGIN - 2, STRIP_MARGIN - 10, box.x)
  const ring = 0.55 + 0.45 * s2
  const breath = 0.85 + 0.15 * sin(t * 0.5)
  const auraHue = vec3(mix(vec3(0.25, 0.92, 0.84), vec3(0.55, 0.42, 0.95), 0.5 + 0.5 * sx))
  const aura = vec3(auraHue * falloff * ring * breath * 0.5)
  // the rim
  const line = exp(-abs(box.x) / 0.8)
  const g = 0.5 + 0.5 * sx
  const h = 0.5 + 0.5 * (s2 * -0.1288 + c2 * 0.9917) // sin(2(angle - turn) + 1.7)
  const rimHue = vec3(mix(mix(vec3(0.2, 1, 0.95), vec3(0.25, 0.95, 0.55), g), vec3(0.25, 0.55, 1), h * 0.6))
  return vec4(vec3(aura + rimHue * line * 1.6) * box.w, 0)
}

const promptFill = vec3(0.04, 0.2, 0.25)

const view = picture(p => {
  const t = time * (1 - still)
  // The shader starts afresh whenever a session's background is shown (a
  // new tab, a switch back): ease every effect in over its first moments,
  // so the painting is there at once and the life comes into it, rather
  // than the effects jumping in.
  const wake = smoothstep(0, 1.6, time)
  const at = toPainting(p.point)
  // the arms' motion and the cube's shading; the cube's glow and its box
  const posed = motion.sample(vec2((at - ARM_O) / ARM_S))
  const glow = vec4(energy.sample(vec2((at - EN_O) / EN_S)) * wake)
  // where this pixel's painting comes from, with the arms' motion applied.
  // The painting fills the texture whole, y up; left of its edge (after the
  // slide), mirror it back in
  const q = vec2(at + (posed.xy - ZERO) * 32 * wake)
  const base = vec3(scene.sample(vec2(abs(q.x) / VB.x, 1 - q.y / VB.y)).rgb)
  // the cube's own faces, relit: its green breathes toward a neon cyan,
  // shaded and highlighted as the light circles it. Only the cube's green
  // paint changes (greener than the glow round it, and not gold); its
  // drawing, swirls and gold seam stay as painted
  const green = clamp((base.g - base.b) * 12 - 0.2, 0, 1) * step(base.r, 0.42)
  const neon = vec3(mix(vec3(0.15, 0.95, 0.6), vec3(0.22, 1, 0.95), 0.5 + 0.5 * sin(t * 1.25)))
  const tinted = vec3(mix(base, neon * (0.35 + 0.9 * dot(base, vec3(0.3, 0.6, 0.1))), 0.4))
  const relit = vec3(tinted * (posed.z * SHADE_MAX) + neon * posed.w * 0.35)
  const faces = vec3(mix(base, relit, glow.a * green))
  // the prompt box: its dark cyan under the app's box, then its light
  const box = promptBox(p.point)
  const lit0 = vec3(mix(faces, promptFill, smoothstep(0.8, -0.8, box.x) * box.w))
  // the cube's glow and bursts added screen-like, so the brights don't clip
  const lit = vec3(lit0 + glow.rgb * (1 - lit0 * 0.7) + promptLight(box, t).rgb * wake)
  return vec4(lit, 1)
})

export default shader({ fps: 30, passes: [motion, energy, view] })
