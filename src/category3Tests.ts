import { executeTask } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/src/players'

export type Category3QuantitativeGraph = 'simple-donut' | 'sentiment-meter'
export type Category3ClientTestId = 'test-3-1' | 'test-3-2'
export type Category3QuantitativeServerTestId = 'cat3-test-3-1' | 'cat3-test-3-2'
export type Category3ComparisonChoice = Category3QuantitativeGraph

export type Category3EstimationTrial = {
  kind: 'estimation'
  trialIndex: number
  graph: Category3QuantitativeGraph
  graphLabel: string
  value: number
}

export type Category3ComparisonTrial = {
  kind: 'comparison'
  trialIndex: number
  leftGraph: Category3QuantitativeGraph
  leftGraphLabel: string
  leftValue: number
  rightGraph: Category3QuantitativeGraph
  rightGraphLabel: string
  rightValue: number
  expectedChoice: Category3ComparisonChoice
  expectedDistance: number
  delta: number
}

export type Category3QuantitativeTrial = Category3EstimationTrial | Category3ComparisonTrial

export type Category3QuantitativeUiState =
  | { phase: 'hidden' }
  | {
      phase: 'countdown'
      testId: Category3QuantitativeServerTestId
      trialIndex: number
      totalTrials: number
      countdownEndAtMs: number
      graphLabel: string
    }
  | {
      phase: 'trial'
      testId: 'cat3-test-3-1'
      trialIndex: number
      totalTrials: number
      graphLabel: string
    }
  | {
      phase: 'comparison'
      testId: 'cat3-test-3-2'
      trialIndex: number
      totalTrials: number
      leftGraphLabel: string
      rightGraphLabel: string
    }
  | {
      phase: 'finished'
      testId: Category3QuantitativeServerTestId
      trialIndex: number
      totalTrials: number
    }

export type Category3QuantitativeDeps = {
  serverUrl: string
  clearAllCharts: () => void
  drawTrialGraph: (trial: Category3QuantitativeTrial) => void
  setUiState: (state: Category3QuantitativeUiState) => void
  setNumericHandler: (handler: ((value: number) => void) | undefined) => void
  setComparisonHandler: (handler: ((choice: Category3ComparisonChoice, distance: number) => void) | undefined) => void
  onFinished?: () => void
}

type Category3QuantitativeSession = {
  runId: string
  address: string
  clientTestId: Category3ClientTestId
  serverTestId: Category3QuantitativeServerTestId
  trials: Category3QuantitativeTrial[]
  currentTrialArrayIndex: number
  shownAtClientMs: number
  drawnTrialKey?: string
}

const COUNTDOWN_MS = 3000

const CATEGORY3_GRAPHS: Array<{ graph: Category3QuantitativeGraph; graphLabel: string }> = [
  { graph: 'simple-donut', graphLabel: 'Simple donut' },
  { graph: 'sentiment-meter', graphLabel: 'Sentiment meter' },
]

// Test 3.1: value estimation across the 0-10 scale.
// Total: 2 graphs x 6 values = 12 trials.
const CATEGORY3_TEST31_VALUES = [1.2, 2.6, 4.1, 5.8, 7.4, 9.0]

// Test 3.2: orientation + distance estimation with increasing deltas.
// Total: 4 deltas x 2 directions = 8 trials.
const CATEGORY3_TEST32_DELTAS = [0.2, 0.5, 1.0, 2.0]
const CATEGORY3_TEST32_BASE_VALUE = 5.0

let activeDeps: Category3QuantitativeDeps | null = null
let category3Session: Category3QuantitativeSession | null = null
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

function serverTestIdFromClient(testId: Category3ClientTestId): Category3QuantitativeServerTestId {
  return testId === 'test-3-2' ? 'cat3-test-3-2' : 'cat3-test-3-1'
}

function shuffleCategory3Trials(trials: Category3QuantitativeTrial[]) {
  const copy = [...trials]

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = copy[i]
    copy[i] = copy[j]
    copy[j] = tmp
  }

  return copy.map((trial, index) => ({
    ...trial,
    trialIndex: index + 1,
  }))
}

function buildCategory3Test31Trials(): Category3QuantitativeTrial[] {
  const trials: Category3QuantitativeTrial[] = []

  for (const graphDef of CATEGORY3_GRAPHS) {
    for (const value of CATEGORY3_TEST31_VALUES) {
      trials.push({
        kind: 'estimation',
        trialIndex: 0,
        graph: graphDef.graph,
        graphLabel: graphDef.graphLabel,
        value,
      })
    }
  }

  return shuffleCategory3Trials(trials)
}

