import { executeTask } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/src/players'

export type Category1PredictionLabel = 'Awful' | 'Bad' | 'Neutral' | 'Good' | 'Great'
export type Category1ExperimentTestType = 'test-1-1' | 'test-1-2'
export type Category1ServerTestId = 'cat1-test-1-1' | 'cat1-test-1-2'
export type Category1Graph = 'sentiment-image' | 'sentiment-light' | 'simple-donut' | 'sentiment-meter'

export type Category1Trial = {
  trialIndex: number
  graph: Category1Graph
  graphLabel: string
  value: number
  expectedLabel: Category1PredictionLabel
}

export type Category1ExperimentUiState =
  | { phase: 'hidden' }
  | {
      phase: 'countdown'
      testId: Category1ServerTestId
      trialIndex: number
      totalTrials: number
      countdownEndAtMs: number
      graphLabel: string
    }
  | {
      phase: 'trial'
      testId: Category1ServerTestId
      trialIndex: number
      totalTrials: number
      graphLabel: string
    }
  | {
      phase: 'finished'
      testId: Category1ServerTestId
      trialIndex: number
      totalTrials: number
    }

export type Category1ExperimentDeps = {
  serverUrl: string
  clearAllCharts: () => void
  drawTrialGraph: (trial: Category1Trial) => void
  setUiState: (state: Category1ExperimentUiState) => void
  setPredictionHandler: (handler: ((label: Category1PredictionLabel) => void) | undefined) => void
  setNumericHandler: (handler: ((value: number) => void) | undefined) => void
  onFinished?: () => void
}

type Category1ExperimentSession = {
  runId: string
  address: string
  testType: Category1ExperimentTestType
  serverTestId: Category1ServerTestId
  trials: Category1Trial[]
  currentTrialArrayIndex: number
  shownAtClientMs: number
  drawnTrialKey?: string
}

const CATEGORY1_GRAPHS: Array<{ graph: Category1Graph; graphLabel: string }> = [
  { graph: 'sentiment-image', graphLabel: 'Sentiment emoji' },
  { graph: 'sentiment-light', graphLabel: 'Sentiment light' },
  { graph: 'simple-donut', graphLabel: 'Simple donut' },
  { graph: 'sentiment-meter', graphLabel: 'Sentiment bar' },
]

const CATEGORY1_TEST11_VALUES: Array<{ value: number; expectedLabel: Category1PredictionLabel }> = [
  { value: 1, expectedLabel: 'Awful' },
  { value: 3, expectedLabel: 'Bad' },
  { value: 5, expectedLabel: 'Neutral' },
  { value: 7, expectedLabel: 'Good' },
  { value: 9, expectedLabel: 'Great' },
]

// Test 1.2: two values per graph, equal for every graph.
// Total: 4 graphs x 2 values = 8 trials.
const CATEGORY1_TEST12_VALUES: Array<{ value: number; expectedLabel: Category1PredictionLabel }> = [
  { value: 3, expectedLabel: 'Bad' },
  { value: 7, expectedLabel: 'Good' },
]

let activeDeps: Category1ExperimentDeps | null = null
let category1Experiment: Category1ExperimentSession | null = null
let category1CountdownToken = 0
let category1AnswerLocked = false

