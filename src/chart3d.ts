import { engine, Transform, Material, MeshRenderer, TextShape, Entity, LightSource, MaterialTransparencyMode, TextureFilterMode, TextureWrapMode } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4, Color3 } from '@dcl/sdk/math'

export type DataPoint = { id: number; value: number }

let sentimentLightEntity: Entity | null = null

const NEUTRAL_SENTIMENT_LIGHT_VALUE = 5
const DEFAULT_SENTIMENT_LIGHT_POSITION = { x: -4.2, y: 3, z: -2.8 }
const DEFAULT_SENTIMENT_LIGHT_INTENSITY = 40000

function getSentimentLabel(value: number): string {
  if (value >= 0 && value < 2) return "Awful"
  if (value >= 2 && value < 3.5) return "Bad"
  if (value >= 3.5 && value < 6.5) return "Neutral"
  if (value >= 6.5 && value < 8) return "Good"
  if (value >= 8 && value <= 10) return "Great"

  return "Unknown"
}
// opzioni comuni a entrambe le funzioni
type BaseChartOpts = {
  position?: { x: number; y: number; z: number }   // chart world position
  width?: number                                   // larghezza in metri
  height?: number                                  // altezza in metri
  yMax?: number                                    // Y-axis maximum value
  axisColor?: Color4
  grid?: boolean
  labels?: boolean
  zOffset?: number
  mirrorX?: boolean
  mirrorY?: boolean
}

// line chart-specific options
export type LineChartOpts = BaseChartOpts & {
  thickness?: number                                // spessore linea
  lineColor?: Color4
  points?: boolean                                  // disegna i pallini sui campioni
}

// opzioni specifiche per il bar chart 
export type BarChartOpts = BaseChartOpts & {
  padding?: number                                  // empty space fraction between bars [0..0.4]
  barColor?: Color4
}

// create a line chart
export function addLineChart3D(data: DataPoint[], opts: LineChartOpts = {}) {
  const width = opts.width ?? 4
  const height = opts.height ?? 2
  const yMax = opts.yMax ?? 10
  const zOffset = opts.zOffset ?? -0.01
  const thickness = opts.thickness ?? 0.02
  const lineColor = opts.lineColor ?? Color4.create(1, 0, 0, 1)
  const axisColor = opts.axisColor ?? Color4.create(0, 0, 0, 1)
  const withGrid = opts.grid ?? true
  const withLabels = opts.labels ?? true
  const drawPoints = opts.points ?? true
  const mirrorX = opts.mirrorX ?? false
  const mirrorY = opts.mirrorY ?? false

  const mapX = (x: number) => (mirrorX ? width - x : x)
  const mapY = (y: number) => (mirrorY ? height - y : y)

  // chart root used to move it as a whole
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(opts.position?.x ?? 2, opts.position?.y ?? 1, opts.position?.z ?? 3)
  })

  // crea rettangoli (larghezza, altezza, coordinata x, coordinata y, inclinazione della linea, colore)
  function addRect(w: number, h: number, x: number, y: number, rotZDeg: number, col: Color4, isLine: boolean) {
    const e = engine.addEntity()
    Transform.create(e, {
      parent: root,
      position: Vector3.create(mapX(x), mapY(y), isLine ? zOffset:0),     // the drawn chart is offset from the background to avoid line overlap
      rotation: Quaternion.fromEulerDegrees(0, 0, rotZDeg),
      scale: Vector3.create(w, h, 1)
    })
    MeshRenderer.setPlane(e)
    Material.setBasicMaterial(e, { diffuseColor: col }) // BasicMaterial per non avere luci/ombre
    return e
  }

  // assi (X e Y)
  addRect(width, thickness, width / 2, 0, 0, axisColor, false)      // asse X
  addRect(thickness, height, 0, height / 2, 0, axisColor, false)    // asse Y

  // griglia
  if (withGrid) {
    const steps = yMax
    for (let v = 1; v < steps; v++) {
      const y = (v / yMax) * height
      addRect(width, thickness * 0.5, width / 2, y, 0, Color4.create(0.8, 0.8, 0.8, 1), false)
    }
  }

  // labels Y
  if (withLabels) {
    const tickEvery = Math.max(1, Math.round(yMax / 5))
    for (let v = 0; v <= yMax; v += tickEvery) {
      const label = engine.addEntity()
      Transform.create(label, {
        parent: root,
        position: Vector3.create(mapX(-0.1), (v / yMax) * height, 0),
        rotation: Quaternion.fromEulerDegrees(0, mirrorX ? 180:0, 0),
      })
      TextShape.create(label, {
        text: String(v),
        fontSize: 1,
        textColor: Color4.create(0, 0, 0, 1)
      })
    }
  }

  if (data.length < 2) return root

  // create line chart segments
  function addSegment(x0: number, y0: number, x1: number, y1: number, col: Color4) {
    const x0m = mapX(x0)
    const y0m = mapY(y0)
    const x1m = mapX(x1)
    const y1m = mapY(y1)

    const dx = x1m - x0m
    const dy = y1m - y0m
    const len = Math.sqrt(dx * dx + dy * dy)
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI
    const cx = (x0m + x1m) / 2
    const cy = (y0m + y1m) / 2
    const e = engine.addEntity()
    
    Transform.create(e, {
      parent: root,
      position: Vector3.create(cx, cy, zOffset),
      rotation: Quaternion.fromEulerDegrees(0, 0, ang),
      scale: Vector3.create(len, thickness, 1)
    })
    MeshRenderer.setPlane(e)
    Material.setBasicMaterial(e, { diffuseColor: col })
  }

  // mapping metri
  const xStep = width / (data.length - 1)
  const toY = (v: number) => Math.max(0, Math.min(height, (v / yMax) * height))

  // chart line
  for (let i = 1; i < data.length; i++) {
    const x0 = (i - 1) * xStep
    const y0 = toY(data[i - 1].value)
    const x1 = i * xStep
    const y1 = toY(data[i].value)
    addSegment(x0, y0, x1, y1, lineColor)
  }

  // punti
  if (drawPoints) {
    for (let i = 0; i < data.length; i++) {
      const dot = engine.addEntity()
      Transform.create(dot, {
        parent: root,
        position: Vector3.create(mapX(i * xStep), mapY(toY(data[i].value)), 2 * zOffset),
        scale: Vector3.create(0.06, 0.06, 1)
      })
      MeshRenderer.setPlane(dot)
      Material.setBasicMaterial(dot, { diffuseColor: Color4.create(0, 0, 1, 1) })
    }
  }

  return root
}

