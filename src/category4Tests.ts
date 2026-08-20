import { executeTask } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/src/players'

export type Category4TemporalGraph = 'bar-chart' | 'heatmap'
export type Category4TrendAnswer = 'improving' | 'worsening' | 'stable' | 'unclear'
export type Category4AnomalyAnswer = 'none' | 'early' | 'middle' | 'late'
export type Category4ServerTestId = 'cat4-temporal'

export type Category4TemporalPoint = {
  id: number
  value: number
}

export type Category4TemporalTrial = {
  trialIndex: number
  graph: Category4TemporalGraph
  graphLabel: string
  scenarioId: string
  scenarioLabel: string
  values: Category4TemporalPoint[]
  expectedTrend: Category4TrendAnswer
  expectedAnomaly: Category4AnomalyAnswer
}

export type Category4TemporalUiState =
  | { phase: 'hidden' }
  | {
      phase: 'countdown'
      testId: Category4ServerTestId
      trialIndex: number
      totalTrials: number
      countdownEndAtMs: number
      graphLabel: string
    }
  | {
      phase: 'trial'
      testId: Category4ServerTestId
      trialIndex: number
      totalTrials: number
      graphLabel: string
    }
  | {
      phase: 'finished'
      testId: Category4ServerTestId
      trialIndex: number
      totalTrials: number
    }

export type Category4TemporalDeps = {
  serverUrl: string
  clearAllCharts: () => void
  drawTrialGraph: (trial: Category4TemporalTrial) => void
  setUiState: (state: Category4TemporalUiState) => void
  setAnswerHandler: (
    handler: ((trend: Category4TrendAnswer, anomaly: Category4AnomalyAnswer) => void) | undefined
  ) => void
  onFinished?: () => void
}

type Category4ScenarioDef = {
  scenarioId: string
  scenarioLabel: string
  values: Category4TemporalPoint[]
  expectedTrend: Category4TrendAnswer
  expectedAnomaly: Category4AnomalyAnswer
}

type Category4TemporalSession = {
  runId: string
  address: string
  serverTestId: Category4ServerTestId
  trials: Category4TemporalTrial[]
  currentTrialArrayIndex: number
  shownAtClientMs: number
  drawnTrialKey?: string
}

const SERVER_TEST_ID: Category4ServerTestId = 'cat4-temporal'
const COUNTDOWN_MS = 3000
const SERIES_LENGTH = 300

const GRAPH_SEQUENCE: Array<{ graph: Category4TemporalGraph; graphLabel: string }> = [
  { graph: 'bar-chart', graphLabel: 'Bar chart' },
  { graph: 'heatmap', graphLabel: 'Heatmap' },
  { graph: 'bar-chart', graphLabel: 'Bar chart' },
  { graph: 'heatmap', graphLabel: 'Heatmap' },
  { graph: 'bar-chart', graphLabel: 'Bar chart' },
  { graph: 'heatmap', graphLabel: 'Heatmap' },
]

let activeDeps: Category4TemporalDeps | null = null
let category4Session: Category4TemporalSession | null = null
let countdownToken = 0
let answerLocked = false