function waitMs(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function labelFromValue(value: number): Category1PredictionLabel {
  if (value >= 0 && value < 2) return 'Awful'
  if (value >= 2 && value < 3.5) return 'Bad'
  if (value >= 3.5 && value < 6.5) return 'Neutral'
  if (value >= 6.5 && value < 8) return 'Good'
  return 'Great'
}

function roundToOneDecimal(value: number) {
  return Number(value.toFixed(1))
}

function shuffleCategory1Trials(trials: Category1Trial[]) {
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

function buildCategory1Trials(testType: Category1ExperimentTestType): Category1Trial[] {
  const trials: Category1Trial[] = []
  const values = testType === 'test-1-2'
    ? CATEGORY1_TEST12_VALUES
    : CATEGORY1_TEST11_VALUES

  for (const graphDef of CATEGORY1_GRAPHS) {
    for (const stimulus of values) {
      trials.push({
        trialIndex: 0,
        graph: graphDef.graph,
        graphLabel: graphDef.graphLabel,
        value: stimulus.value,
        expectedLabel: stimulus.expectedLabel,
      })
    }
  }

  return shuffleCategory1Trials(trials)
}

function getCategory1ServerTestId(testType: Category1ExperimentTestType): Category1ServerTestId {
  return testType === 'test-1-1' ? 'cat1-test-1-1' : 'cat1-test-1-2'
}

function createRunId(serverTestId: Category1ServerTestId, address: string) {
  const addressPart = String(address || 'unknown').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
  return `${serverTestId}_${Date.now()}_${addressPart || 'unknown'}`
}

function getCurrentAddress() {
  const player = getPlayer()
  return player?.userId ?? 'unknown'
}

function saveCategory1TrialPlan(session: Category1ExperimentSession, deps: Category1ExperimentDeps) {
  const plan = {
    runId: session.runId,
    address: session.address,
    testId: session.serverTestId,
    totalTrials: session.trials.length,
    trials: session.trials.map((trial) => ({
      trialIndex: trial.trialIndex,
      graph: trial.graph,
      graphLabel: trial.graphLabel,
      value: trial.value,
      expectedLabel: trial.expectedLabel,
    })),
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
        console.log('[EXPERIMENT] Error saving trial plan:', res.status)
      }
    } catch (err) {
      console.log('[EXPERIMENT] Fetch error /experiment/trial-plan', err)
    }
  })
}