// opzioni specifiche per il donut chart
export type DonutChartOpts = {
  position?: { x: number; y: number; z: number }  // chart world position
  value?: number                                   // current value [0..maxValue]
  maxValue?: number                                // maximum value (default 10)
  outerRadius?: number                             // raggio esterno in metri (default 1)
  innerRadius?: number                             // raggio interno / foro (default 0.6)
  segments?: number                                // segments used to approximate the circle (default 72)
  positiveColor?: Color4                           // positive part color (default green)
  remainingColor?: Color4                          // remaining part color (default gray)
  showLabel?: boolean                              // mostra etichetta centrale
  labelFontSize?: number                           // dimensione font etichetta (default 2)
  zOffset?: number
}

// Creates a donut chart
// The green portion represents the value [0..maxValue], gray represents the remainder.
// The circle is approximated with N thin planes arranged radially.
export function addDonutChart3D(opts: DonutChartOpts = {}) {
  const value       = Math.max(0, Math.min(opts.value ?? 5, opts.maxValue ?? 10))
  const maxValue    = opts.maxValue ?? 10
  const outerRadius = opts.outerRadius ?? 1
  const innerRadius = opts.innerRadius ?? 0.6
  const segments    = opts.segments ?? 128
  const zOffset     = opts.zOffset ?? 0
  const showLabel   = opts.showLabel ?? true
  const labelFontSize = opts.labelFontSize ?? 2
  const positiveColor  = opts.positiveColor  ?? Color4.create(0.49, 0.67, 0.16, 1)  // green
  const remainingColor = opts.remainingColor ?? Color4.create(0.83, 0.82, 0.78, 1)  // gray

  // chart root
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(
      opts.position?.x ?? 8,
      opts.position?.y ?? 1.5,
      opts.position?.z ?? 8
    )
  })

  const midRadius     = (outerRadius + innerRadius) / 2
  const ringThickness = outerRadius - innerRadius
  // larghezza dell'arco al raggio medio, con leggera sovrapposizione per evitare gap
  const arcWidth = (2 * Math.PI * midRadius / segments) * 1.25

  // numero di segmenti che appartengono alla parte positiva
  const positiveSegments = Math.round((value / maxValue) * segments)

  for (let i = 0; i < segments; i++) {
    // angolo: parte dall'alto (Y+, ore 12) e scende in senso orario
    const angle = Math.PI / 2 + (i / segments) * 2 * Math.PI
    const cx     = Math.cos(angle) * midRadius
    const cy     = Math.sin(angle) * midRadius
    // the clockwise tangent at angle `angle` is (sin, -cos);
    // to align the plane X axis with the tangent, rotate by (angle - 90°)
    const rotDeg = (angle * 180) / Math.PI + 90

    const seg = engine.addEntity()
    Transform.create(seg, {
      parent: root,
      position: Vector3.create(cx, cy, zOffset),
      rotation: Quaternion.fromEulerDegrees(0, 0, rotDeg),
      scale:    Vector3.create(arcWidth, ringThickness, 1)
    })
    MeshRenderer.setPlane(seg)
    Material.setBasicMaterial(seg, {
      diffuseColor: i < positiveSegments ? positiveColor : remainingColor
    })
  }

  // center label with value and maximum
  if (showLabel) {
    const label = engine.addEntity()
    Transform.create(label, {
      parent: root,
      position: Vector3.create(0, 0, zOffset - 0.01),
      rotation: Quaternion.fromEulerDegrees(0, 0, 0),
    })
    TextShape.create(label, {
      text: getSentimentLabel(value),
      fontSize: labelFontSize,
      textColor: Color4.create(0.15, 0.15, 0.15, 1)
    })
  }

  return root
}