function waitMs(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function roundToOneDecimal(value: number) {
  return Number(value.toFixed(1))
}

function clampValue(value: number) {
  return Math.max(0, Math.min(10, roundToOneDecimal(value)))
}

function makeSeries(generator: (index: number, t: number) => number): Category4TemporalPoint[] {
  const result: Category4TemporalPoint[] = []

  for (let i = 0; i < SERIES_LENGTH; i++) {
    const t = SERIES_LENGTH <= 1 ? 0 : i / (SERIES_LENGTH - 1)
    result.push({
      id: i + 1,
      value: clampValue(generator(i, t)),
    })
  }

  return result
}

function buildScenarios(): Category4ScenarioDef[] {
  return [
    {
      scenarioId: 'improving-uniform',
      scenarioLabel: 'Uniform improvement',
      values: makeSeries((_i, t) => 2 + 6 * t),
      expectedTrend: 'improving',
      expectedAnomaly: 'none',
    },
    {
      scenarioId: 'worsening-uniform',
      scenarioLabel: 'Uniform worsening',
      values: makeSeries((_i, t) => 8 - 6 * t),
      expectedTrend: 'worsening',
      expectedAnomaly: 'none',
    },
    {
      scenarioId: 'stable-low-noise',
      scenarioLabel: 'Stable with low noise',
      values: makeSeries((i) => 5 + 0.35 * Math.sin(i * 0.65)),
      expectedTrend: 'stable',
      expectedAnomaly: 'none',
    },
    {
      scenarioId: 'stable-high-noise',
      scenarioLabel: 'Stable with high noise',
      values: makeSeries((i) => 5 + 1.25 * Math.sin(i * 0.73) + 0.65 * Math.sin(i * 1.91)),
      expectedTrend: 'stable',
      expectedAnomaly: 'none',
    },
    {
      scenarioId: 'improving-with-negative-spike',
      scenarioLabel: 'Improvement with an isolated negative spike',
      values: makeSeries((i, t) => {
        const base = 3.2 + 4.6 * t
        const center = Math.floor(SERIES_LENGTH * 0.55)
        const distance = Math.abs(i - center)
        const spike = distance <= 2 ? 4.2 - distance * 1.3 : 0
        return base - spike
      }),
      expectedTrend: 'improving',
      expectedAnomaly: 'middle',
    },
    {
      scenarioId: 'periodic-oscillation',
      scenarioLabel: 'Periodic oscillation',
      values: makeSeries((i) => 5 + 2.2 * Math.sin((2 * Math.PI * i) / 16)),
      expectedTrend: 'stable',
      expectedAnomaly: 'none',
    },
  ]
}

function shuffleScenarios(items: Category4ScenarioDef[]) {
  const copy = [...items]

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = copy[i]
    copy[i] = copy[j]
    copy[j] = tmp
  }

  return copy
}

function buildCategory4Trials(): Category4TemporalTrial[] {
  const scenarios = shuffleScenarios(buildScenarios())

  return scenarios.map((scenario, index) => {
    const graphDef = GRAPH_SEQUENCE[index]

    return {
      trialIndex: index + 1,
      graph: graphDef.graph,
      graphLabel: graphDef.graphLabel,
      scenarioId: scenario.scenarioId,
      scenarioLabel: scenario.scenarioLabel,
      values: scenario.values,
      expectedTrend: scenario.expectedTrend,
      expectedAnomaly: scenario.expectedAnomaly,
    }
  })
}

function createRunId(address: string) {
  const addressPart = String(address || 'unknown').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
  return `${SERVER_TEST_ID}_${Date.now()}_${addressPart || 'unknown'}`
}

function getCurrentAddress() {
  const player = getPlayer()
  return player?.userId ?? 'unknown'
}

function saveCategory4TrialPlan(session: Category4TemporalSession, deps: Category4TemporalDeps) {
  const plan = {
    runId: session.runId,
    address: session.address,
    testId: session.serverTestId,
    totalTrials: session.trials.length,
    trials: session.trials.map((trial) => ({
      trialIndex: trial.trialIndex,
      graph: trial.graph,
      graphLabel: trial.graphLabel,
      scenarioId: trial.scenarioId,
      scenarioLabel: trial.scenarioLabel,
      expectedTrend: trial.expectedTrend,
      expectedAnomaly: trial.expectedAnomaly,
      values: trial.values,
    })),
    design: '6 scenarios; 3 assigned to bar chart and 3 assigned to heatmap; graph type alternates every trial.',
    createdAtClient: new Date().toISOString(),
  }

  executeTask(async () => {
    try {
      const res = await fetch(`${deps.serverUrl}/experiment/trial-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plan),
      })

      if (!res.ok) {
        console.log('[CATEGORY4] Error saving trial plan:', res.status)
      }
    } catch (err) {
      console.log('[CATEGORY4] Fetch error /experiment/trial-plan', err)
    }
  })
}

function sendCategory4Response(response: Record<string, unknown>, deps: Category4TemporalDeps) {
  executeTask(async () => {
    try {
      const res = await fetch(`${deps.serverUrl}/experiment/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response),
      })

      if (!res.ok) {
        console.log('[CATEGORY4] Error saving response:', res.status)
      }
    } catch (err) {
      console.log('[CATEGORY4] Fetch error /experiment/response', err)
    }
  })
}