function buildCategory3Test32Trials(): Category3QuantitativeTrial[] {
  const trials: Category3QuantitativeTrial[] = []

  for (const delta of CATEGORY3_TEST32_DELTAS) {
    const lowValue = roundToOneDecimal(CATEGORY3_TEST32_BASE_VALUE - delta / 2)
    const highValue = roundToOneDecimal(CATEGORY3_TEST32_BASE_VALUE + delta / 2)

    trials.push({
      kind: 'comparison',
      trialIndex: 0,
      leftGraph: 'simple-donut',
      leftGraphLabel: 'Simple donut',
      leftValue: highValue,
      rightGraph: 'sentiment-meter',
      rightGraphLabel: 'Sentiment meter',
      rightValue: lowValue,
      expectedChoice: 'simple-donut',
      expectedDistance: roundToOneDecimal(delta),
      delta: roundToOneDecimal(delta),
    })

    trials.push({
      kind: 'comparison',
      trialIndex: 0,
      leftGraph: 'simple-donut',
      leftGraphLabel: 'Simple donut',
      leftValue: lowValue,
      rightGraph: 'sentiment-meter',
      rightGraphLabel: 'Sentiment meter',
      rightValue: highValue,
      expectedChoice: 'sentiment-meter',
      expectedDistance: roundToOneDecimal(delta),
      delta: roundToOneDecimal(delta),
    })
  }

  return shuffleCategory3Trials(trials)
}

function buildCategory3Trials(testId: Category3ClientTestId): Category3QuantitativeTrial[] {
  return testId === 'test-3-2'
    ? buildCategory3Test32Trials()
    : buildCategory3Test31Trials()
}

function createRunId(serverTestId: Category3QuantitativeServerTestId, address: string) {
  const addressPart = String(address || 'unknown').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
  return `${serverTestId}_${Date.now()}_${addressPart || 'unknown'}`
}

function getCurrentAddress() {
  const player = getPlayer()
  return player?.userId ?? 'unknown'
}

function trialForPlan(trial: Category3QuantitativeTrial) {
  if (trial.kind === 'estimation') {
    return {
      kind: trial.kind,
      trialIndex: trial.trialIndex,
      graph: trial.graph,
      graphLabel: trial.graphLabel,
      value: trial.value,
      expectedValue: trial.value,
    }
  }

  return {
    kind: trial.kind,
    trialIndex: trial.trialIndex,
    leftGraph: trial.leftGraph,
    leftGraphLabel: trial.leftGraphLabel,
    leftValue: trial.leftValue,
    rightGraph: trial.rightGraph,
    rightGraphLabel: trial.rightGraphLabel,
    rightValue: trial.rightValue,
    expectedChoice: trial.expectedChoice,
    expectedDistance: trial.expectedDistance,
    delta: trial.delta,
  }
}

function saveCategory3TrialPlan(session: Category3QuantitativeSession, deps: Category3QuantitativeDeps) {
  const plan = {
    runId: session.runId,
    address: session.address,
    testId: session.serverTestId,
    clientTestId: session.clientTestId,
    totalTrials: session.trials.length,
    trials: session.trials.map(trialForPlan),
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
        console.log('[CATEGORY3] Error saving trial plan:', res.status)
      }
    } catch (err) {
      console.log('[CATEGORY3] Fetch error /experiment/trial-plan', err)
    }
  })
}