// Crea un bar chart
export function addBarChart3D(data: DataPoint[], opts: BarChartOpts = {}) {
  const width = opts.width ?? 4
  const height = opts.height ?? 2
  const yMax = opts.yMax ?? 10
  const zOffset = opts.zOffset ?? -0.01
  const axisColor = opts.axisColor ?? Color4.create(0, 0, 0, 1)
  const withGrid = opts.grid ?? true
  const withLabels = opts.labels ?? true
  const barColor = opts.barColor ?? Color4.create(0.2, 0.5, 0.95, 1)
  const barPadding = opts.padding ?? 0 // meglio averlo compreso tra [0..0.4]
  const mirrorX = opts.mirrorX ?? false
  const mirrorY = opts.mirrorY ?? false

  const mapX = (x: number) => (mirrorX ? width - x : x)
  const mapY = (y: number) => (mirrorY ? height - y : y)

  // chart root
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(opts.position?.x ?? 2, opts.position?.y ?? 1, opts.position?.z ?? 3)
  })

  // creazione rettangoli (larghezza, altezza, coordinata x, coordinata y, inclinazione della linea, colore)
  function addRect(w: number, h: number, x: number, y: number, col: Color4, isBar: boolean) {
    const e = engine.addEntity()
    Transform.create(e, {
      parent: root,
      position: Vector3.create(mapX(x), isBar ? mapY(y+0.01):mapY(y), isBar ? zOffset:0),
      scale: Vector3.create(w, isBar ? h-0.01:h, 1)
    })
    MeshRenderer.setPlane(e)
    Material.setBasicMaterial(e, { diffuseColor: col })
    return e
  }

  // assi
  addRect(width, 0.02, width / 2, 0, axisColor, false)   // X
  addRect(0.02, height, 0, height / 2, axisColor, false) // Y

  // griglia
  if (withGrid) {
    for (let v = 1; v < yMax; v++) {
      const y = (v / yMax) * height
      addRect(width, 0.01, width / 2, y, Color4.create(0.82, 0.82, 0.82, 1), false)
    }
  }

  // labels Y
  if (withLabels) {
    const tickEvery = Math.max(1, Math.round(yMax / 5))
    for (let v = 0; v <= yMax; v += tickEvery) {
      const label = engine.addEntity()
      Transform.create(label, {
        parent: root,
        position: Vector3.create(mapX(-0.12), (v / yMax) * height, 0),
        rotation: Quaternion.fromEulerDegrees(0, mirrorX ? 180:0, 0)
      })
      TextShape.create(label, {
        text: String(v),
        fontSize: 1,
        textColor: Color4.create(0, 0, 0, 1)
      })
    }
  }

  if (data.length === 0) return root

  // bar sizing
  const n = data.length
  const slotW = width / n
  const gap = Math.min(Math.max(barPadding, 0), 0.4) * slotW
  const barW = Math.max(slotW - gap, slotW * 0.1)
  const toH = (v: number) => Math.max(0, Math.min(height, (v / yMax) * height))

  // bars
  for (let i = 0; i < n; i++) {
    const h = toH(data[i].value)
    const centerX = i * slotW + slotW / 2
    addRect(barW, Math.max(h, 0.001), centerX, h / 2, barColor, true)
  }

  return root
}
// opzioni specifiche per il donut chart tricolore
export type TriColorDonutChartOpts = {
  position?: { x: number; y: number; z: number }  // chart world position
  negativeCount?: number                           // numero di label negative
  neutralCount?: number                            // numero di label neutrali
  positiveCount?: number                           // numero di label positive
  outerRadius?: number                             // raggio esterno in metri (default 1)
  innerRadius?: number                             // raggio interno / foro (default 0.6)
  segments?: number                                // segments used to approximate the circle (default 72)
  negativeColor?: Color4                           // negative part color (default red)
  neutralColor?: Color4                            // neutral part color (default gray)
  positiveColor?: Color4                           // positive part color (default green)
  zOffset?: number
}