function showNextCategory4Trial() {
  const deps = activeDeps
  const session = category4Session
  if (!deps || !session) return

  if (session.currentTrialArrayIndex >= session.trials.length) {
    finishCategory4TemporalExperiment()
    return
  }

  deps.clearAllCharts()
  answerLocked = true
  session.drawnTrialKey = undefined

  const trial = session.trials[session.currentTrialArrayIndex]
  const countdownEndAtMs = Date.now() + COUNTDOWN_MS
  const token = ++countdownToken

  deps.setUiState({
    phase: 'countdown',
    testId: session.serverTestId,
    trialIndex: trial.trialIndex,
    totalTrials: session.trials.length,
    countdownEndAtMs,
    graphLabel: trial.graphLabel,
  })

  executeTask(async () => {
    await waitMs(COUNTDOWN_MS)

    if (token !== countdownToken) return
    if (!category4Session) return
    if (category4Session.runId !== session.runId) return

    showCurrentCategory4Trial()
  })
}

function showCurrentCategory4Trial() {
  const deps = activeDeps
  const session = category4Session
  if (!deps || !session) return

  const trial = session.trials[session.currentTrialArrayIndex]
  if (!trial) {
    finishCategory4TemporalExperiment()
    return
  }

  const drawKey = `${session.runId}:${trial.trialIndex}`
  if (session.drawnTrialKey === drawKey) return

  session.drawnTrialKey = drawKey
  deps.clearAllCharts()
  deps.drawTrialGraph(trial)

  session.shownAtClientMs = Date.now()
  answerLocked = false

  deps.setUiState({
    phase: 'trial',
    testId: session.serverTestId,
    trialIndex: trial.trialIndex,
    totalTrials: session.trials.length,
    graphLabel: trial.graphLabel,
  })
}

function handleCategory4Answer(trend: Category4TrendAnswer, anomaly: Category4AnomalyAnswer) {
  const deps = activeDeps
  const session = category4Session
  if (!deps || !session || answerLocked) return

  const trial = session.trials[session.currentTrialArrayIndex]
  if (!trial) return

  answerLocked = true

  const answeredAtClientMs = Date.now()
  const responseTimeMs = answeredAtClientMs - session.shownAtClientMs
  const isTrendCorrect = trend === trial.expectedTrend
  const isAnomalyCorrect = anomaly === trial.expectedAnomaly
  const isCorrect = isTrendCorrect && isAnomalyCorrect

  const response = {
    runId: session.runId,
    address: session.address,
    testId: session.serverTestId,
    trialIndex: trial.trialIndex,
    totalTrials: session.trials.length,

    graph: trial.graph,
    graphLabel: trial.graphLabel,
    scenarioId: trial.scenarioId,
    scenarioLabel: trial.scenarioLabel,

    expectedTrend: trial.expectedTrend,
    selectedTrend: trend,
    isTrendCorrect,

    expectedAnomaly: trial.expectedAnomaly,
    selectedAnomaly: anomaly,
    isAnomalyCorrect,

    isCorrect,
    accuracyType: isCorrect ? 'correct' : 'wrong',

    shownAtClientMs: session.shownAtClientMs,
    answeredAtClientMs,
    responseTimeMs,
    createdAtClient: new Date().toISOString(),
  }

  sendCategory4Response(response, deps)

  session.currentTrialArrayIndex++
  showNextCategory4Trial()
}

function finishCategory4TemporalExperiment() {
  const deps = activeDeps
  const session = category4Session
  if (!deps || !session) return

  const totalTrials = session.trials.length

  deps.clearAllCharts()
  deps.setAnswerHandler(undefined)
  deps.setUiState({
    phase: 'finished',
    testId: session.serverTestId,
    trialIndex: totalTrials,
    totalTrials,
  })

  category4Session = null
  answerLocked = false
  deps.onFinished?.()
}

export function startCategory4TemporalExperiment(deps: Category4TemporalDeps) {
  stopCategory4TemporalExperiment(false)

  activeDeps = deps
  deps.clearAllCharts()

  const address = getCurrentAddress()

  const session: Category4TemporalSession = {
    runId: createRunId(address),
    address,
    serverTestId: SERVER_TEST_ID,
    trials: buildCategory4Trials(),
    currentTrialArrayIndex: 0,
    shownAtClientMs: 0,
  }

  category4Session = session
  answerLocked = false

  deps.setAnswerHandler(handleCategory4Answer)
  saveCategory4TrialPlan(session, deps)
  showNextCategory4Trial()
}

export function stopCategory4TemporalExperiment(clearCharts = true) {
  countdownToken++
  category4Session = null
  answerLocked = false

  if (activeDeps) {
    activeDeps.setUiState({ phase: 'hidden' })
    activeDeps.setAnswerHandler(undefined)
    if (clearCharts) activeDeps.clearAllCharts()
  }

  activeDeps = null
}

export function isCategory4TemporalExperimentActive() {
  return category4Session !== null
}