function sendCategory1Response(response: Record<string, unknown>, deps: Category1ExperimentDeps) {
  executeTask(async () => {
    try {
      const res = await fetch(`${deps.serverUrl}/experiment/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response),
      })

      if (!res.ok) {
        console.log('[EXPERIMENT] Error saving response:', res.status)
      }
    } catch (err) {
      console.log('[EXPERIMENT] Fetch error /experiment/response', err)
    }
  })
}

function showNextCategory1Trial() {
  const deps = activeDeps
  const session = category1Experiment
  if (!deps || !session) return

  if (session.currentTrialArrayIndex >= session.trials.length) {
    finishCategory1Experiment()
    return
  }

  deps.clearAllCharts()
  category1AnswerLocked = true

  const trial = session.trials[session.currentTrialArrayIndex]
  session.drawnTrialKey = undefined
  const countdownEndAtMs = Date.now() + 3000
  const token = ++category1CountdownToken

  deps.setUiState({
    phase: 'countdown',
    testId: session.serverTestId,
    trialIndex: trial.trialIndex,
    totalTrials: session.trials.length,
    countdownEndAtMs,
    graphLabel: trial.graphLabel,
  })

  executeTask(async () => {
    await waitMs(3000)

    if (token !== category1CountdownToken) return
    if (!category1Experiment) return
    if (category1Experiment.runId !== session.runId) return

    showCurrentCategory1Trial()
  })
}

function showCurrentCategory1Trial() {
  const deps = activeDeps
  const session = category1Experiment
  if (!deps || !session) return

  const trial = session.trials[session.currentTrialArrayIndex]
  if (!trial) {
    finishCategory1Experiment()
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
  category1AnswerLocked = false

  deps.setUiState({
    phase: 'trial',
    testId: session.serverTestId,
    trialIndex: trial.trialIndex,
    totalTrials: session.trials.length,
    graphLabel: trial.graphLabel,
  })
}

function handleCategory1Prediction(selectedLabel: Category1PredictionLabel) {
  const deps = activeDeps
  const session = category1Experiment
  if (!deps || !session || session.testType !== 'test-1-1' || category1AnswerLocked) return

  category1AnswerLocked = true

  const trial = session.trials[session.currentTrialArrayIndex]
  const answeredAtClientMs = Date.now()
  const responseTimeMs = answeredAtClientMs - session.shownAtClientMs
  const isCorrect = selectedLabel === trial.expectedLabel

  const response = {
    runId: session.runId,
    address: session.address,
    testId: session.serverTestId,
    trialIndex: trial.trialIndex,
    totalTrials: session.trials.length,

    graph: trial.graph,
    graphLabel: trial.graphLabel,
    stimulusValue: trial.value,

    expectedLabel: trial.expectedLabel,
    selectedLabel,
    isCorrect,
    accuracyType: isCorrect ? 'correct' : 'wrong',

    shownAtClientMs: session.shownAtClientMs,
    answeredAtClientMs,
    responseTimeMs,
    createdAtClient: new Date().toISOString(),
  }

  sendCategory1Response(response, deps)

  session.currentTrialArrayIndex++
  showNextCategory1Trial()
}

function handleCategory1NumericAnswer(selectedValue: number) {
  const deps = activeDeps
  const session = category1Experiment
  if (!deps || !session || session.testType !== 'test-1-2' || category1AnswerLocked) return

  category1AnswerLocked = true

  const trial = session.trials[session.currentTrialArrayIndex]
  const answeredAtClientMs = Date.now()
  const responseTimeMs = answeredAtClientMs - session.shownAtClientMs

  const normalizedSelectedValue = roundToOneDecimal(Math.max(0, Math.min(10, selectedValue)))
  const selectedLabel = labelFromValue(normalizedSelectedValue)
  const isCorrect = selectedLabel === trial.expectedLabel
  const absoluteError = roundToOneDecimal(Math.abs(normalizedSelectedValue - trial.value))

  const response = {
    runId: session.runId,
    address: session.address,
    testId: session.serverTestId,
    trialIndex: trial.trialIndex,
    totalTrials: session.trials.length,

    graph: trial.graph,
    graphLabel: trial.graphLabel,
    stimulusValue: trial.value,

    expectedValue: trial.value,
    selectedValue: normalizedSelectedValue,
    absoluteError,
    isExactValue: normalizedSelectedValue === trial.value,

    expectedLabel: trial.expectedLabel,
    selectedLabel,
    isCorrect,
    accuracyType: isCorrect ? 'label-match' : 'label-mismatch',

    shownAtClientMs: session.shownAtClientMs,
    answeredAtClientMs,
    responseTimeMs,
    createdAtClient: new Date().toISOString(),
  }

  sendCategory1Response(response, deps)

  session.currentTrialArrayIndex++
  showNextCategory1Trial()
}

function finishCategory1Experiment() {
  const deps = activeDeps
  const session = category1Experiment
  if (!deps || !session) return

  const finishedTestId = session.serverTestId
  const totalTrials = session.trials.length

  deps.clearAllCharts()
  deps.setPredictionHandler(undefined)
  deps.setNumericHandler(undefined)
  deps.setUiState({
    phase: 'finished',
    testId: finishedTestId,
    trialIndex: totalTrials,
    totalTrials,
  })

  category1Experiment = null
  category1AnswerLocked = false
  deps.onFinished?.()
}

export function startCategory1Experiment(testType: Category1ExperimentTestType, deps: Category1ExperimentDeps) {
  stopCategory1Experiment(false)

  activeDeps = deps
  deps.clearAllCharts()

  const address = getCurrentAddress()
  const serverTestId = getCategory1ServerTestId(testType)

  const session: Category1ExperimentSession = {
    runId: createRunId(serverTestId, address),
    address,
    testType,
    serverTestId,
    trials: buildCategory1Trials(testType),
    currentTrialArrayIndex: 0,
    shownAtClientMs: 0,
  }

  category1Experiment = session
  category1AnswerLocked = false

  deps.setPredictionHandler(handleCategory1Prediction)
  deps.setNumericHandler(handleCategory1NumericAnswer)

  saveCategory1TrialPlan(session, deps)
  showNextCategory1Trial()
}

export function stopCategory1Experiment(clearCharts = true) {
  category1CountdownToken++
  category1Experiment = null
  category1AnswerLocked = false

  if (activeDeps) {
    activeDeps.setUiState({ phase: 'hidden' })
    activeDeps.setPredictionHandler(undefined)
    activeDeps.setNumericHandler(undefined)
    if (clearCharts) activeDeps.clearAllCharts()
  }

  activeDeps = null
}

export function isCategory1ExperimentActive() {
  return category1Experiment !== null
}