// Crea un donut chart tricolore suddiviso in tre sezioni:
//   red     -> negative labels
//   gray    -> neutral labels
//   green   -> positive labels
// The chart does not show any text labels.
export function addTriColorDonutChart3D(opts: TriColorDonutChartOpts = {}) {
  const negativeCount  = Math.max(0, opts.negativeCount  ?? 0)
  const neutralCount   = Math.max(0, opts.neutralCount   ?? 0)
  const positiveCount  = Math.max(0, opts.positiveCount  ?? 0)
  const total          = negativeCount + neutralCount + positiveCount

  const outerRadius    = opts.outerRadius ?? 1
  const innerRadius    = opts.innerRadius ?? 0.6
  const segments       = opts.segments   ?? 128
  const zOffset        = opts.zOffset    ?? 0

  const negativeColor  = opts.negativeColor ?? Color4.create(0.87, 0.20, 0.18, 1)  // red
  const neutralColor   = opts.neutralColor  ?? Color4.create(0.83, 0.82, 0.78, 1)  // gray
  const positiveColor  = opts.positiveColor ?? Color4.create(0.49, 0.67, 0.16, 1)  // green

  // chart root
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(
      opts.position?.x ?? 8,
      opts.position?.y ?? 1.5,
      opts.position?.z ?? 8
    )
  })

  // If there is no data, show everything in gray
  const negSeg = total > 0 ? Math.round((negativeCount / total) * segments) : 0
  const neuSeg = total > 0 ? Math.round((neutralCount  / total) * segments) : segments
  const posSeg = segments - negSeg - neuSeg  // remaining segments go to green to avoid rounding issues

  // each category lives on a slightly different plane
  const midRadius     = (outerRadius + innerRadius) / 2
  const ringThickness = outerRadius - innerRadius
  // larghezza dell'arco al raggio medio, con leggera sovrapposizione per evitare gap
  const arcWidth = (2 * Math.PI * midRadius / segments) * 1.25

  function colorForSegment(i: number): Color4 {
    if (i < negSeg)              return negativeColor
    if (i < negSeg + neuSeg)     return neutralColor
    return positiveColor
  }

  for (let i = 0; i < segments; i++) {
    // angolo: parte dall'alto (Y+, ore 12) e scende in senso orario
    const angle  = Math.PI / 2 + (i / segments) * 2 * Math.PI
    const cx     = Math.cos(angle) * midRadius
    const cy     = Math.sin(angle) * midRadius
    const rotDeg = (angle * 180) / Math.PI - 90

    const seg = engine.addEntity()
    Transform.create(seg, {
      parent: root,
      position: Vector3.create(cx, cy, zOffset),
      rotation: Quaternion.fromEulerDegrees(0, 0, rotDeg),
      scale:    Vector3.create(arcWidth, ringThickness, 1)
    })
    MeshRenderer.setPlane(seg)
    Material.setBasicMaterial(seg, { diffuseColor: colorForSegment(i) })
  }

  return root
}

// mappa ogni fascia di sentiment a un'immagine
const SENTIMENT_IMAGES: Record<string, string> = {
  Awful:   'assets/images/awful_emoji.png',
  Bad:     'assets/images/bad_emoji.png',
  Neutral: 'assets/images/neutral_emoji.png',
  Good:    'assets/images/good_emoji.png',
  Great:   'assets/images/great_emoji.png',
  Unknown: 'assets/images/unknown_emoji.png',
}