function sendCategory3Response(response: Record<string, unknown>, deps: Category3QuantitativeDeps) {
  executeTask(async () => {
    try {
      const res = await fetch(`${deps.serverUrl}/experiment/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response),
      })

      if (!res.ok) {
        console.log('[CATEGORY3] Error saving response:', res.status)
      }
    } catch (err) {
      console.log('[CATEGORY3] Fetch error /experiment/response', err)
    }
  })
}

function showNextCategory3Trial() {
  const deps = activeDeps
  const session = category3Session
  if (!deps || !session) return

  if (session.currentTrialArrayIndex >= session.trials.length) {
    finishCategory3QuantitativeExperiment()
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
    graphLabel: trial.kind === 'comparison'
      ? 'Simple donut vs Sentiment meter'
      : trial.graphLabel,
  })

  executeTask(async () => {
    await waitMs(COUNTDOWN_MS)

    if (token !== countdownToken) return
    if (!category3Session) return
    if (category3Session.runId !== session.runId) return

    showCurrentCategory3Trial()
  })
}

function showCurrentCategory3Trial() {
  const deps = activeDeps
  const session = category3Session
  if (!deps || !session) return

  const trial = session.trials[session.currentTrialArrayIndex]
  if (!trial) {
    finishCategory3QuantitativeExperiment()
    return
  }

  const drawKey = `${session.runId}:${trial.trialIndex}`
  if (session.drawnTrialKey === drawKey) {
    return
  }

  session.drawnTrialKey = drawKey
  deps.clearAllCharts()
  deps.drawTrialGraph(trial)

  session.shownAtClientMs = Date.now()
  answerLocked = false

  if (trial.kind === 'comparison') {
    deps.setUiState({
      phase: 'comparison',
      testId: 'cat3-test-3-2',
      trialIndex: trial.trialIndex,
      totalTrials: session.trials.length,
      leftGraphLabel: trial.leftGraphLabel,
      rightGraphLabel: trial.rightGraphLabel,
    })
    return
  }

  deps.setUiState({
    phase: 'trial',
    testId: 'cat3-test-3-1',
    trialIndex: trial.trialIndex,
    totalTrials: session.trials.length,
    graphLabel: trial.graphLabel,
  })
}

function handleCategory3NumericAnswer(selectedValue: number) {
  const deps = activeDeps
  const session = category3Session
  if (!deps || !session || answerLocked) return

  const trial = session.trials[session.currentTrialArrayIndex]
  if (!trial || trial.kind !== 'estimation') return

  answerLocked = true

  const selectedValueRounded = roundToOneDecimal(selectedValue)
  const answeredAtClientMs = Date.now()
  const responseTimeMs = answeredAtClientMs - session.shownAtClientMs
  const absoluteError = roundToOneDecimal(Math.abs(selectedValueRounded - trial.value))
  const signedError = roundToOneDecimal(selectedValueRounded - trial.value)

  const response = {
    runId: session.runId,
    address: session.address,
    testId: session.serverTestId,
    clientTestId: session.clientTestId,
    trialIndex: trial.trialIndex,
    totalTrials: session.trials.length,

    graph: trial.graph,
    graphLabel: trial.graphLabel,
    stimulusValue: trial.value,

    expectedValue: trial.value,
    selectedValue: selectedValueRounded,
    absoluteError,
    signedError,
    isExactValue: selectedValueRounded === trial.value,

    shownAtClientMs: session.shownAtClientMs,
    answeredAtClientMs,
    responseTimeMs,
    createdAtClient: new Date().toISOString(),
  }

  sendCategory3Response(response, deps)

  session.currentTrialArrayIndex++
  showNextCategory3Trial()
}

function handleCategory3ComparisonAnswer(choice: Category3ComparisonChoice, distance: number) {
  const deps = activeDeps
  const session = category3Session
  if (!deps || !session || answerLocked) return

  const trial = session.trials[session.currentTrialArrayIndex]
  if (!trial || trial.kind !== 'comparison') return

  answerLocked = true

  const selectedDistance = roundToOneDecimal(distance)
  const answeredAtClientMs = Date.now()
  const responseTimeMs = answeredAtClientMs - session.shownAtClientMs
  const isChoiceCorrect = choice === trial.expectedChoice
  const distanceAbsoluteError = roundToOneDecimal(Math.abs(selectedDistance - trial.expectedDistance))
  const distanceSignedError = roundToOneDecimal(selectedDistance - trial.expectedDistance)

  const response = {
    runId: session.runId,
    address: session.address,
    testId: session.serverTestId,
    clientTestId: session.clientTestId,
    trialIndex: trial.trialIndex,
    totalTrials: session.trials.length,

    leftGraph: trial.leftGraph,
    leftGraphLabel: trial.leftGraphLabel,
    leftValue: trial.leftValue,
    rightGraph: trial.rightGraph,
    rightGraphLabel: trial.rightGraphLabel,
    rightValue: trial.rightValue,

    expectedChoice: trial.expectedChoice,
    selectedChoice: choice,
    isChoiceCorrect,

    expectedDistance: trial.expectedDistance,
    selectedDistance,
    distanceAbsoluteError,
    distanceSignedError,

    isCorrect: isChoiceCorrect,
    accuracyType: isChoiceCorrect ? 'correct' : 'wrong',

    shownAtClientMs: session.shownAtClientMs,
    answeredAtClientMs,
    responseTimeMs,
    createdAtClient: new Date().toISOString(),
  }

  sendCategory3Response(response, deps)

  session.currentTrialArrayIndex++
  showNextCategory3Trial()
}

function finishCategory3QuantitativeExperiment() {
  const deps = activeDeps
  const session = category3Session
  if (!deps || !session) return

  const totalTrials = session.trials.length

  deps.clearAllCharts()
  deps.setNumericHandler(undefined)
  deps.setComparisonHandler(undefined)
  deps.setUiState({
    phase: 'finished',
    testId: session.serverTestId,
    trialIndex: totalTrials,
    totalTrials,
  })

  category3Session = null
  answerLocked = false
  deps.onFinished?.()
}

export function startCategory3QuantitativeExperiment(testId: Category3ClientTestId, deps: Category3QuantitativeDeps) {
  stopCategory3QuantitativeExperiment(false)

  activeDeps = deps
  deps.clearAllCharts()

  const address = getCurrentAddress()
  const serverTestId = serverTestIdFromClient(testId)

  const session: Category3QuantitativeSession = {
    runId: createRunId(serverTestId, address),
    address,
    clientTestId: testId,
    serverTestId,
    trials: buildCategory3Trials(testId),
    currentTrialArrayIndex: 0,
    shownAtClientMs: 0,
  }

  category3Session = session
  answerLocked = false

  deps.setNumericHandler(handleCategory3NumericAnswer)
  deps.setComparisonHandler(handleCategory3ComparisonAnswer)
  saveCategory3TrialPlan(session, deps)
  showNextCategory3Trial()
}

export function stopCategory3QuantitativeExperiment(clearCharts = true) {
  countdownToken++
  category3Session = null
  answerLocked = false

  if (activeDeps) {
    activeDeps.setUiState({ phase: 'hidden' })
    activeDeps.setNumericHandler(undefined)
    activeDeps.setComparisonHandler(undefined)
    if (clearCharts) activeDeps.clearAllCharts()
  }

  activeDeps = null
}

export function isCategory3QuantitativeExperimentActive() {
  return category3Session !== null
}
