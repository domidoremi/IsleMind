import type { AppPalette } from '@/theme/colors'
import type { ViewStyle } from 'react-native'

/** A single analytic liquid lens pass, not a mesh/physics engine or a screen capture. */
export const liquidVertexShader = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`

export const liquidFragmentShader = `
precision highp float;
varying vec2 uv;
uniform vec2 resolution;
uniform float phase;
uniform float amplitude;
uniform float strength;
uniform float dark;
uniform vec3 canvas;
uniform vec3 cool;
uniform vec3 warm;

float square(float x) { return x * x; }

float blendDistance(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Domain-warped, merging ribbons. The silhouette, thickness and lighting all
// come from this same field, so highlights bend with the liquid instead of
// sliding across an otherwise rigid card. All temporal terms close at 2*pi.
float liquid(vec2 p) {
  float t = phase;
  float a = amplitude;
  float left = -0.86 + 0.25 * sin(p.y * 1.65 + 0.55 * a * sin(t))
    + 0.12 * a * sin(t + p.y * 0.8);
  float right = 0.86 + 0.22 * cos(p.y * 1.35 - 0.65 * a * cos(t))
    + 0.16 * a * sin(t - p.y * 0.7);
  float r1 = 0.27 + 0.07 * sin(p.y * 1.9 - a * cos(t));
  float r2 = 0.24 + 0.075 * cos(p.y * 2.1 + a * sin(t));
  float d = blendDistance(abs(p.x - left) - r1, abs(p.x - right) - r2, 0.22);
  vec2 drop = p - vec2(-0.32 + 0.22 * a * sin(t), 0.65 + 0.24 * a * cos(t));
  d = blendDistance(d, length(drop * vec2(1.0, 0.74)) - 0.34, 0.32);
  return d;
}

vec3 environment(vec2 p) {
  float blue = exp(-dot(p - vec2(-0.7, 1.25), p - vec2(-0.7, 1.25)) * 0.48);
  float rose = exp(-dot(p - vec2(0.95, -1.4), p - vec2(0.95, -1.4)) * 0.38);
  vec3 color = mix(canvas, cool, blue * mix(0.22, 0.25, dark));
  color = mix(color, warm, rose * mix(0.12, 0.10, dark));
  // A broad studio light gives transmitted light something to refract. It is
  // deliberately low contrast behind text, with no noise or flashing points.
  float softbox = exp(-square((p.x + 0.22 * p.y - 0.28) * 2.4));
  return mix(color, mix(vec3(1.0), cool, dark * 0.55), softbox * mix(0.12, 0.06, dark));
}

void main() {
  // Metric coordinates preserve curvature on phones, tablets and rotation.
  vec2 p = (uv - 0.5) * 2.0 * resolution / min(resolution.x, resolution.y);
  float d = liquid(p);
  float pixel = 2.0 / min(resolution.x, resolution.y);
  float coverage = 1.0 - smoothstep(-pixel, pixel, d);
  vec3 base = environment(p);
  float shadow = (1.0 - smoothstep(-0.025, 0.12, liquid(p + vec2(0.045, 0.07)))) * (1.0 - coverage);
  base *= 1.0 - shadow * mix(0.07, 0.16, dark);

  // A rounded height profile produces steep menisci and a calmer interior.
  float epsilon = 0.003;
  vec2 gradient = vec2(liquid(p + vec2(epsilon, 0.0)) - liquid(p - vec2(epsilon, 0.0)),
                       liquid(p + vec2(0.0, epsilon)) - liquid(p - vec2(0.0, epsilon))) / (2.0 * epsilon);
  float depth = sqrt(max(0.0, -d));
  // Flatten the medial axis of the distance field: its gradient flips there,
  // but a real pool has no knife-edge ridge or sparkling seam in its centre.
  vec3 normal = normalize(vec3(gradient * 0.42 * smoothstep(-0.19, 0.0, d), max(0.025, depth * 1.5)));
  vec3 ray = refract(vec3(0.0, 0.0, -1.0), normal, 1.0 / 1.46);
  vec2 bend = ray.xy * (0.24 + depth * 1.2);
  // Subtle dispersion at the curved edge, not a rainbow overlay.
  vec3 transmitted = vec3(environment(p + bend * 1.018).r,
                          environment(p + bend).g,
                          environment(p + bend * 0.982).b);
  transmitted *= exp(-depth * vec3(0.07, 0.025, 0.012));
  vec3 reflected = reflect(vec3(0.0, 0.0, -1.0), normal);
  float fresnel = 0.035 + 0.965 * pow(1.0 - normal.z, 5.0);
  float key = pow(max(dot(reflected, normalize(vec3(-0.55, 0.7, 1.0))), 0.0), 42.0);
  float strip = exp(-square((reflected.x + reflected.y * 0.38 + 0.32) * 10.0))
    * smoothstep(-0.15, 0.65, reflected.z);
  float rimLight = smoothstep(-0.8, 0.9, dot(normal.xy, normalize(vec2(-0.6, 0.8))));
  vec3 reflection = mix(canvas * 0.65, mix(vec3(1.0), cool, dark * 0.22), clamp(key + strip * 0.65 + rimLight * 0.8, 0.0, 1.0));
  vec3 lens = mix(transmitted, reflection, min(0.82, fresnel * 0.75 + key * 0.20));
  lens += vec3(1.0) * (key * 0.36 + strip * 0.16) * mix(1.0, 0.75, dark);
  // Light concentrated just inside the meniscus follows its normal/curvature.
  float caustic = exp(-square((d + 0.040) / 0.025))
    * pow(max(dot(normal.xy, normalize(vec2(-0.6, 0.8))), 0.0), 3.0);
  lens += mix(vec3(1.0), cool, 0.16) * caustic * mix(0.26, 0.19, dark);
  gl_FragColor = vec4(clamp(mix(canvas, mix(base, lens, coverage), strength), 0.0, 1.0), 1.0);
}`

export interface LiquidUniforms {
  canvas: number[]
  cool: number[]
  warm: number[]
  dark: number
  amplitude: number
  strength: number
  seed: number
  cycleMs: number
}

export interface LiquidCanvasProps {
  values: LiquidUniforms
  animated: boolean
  style: ViewStyle
  onReady: () => void
  onError: () => void
}

export function liquidUniforms(colors: AppPalette, amplitude: number, strength: number, seed: number, cycleMs: number, canvasColor = colors.background.canvas): LiquidUniforms {
  const rgb = (hex: string) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
  return {
    canvas: rgb(canvasColor), cool: rgb(colors.primary), warm: rgb(colors.tertiary),
    dark: colors.design?.mode === 'dark' ? 1 : 0,
    amplitude: Math.max(0, Math.min(1, amplitude)), strength: Math.max(0, Math.min(1, strength)),
    seed: (seed % 360) * Math.PI / 180, cycleMs: Math.max(1000, cycleMs),
  }
}

/** Cap only the decorative framebuffer; content and native blur stay sharp. */
export function liquidRasterSize(width: number, height: number, density: number) {
  const scale = Math.min(1, 960 / (Math.max(width, height, 1) * Math.max(density, 1)))
  return { width: Math.max(1, width * scale), height: Math.max(1, height * scale), scale }
}

export type LiquidGL = WebGLRenderingContext & { endFrameEXP?: () => void }
export interface LiquidRenderer {
  program: WebGLProgram
  buffer: WebGLBuffer
  position: number
  uniforms: Record<string, WebGLUniformLocation>
}

export function createLiquidRenderer(gl: LiquidGL): LiquidRenderer {
  'worklet'
  const shaders: WebGLShader[] = []
  let program: WebGLProgram | null = null
  let buffer: WebGLBuffer | null = null
  try {
    for (const [kind, source] of [[gl.VERTEX_SHADER, liquidVertexShader], [gl.FRAGMENT_SHADER, liquidFragmentShader]] as const) {
      const shader = gl.createShader(kind)
      if (!shader) throw new Error('Liquid glass shader allocation failed')
      shaders.push(shader)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Liquid glass shader: ${gl.getShaderInfoLog(shader)}`)
    }
    program = gl.createProgram()
    buffer = gl.createBuffer()
    if (!program || !buffer) throw new Error('Liquid glass program allocation failed')
    for (const shader of shaders) gl.attachShader(program, shader)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Liquid glass link: ${gl.getProgramInfoLog(program)}`)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const uniforms: Record<string, WebGLUniformLocation> = {}
    for (const name of ['resolution', 'phase', 'amplitude', 'strength', 'dark', 'canvas', 'cool', 'warm']) {
      const location = gl.getUniformLocation(program, name)
      if (location === null) throw new Error(`Liquid glass uniform unavailable: ${name}`)
      uniforms[name] = location
    }
    const position = gl.getAttribLocation(program, 'position')
    if (position < 0) throw new Error('Liquid glass vertex attribute unavailable')
    return { program, buffer, position, uniforms }
  } catch (error) {
    if (buffer) gl.deleteBuffer(buffer)
    if (program) gl.deleteProgram(program)
    throw error
  } finally {
    for (const shader of shaders) gl.deleteShader(shader)
  }
}

export function drawLiquidFrame(gl: LiquidGL, renderer: LiquidRenderer, values: LiquidUniforms, phase: number) {
  'worklet'
  const u = renderer.uniforms
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
  gl.useProgram(renderer.program)
  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.buffer)
  gl.enableVertexAttribArray(renderer.position)
  gl.vertexAttribPointer(renderer.position, 2, gl.FLOAT, false, 0, 0)
  gl.uniform2f(u.resolution, gl.drawingBufferWidth, gl.drawingBufferHeight)
  gl.uniform1f(u.phase, phase * Math.PI * 2 + values.seed)
  gl.uniform1f(u.amplitude, values.amplitude)
  gl.uniform1f(u.strength, values.strength)
  gl.uniform1f(u.dark, values.dark)
  gl.uniform3f(u.canvas, values.canvas[0], values.canvas[1], values.canvas[2])
  gl.uniform3f(u.cool, values.cool[0], values.cool[1], values.cool[2])
  gl.uniform3f(u.warm, values.warm[0], values.warm[1], values.warm[2])
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  // endFrameEXP already flushes Expo's command batch and presents it. A
  // separate flush submits an extra native batch before each actual frame.
  if (gl.endFrameEXP) gl.endFrameEXP()
  else gl.flush()
}

export function disposeLiquidRenderer(gl: LiquidGL, renderer: LiquidRenderer) {
  'worklet'
  gl.deleteBuffer(renderer.buffer)
  gl.deleteProgram(renderer.program)
}