export type SentimentImageOpts = {
  position?: { x: number; y: number; z: number }
  rotation?: { x: number; y: number; z: number }  // gradi euleriani
  scale?:    { x: number; y: number; z: number }
}

const SENTIMENT_IMAGE_INACTIVE_Y_OFFSET = -50

let sentimentImageEntities: Record<string, Entity | null> = {}

function getSentimentImagePosition(label: string, activeLabel: string, opts: SentimentImageOpts) {
  const x = opts.position?.x ?? 0
  const y = opts.position?.y ?? 1
  const z = opts.position?.z ?? 0

  // The inactive images stay already rendered but far below the scene.
  // This avoids removing/recreating textured planes at every sentiment change,
  // which was causing a temporary flashing layer.
  return Vector3.create(
    x,
    label === activeLabel ? y : y + SENTIMENT_IMAGE_INACTIVE_Y_OFFSET,
    z
  )
}

function getSentimentImageRotation(opts: SentimentImageOpts) {
  return Quaternion.fromEulerDegrees(
    opts.rotation?.x ?? 0,
    opts.rotation?.y ?? 0,
    opts.rotation?.z ?? 0
  )
}

function getSentimentImageScale(opts: SentimentImageOpts) {
  return Vector3.create(
    opts.scale?.x ?? 1,
    opts.scale?.y ?? 1,
    opts.scale?.z ?? 1
  )
}

function createSentimentImageEntity(label: string, activeLabel: string, opts: SentimentImageOpts): Entity {
  const src = SENTIMENT_IMAGES[label] ?? SENTIMENT_IMAGES['Unknown']
  const e = engine.addEntity()

  Transform.create(e, {
    position: getSentimentImagePosition(label, activeLabel, opts),
    rotation: getSentimentImageRotation(opts),
    scale: getSentimentImageScale(opts)
  })

  MeshRenderer.setPlane(e)
  Material.setPbrMaterial(e, {
    texture: Material.Texture.Common({
      src,
      filterMode: TextureFilterMode.TFM_BILINEAR,
      wrapMode:   TextureWrapMode.TWM_CLAMP
    }),
    transparencyMode:  MaterialTransparencyMode.MTM_ALPHA_TEST,
    alphaTest: 0.5
  })

  return e
}

function ensureSentimentImages(activeLabel: string, opts: SentimentImageOpts) {
  for (const label of Object.keys(SENTIMENT_IMAGES)) {
    if (!sentimentImageEntities[label]) {
      sentimentImageEntities[label] = createSentimentImageEntity(label, activeLabel, opts)
    }
  }
}

function moveSentimentImages(activeLabel: string, opts: SentimentImageOpts) {
  for (const label of Object.keys(SENTIMENT_IMAGES)) {
    const e = sentimentImageEntities[label]
    if (!e) continue

    const transform = Transform.getMutable(e)
    transform.position = getSentimentImagePosition(label, activeLabel, opts)
    transform.rotation = getSentimentImageRotation(opts)
    transform.scale = getSentimentImageScale(opts)
  }
}

// Creates every sentiment image the first time the graph is used.
// Later refreshes only move the active image into place and keep the others at y - 50.
export function addSentimentImage(value: number, opts: SentimentImageOpts = {}): Entity {
  const label = getSentimentLabel(value)
  const activeLabel = SENTIMENT_IMAGES[label] ? label : 'Unknown'

  ensureSentimentImages(activeLabel, opts)
  moveSentimentImages(activeLabel, opts)

  return sentimentImageEntities[activeLabel] as Entity
}

// Hides every cached sentiment image without destroying it.
// Use this during chart cleanup to avoid texture reload/flicker on the next refresh.
export function hideSentimentImages(opts: SentimentImageOpts = {}) {
  for (const label of Object.keys(SENTIMENT_IMAGES)) {
    const e = sentimentImageEntities[label]
    if (!e) continue

    const transform = Transform.getMutable(e)
    transform.position = Vector3.create(
      opts.position?.x ?? transform.position.x,
      (opts.position?.y ?? 1) + SENTIMENT_IMAGE_INACTIVE_Y_OFFSET,
      opts.position?.z ?? transform.position.z
    )
  }
}

// Full removal is still available if you really need to free the entities.
// Normal refreshes should call hideSentimentImages instead.
export function removeSentimentImages() {
  for (const label of Object.keys(sentimentImageEntities)) {
    const e = sentimentImageEntities[label]
    if (e) engine.removeEntity(e)
  }

  sentimentImageEntities = {}
}

// maps each sentiment to the light color
const SENTIMENT_LIGHT_COLORS: Record<string, Color3> = {
  Awful:   Color3.create(0.87, 0.07, 0.07),   // red scuro
  Bad:     Color3.create(1.00, 0.40, 0.00),   // orange
  Neutral: Color3.create(1.00, 1.00, 0.80),   // bianco caldo
  Good:    Color3.create(0.60, 0.90, 0.30),   // light green
  Great:   Color3.create(0.20, 1.00, 0.40),   // green brillante
  Unknown: Color3.create(1.00, 1.00, 1.00),   // bianco neutro
}

export type SentimentLightOpts = {
  position?: { x: number; y: number; z: number }
  intensity?: number   // candelas, default 16000 ≈ normal light bulb
  range?: number       // metri massimi, default -1 (auto da intensity)
}

export function updateSentimentLight(value: number, opts: SentimentLightOpts = {}) {
  const label = getSentimentLabel(value)
  const color = SENTIMENT_LIGHT_COLORS[label] ?? Color3.White()
  const position = opts.position ?? DEFAULT_SENTIMENT_LIGHT_POSITION

  // If the light already exists, update it in place.
  // This avoids destroying/recreating the entity and keeps the neutral light always available.
  if (sentimentLightEntity) {
    const transform = Transform.getMutable(sentimentLightEntity)
    transform.position = Vector3.create(position.x, position.y, position.z)

    const ls = LightSource.getMutable(sentimentLightEntity)
    ls.color = color
    if (opts.intensity !== undefined) ls.intensity = opts.intensity
    if (opts.range !== undefined) ls.range = opts.range

    return sentimentLightEntity
  }

  // first call: create the light entity
  sentimentLightEntity = engine.addEntity()

  Transform.create(sentimentLightEntity, {
    position: Vector3.create(position.x, position.y, position.z)
  })

  LightSource.create(sentimentLightEntity, {
    type: LightSource.Type.Point({}),
    color,
    intensity: opts.intensity ?? DEFAULT_SENTIMENT_LIGHT_INTENSITY,
    range:     opts.range     ?? -1,
  })

  return sentimentLightEntity
}

export function resetSentimentLightToNeutral(opts: SentimentLightOpts = {}) {
  return updateSentimentLight(NEUTRAL_SENTIMENT_LIGHT_VALUE, {
    position: opts.position ?? DEFAULT_SENTIMENT_LIGHT_POSITION,
    intensity: opts.intensity ?? DEFAULT_SENTIMENT_LIGHT_INTENSITY,
    range: opts.range ?? -1,
  })
}

export function removeSentimentLight() {
  if (sentimentLightEntity) {
    engine.removeEntity(sentimentLightEntity)
    sentimentLightEntity = null
  }
}

// sentiment meter root entity (only one at a time in the scene)
let sentimentMeterEntity: Entity | null = null
 
// opzioni per il sentiment meter (barra orizzontale)
export type SentimentMeterOpts = {
  position?: { x: number; y: number; z: number }  // posizione world
  rotation?: { x: number; y: number; z: number }  // rotazione in gradi (default: 0 0 0)
  width?: number                                   // larghezza totale in metri (default 4)
  barHeight?: number                               // altezza della barra (default 0.25)
  value?: number                                   // current value [0..10]
  showLabels?: boolean                             // mostra etichette zone
  showValue?: boolean                              // show numeric value below the indicator
  zOffset?: number
}
 
// Crea un sentiment meter: barra orizzontale colorata per zone con indicatore a freccia.
// Zones:  0-2 Awful (red)  |  2-3.5 Bad (orange)  |  3.5-7.5 Neutral (yellow)
//        7.5-9 Good (light green)  |  9-10 Great (green)
export function addSentimentMeter3D(opts: SentimentMeterOpts = {}) {
  const width      = opts.width     ?? 4
  const barH       = opts.barHeight ?? 0.25
  const value      = Math.max(0, Math.min(opts.value ?? 5, 10))
  const zOffset    = opts.zOffset   ?? 0
  const showLabels = opts.showLabels ?? true
  const showValue  = opts.showValue  ?? true
 
  // FIX 1: rimuove il meter precedente se esiste (evita sovrapposizioni al refresh)
  if (sentimentMeterEntity) {
    engine.removeEntityWithChildren(sentimentMeterEntity)
    sentimentMeterEntity = null
  }
 
  // chart root
  const root = engine.addEntity()
  sentimentMeterEntity = root          // FIX 1: traccia il root per il prossimo refresh
  Transform.create(root, {
    position: Vector3.create(
      opts.position?.x ?? 0,
      opts.position?.y ?? 1,
      opts.position?.z ?? 0
    ),
    rotation: Quaternion.fromEulerDegrees(
      opts.rotation?.x ?? 0,
      opts.rotation?.y ?? 0,
      opts.rotation?.z ?? 0
    )
  })
 
  // helper: crea un piano (rettangolo piatto)
  function addRect(
    w: number, h: number,
    x: number, y: number,
    col: Color4,
    z: number = zOffset,
    rotZ: number = 0
  ) {
    const e = engine.addEntity()
    Transform.create(e, {
      parent: root,
      position: Vector3.create(x, y, z),
      rotation: Quaternion.fromEulerDegrees(0, 0, rotZ),
      scale: Vector3.create(w, h, 1)
    })
    MeshRenderer.setPlane(e)
    Material.setBasicMaterial(e, { diffuseColor: col })
    return e
  }
 
  // definizione zone: [fromValue, toValue, colore, etichetta]
  const zones: [number, number, Color4, string][] = [
    [0,   2,   Color4.create(0.87, 0.18, 0.15, 1), 'Awful'],    // red
    [2,   3.5, Color4.create(1.00, 0.48, 0.05, 1), 'Bad'],      // orange
    [3.5, 6.5, Color4.create(1.00, 0.82, 0.10, 1), 'Neutral'],  // yellow
    [6.5, 8,   Color4.create(0.55, 0.80, 0.18, 1), 'Good'],     // light green
    [8,   10,  Color4.create(0.15, 0.62, 0.20, 1), 'Great'],    // green
  ]
 
  // converts value [0..10] to X coordinate [0..width]
  const toX = (v: number) => (v / 10) * width
 
  // bars colorate
  for (const [from, to, col] of zones) {
    const segW  = toX(to) - toX(from)
    const segCX = toX(from) + segW / 2
    addRect(segW, barH, segCX, barH / 2, col, zOffset)
  }
 
  // 4 stanghette divisorie
  const dividerValues = [2, 3.5, 6.5, 8]
  const divW = 0.025
  const divH = barH * 1.5
  for (const dv of dividerValues) {
    addRect(divW, divH, toX(dv), barH / 2, Color4.create(0.1, 0.1, 0.1, 1), zOffset - 0.002)
  }
 
  // bordo esterno della barra
  const borderT = 0.02
  addRect(width + borderT * 2, borderT, width / 2, 0,    Color4.create(0.15, 0.15, 0.15, 1), zOffset - 0.001)
  addRect(width + borderT * 2, borderT, width / 2, barH, Color4.create(0.15, 0.15, 0.15, 1), zOffset - 0.001)
  addRect(borderT, barH, 0,     barH / 2, Color4.create(0.15, 0.15, 0.15, 1), zOffset - 0.001)
  addRect(borderT, barH, width, barH / 2, Color4.create(0.15, 0.15, 0.15, 1), zOffset - 0.001)
 
  // etichette zone
  if (showLabels) {
    for (const [from, to, , label] of zones) {
      const cx = toX(from) + (toX(to) - toX(from)) / 2
      const lbl = engine.addEntity()
      Transform.create(lbl, {
        parent: root,
        position: Vector3.create(cx, barH + 0.12, zOffset - 0.005),
      })
      TextShape.create(lbl, {
        text: label,
        fontSize: 1.2,
        textColor: Color4.create(0.1, 0.1, 0.1, 1)
      })
    }
  }
 
  // indicatore a freccia verso l'alto (^)
  const needleX   = toX(value)
  const arrowSize = barH * 0.55
  const arrowY    = -arrowSize * 0.7       // sotto la barra
 
  const armLen = arrowSize * 1.1
  const armH   = armLen * 0.22
 
  // FIX 2: swap rotations — +40/-40 forms "^" pointing upward
  // braccio sinistro (/)
  addRect(armLen, armH, needleX - arrowSize * 0.35, arrowY, Color4.create(0.1, 0.1, 0.1, 1), zOffset - 0.003, +40)
  // braccio destro (\)
  addRect(armLen, armH, needleX + arrowSize * 0.35, arrowY, Color4.create(0.1, 0.1, 0.1, 1), zOffset - 0.003, -40)
 
  // stelo verticale
  const stemH = arrowSize * 0.6
  addRect(armH * 0.9, stemH, needleX, -stemH * 0.3, Color4.create(0.1, 0.1, 0.1, 1), zOffset - 0.003)
 
  // numeric value below the indicator
  if (showValue) {
    const valLabel = engine.addEntity()
    Transform.create(valLabel, {
      parent: root,
      position: Vector3.create(needleX, arrowY - arrowSize * 0.85, zOffset - 0.005),
    })
    TextShape.create(valLabel, {
      text: value.toFixed(1),
      fontSize: 1.5,
      textColor: Color4.create(0.1, 0.1, 0.1, 1)
    })
  }
 
  return root
}

export function removeSentimentMeter3D() {
  if (sentimentMeterEntity) {
    engine.removeEntityWithChildren(sentimentMeterEntity)
    sentimentMeterEntity = null
  }
}


// maps a value [0..10] to the sentiment color
function sentimentToColor(v: number): Color4 {
  if (v < 2)   return Color4.create(0.87, 0.18, 0.15, 1)  // red        – Awful
  if (v < 3.5) return Color4.create(1.00, 0.48, 0.05, 1)  // orange      – Bad
  if (v < 6.5) return Color4.create(1.00, 0.82, 0.10, 1)  // yellow      – Neutral
  if (v < 8)   return Color4.create(0.55, 0.80, 0.18, 1)  // light green – Good
               return Color4.create(0.15, 0.62, 0.20, 1)  // green        – Great
}
 
export type HeatmapChartOpts = {
  position?:   { x: number; y: number; z: number }
  rotation?:   { x: number; y: number; z: number }
  cellSize?:   number   // lato di ogni slot in metri        (default 0.30)
  borderT?:    number   // spessore bordo tra celle in metri (default 0.012)
  showValues?: boolean  // show numeric value in each cell
  maxItems?:   number   // se definito usa solo gli ultimi N elementi
  zOffset?:    number
}
 
// Creates a dynamically computed N×M temporal heatmap grid.
// No gap between cells: the border comes from a single dark background plane.
// Oldest cell: bottom left. Newest: top right.
export function addHeatmapChart3D(data: DataPoint[], opts: HeatmapChartOpts = {}) {
  const cellSize   = opts.cellSize   ?? 0.30
  const borderT    = opts.borderT    ?? 0.005
  const showValues = opts.showValues ?? false
  const zOffset    = opts.zOffset    ?? 0
 
  const slice = opts.maxItems !== undefined ? data.slice(-opts.maxItems) : data.slice()
  const N = slice.length
 
  // root (even if empty, it returns a valid entity)
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(opts.position?.x ?? 0, opts.position?.y ?? 1, opts.position?.z ?? 0),
    rotation: Quaternion.fromEulerDegrees(opts.rotation?.x ?? 0, opts.rotation?.y ?? 0, opts.rotation?.z ?? 0)
  })
 
  if (N === 0) return root
 
  // fixed 20×15 grid = 300 slots
  const cols = 22
  const rows = 14
 
  // colored cells — slightly smaller than the slot to show the border
  const visualSize = cellSize - borderT
 
  for (let idx = 0; idx < N; idx++) {
    // slotFromEnd=0 -> newest (bottom-right), slotFromEnd=N-1 -> oldest
    const slotFromEnd = N - 1 - idx
    const gridCol = cols - 1 - (slotFromEnd % cols)          // riempie da destra a sinistra
    const gridRow = Math.floor(slotFromEnd / cols)           // riempie dal basso verso l'alto
    const cx = gridCol * cellSize + cellSize / 2
    const cy = gridRow * cellSize + cellSize / 2
    const dp  = slice[idx]
 
    const cell = engine.addEntity()
    Transform.create(cell, {
      parent: root,
      position: Vector3.create(cx, cy, zOffset),
      scale:    Vector3.create(visualSize, visualSize, 1)
    })
    MeshRenderer.setPlane(cell)
    Material.setBasicMaterial(cell, { diffuseColor: sentimentToColor(dp.value) })
 
    if (showValues) {
      const lbl = engine.addEntity()
      Transform.create(lbl, {
        parent: root,
        position: Vector3.create(cx, cy, zOffset - 0.005),
      })
      TextShape.create(lbl, {
        text: dp.value.toFixed(1),
        fontSize: 0.85,
        textColor: Color4.create(0.05, 0.05, 0.05, 1)
      })
    }
  }
 
  return root
}