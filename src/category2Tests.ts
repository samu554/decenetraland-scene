import { executeTask } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/src/players'

export type Category2DominantAnswer = 'negative' | 'neutral' | 'positive' | 'unclear'
export type Category2ServerTestId = 'cat2-composition'

export type Category2PercentageEstimates = {
  negative: number
  neutral: number
  positive: number
}

export type Category2CompositionTrial = {
  trialIndex: number
  graph: 'tricolor-donut'
  graphLabel: string
  negativePercent: number
  neutralPercent: number
  positivePercent: number
  expectedDominant: Category2DominantAnswer
}

export type Category2CompositionUiState =
  | { phase: 'hidden' }
  | {
      phase: 'countdown'
      testId: Category2ServerTestId
      trialIndex: number
      totalTrials: number
      countdownEndAtMs: number
      graphLabel: string
    }
  | {
      phase: 'observation'
      testId: Category2ServerTestId
      trialIndex: number
      totalTrials: number
      observationEndAtMs: number
      graphLabel: string
    }
  | {
      phase: 'answer'
      testId: Category2ServerTestId
      trialIndex: number
      totalTrials: number
      graphLabel: string
    }
  | {
      phase: 'finished'
      testId: Category2ServerTestId
      trialIndex: number
      totalTrials: number
    }

export type Category2CompositionDeps = {
  serverUrl: string
  clearAllCharts: () => void
  drawTrialGraph: (trial: Category2CompositionTrial) => void
  setUiState: (state: Category2CompositionUiState) => void
  setAnswerHandler: (
    handler: ((dominant: Category2DominantAnswer, estimates: Category2PercentageEstimates) => void) | undefined
  ) => void
  onFinished?: () => void
}

type Category2CompositionSession = {
  runId: string
  address: string
  serverTestId: Category2ServerTestId
  trials: Category2CompositionTrial[]
  currentTrialArrayIndex: number
  shownAtClientMs: number
  answerEnabledAtClientMs: number
}

const SERVER_TEST_ID: Category2ServerTestId = 'cat2-composition'
const OBSERVATION_MS = 5000
const COUNTDOWN_MS = 3000

const CATEGORY2_CONFIGS: Array<Omit<Category2CompositionTrial, 'trialIndex' | 'graph' | 'graphLabel'>> = [
  { positivePercent: 80, neutralPercent: 10, negativePercent: 10, expectedDominant: 'positive' },
  { positivePercent: 10, neutralPercent: 10, negativePercent: 80, expectedDominant: 'negative' },
  { positivePercent: 40, neutralPercent: 40, negativePercent: 20, expectedDominant: 'unclear' },
  { positivePercent: 33, neutralPercent: 33, negativePercent: 33, expectedDominant: 'unclear' },
  { positivePercent: 60, neutralPercent: 30, negativePercent: 10, expectedDominant: 'positive' },
  { positivePercent: 10, neutralPercent: 80, negativePercent: 10, expectedDominant: 'neutral' },
]

let activeDeps: Category2CompositionDeps | null = null
let category2Session: Category2CompositionSession | null = null
let countdownToken = 0
let answerLocked = false

function waitMs(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function shuffleCategory2Trials(trials: Category2CompositionTrial[]) {
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

function buildCategory2Trials(): Category2CompositionTrial[] {
  return shuffleCategory2Trials(
    CATEGORY2_CONFIGS.map((config) => ({
      trialIndex: 0,
      graph: 'tricolor-donut',
      graphLabel: 'Tricolor donut',
      ...config,
    }))
  )
}

function createRunId(address: string) {
  const addressPart = String(address || 'unknown').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
  return `${SERVER_TEST_ID}_${Date.now()}_${addressPart || 'unknown'}`
}

function getCurrentAddress() {
  const player = getPlayer()
  return player?.userId ?? 'unknown'
}

function saveCategory2TrialPlan(session: Category2CompositionSession, deps: Category2CompositionDeps) {
  const plan = {
    runId: session.runId,
    address: session.address,
    testId: session.serverTestId,
    totalTrials: session.trials.length,
    trials: session.trials.map((trial) => ({
      trialIndex: trial.trialIndex,
      graph: trial.graph,
      graphLabel: trial.graphLabel,
      negativePercent: trial.negativePercent,
      neutralPercent: trial.neutralPercent,
      positivePercent: trial.positivePercent,
      expectedDominant: trial.expectedDominant,
      expectedLabel: trial.expectedDominant,
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
        console.log('[CATEGORY2] Error saving trial plan:', res.status)
      }
    } catch (err) {
      console.log('[CATEGORY2] Fetch error /experiment/trial-plan', err)
    }
  })
}

function sendCategory2Response(response: Record<string, unknown>, deps: Category2CompositionDeps) {
  executeTask(async () => {
    try {
      const res = await fetch(`${deps.serverUrl}/experiment/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response),
      })

      if (!res.ok) {
        console.log('[CATEGORY2] Error saving response:', res.status)
      }
    } catch (err) {
      console.log('[CATEGORY2] Fetch error /experiment/response', err)
    }
  })
}

function meanAbsoluteError(errors: number[]) {
  if (errors.length === 0) return 0
  return errors.reduce((sum, value) => sum + value, 0) / errors.length
}

function showNextCategory2Trial() {
  const deps = activeDeps
  const session = category2Session
  if (!deps || !session) return

  if (session.currentTrialArrayIndex >= session.trials.length) {
    finishCategory2CompositionExperiment()
    return
  }

  deps.clearAllCharts()
  answerLocked = true

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
    if (!category2Session) return
    if (category2Session.runId !== session.runId) return

    showCurrentCategory2Trial()
  })
}

function showCurrentCategory2Trial() {
  const deps = activeDeps
  const session = category2Session
  if (!deps || !session) return

  const trial = session.trials[session.currentTrialArrayIndex]
  if (!trial) {
    finishCategory2CompositionExperiment()
    return
  }

  deps.clearAllCharts()
  deps.drawTrialGraph(trial)

  session.shownAtClientMs = Date.now()
  session.answerEnabledAtClientMs = 0
  answerLocked = true

  const observationEndAtMs = Date.now() + OBSERVATION_MS
  const token = ++countdownToken

  deps.setUiState({
    phase: 'observation',
    testId: session.serverTestId,
    trialIndex: trial.trialIndex,
    totalTrials: session.trials.length,
    observationEndAtMs,
    graphLabel: trial.graphLabel,
  })

  executeTask(async () => {
    await waitMs(OBSERVATION_MS)

    if (token !== countdownToken) return
    if (!category2Session) return
    if (category2Session.runId !== session.runId) return

    showCategory2AnswerUi()
  })
}

function showCategory2AnswerUi() {
  const deps = activeDeps
  const session = category2Session
  if (!deps || !session) return

  const trial = session.trials[session.currentTrialArrayIndex]
  if (!trial) {
    finishCategory2CompositionExperiment()
    return
  }

  session.answerEnabledAtClientMs = Date.now()
  answerLocked = false

  deps.setUiState({
    phase: 'answer',
    testId: session.serverTestId,
    trialIndex: trial.trialIndex,
    totalTrials: session.trials.length,
    graphLabel: trial.graphLabel,
  })
}

function handleCategory2Answer(selectedDominant: Category2DominantAnswer, estimates: Category2PercentageEstimates) {
  const deps = activeDeps
  const session = category2Session
  if (!deps || !session || answerLocked) return

  answerLocked = true

  const trial = session.trials[session.currentTrialArrayIndex]
  if (!trial) return

  const answeredAtClientMs = Date.now()
  const responseTimeMs = answeredAtClientMs - session.shownAtClientMs
  const answerTimeMs = session.answerEnabledAtClientMs > 0
    ? answeredAtClientMs - session.answerEnabledAtClientMs
    : responseTimeMs

  const isDominantCorrect = selectedDominant === trial.expectedDominant

  const negativeError = Math.abs(estimates.negative - trial.negativePercent)
  const neutralError = Math.abs(estimates.neutral - trial.neutralPercent)
  const positiveError = Math.abs(estimates.positive - trial.positivePercent)
  const meanAbsolutePercentageError = Number(meanAbsoluteError([negativeError, neutralError, positiveError]).toFixed(2))

  const response = {
    runId: session.runId,
    address: session.address,
    testId: session.serverTestId,
    trialIndex: trial.trialIndex,
    totalTrials: session.trials.length,

    graph: trial.graph,
    graphLabel: trial.graphLabel,

    negativePercent: trial.negativePercent,
    neutralPercent: trial.neutralPercent,
    positivePercent: trial.positivePercent,

    expectedDominant: trial.expectedDominant,
    selectedDominant,
    expectedLabel: trial.expectedDominant,
    selectedLabel: selectedDominant,
    isCorrect: isDominantCorrect,
    isDominantCorrect,
    accuracyType: isDominantCorrect ? 'dominant-correct' : 'dominant-wrong',

    estimatedNegativePercent: estimates.negative,
    estimatedNeutralPercent: estimates.neutral,
    estimatedPositivePercent: estimates.positive,
    estimatedTotalPercent: estimates.negative + estimates.neutral + estimates.positive,

    absoluteErrorNegative: negativeError,
    absoluteErrorNeutral: neutralError,
    absoluteErrorPositive: positiveError,
    meanAbsolutePercentageError,

    shownAtClientMs: session.shownAtClientMs,
    answerEnabledAtClientMs: session.answerEnabledAtClientMs,
    answeredAtClientMs,
    responseTimeMs,
    answerTimeMs,
    createdAtClient: new Date().toISOString(),
  }

  sendCategory2Response(response, deps)

  session.currentTrialArrayIndex++
  showNextCategory2Trial()
}

function finishCategory2CompositionExperiment() {
  const deps = activeDeps
  const session = category2Session
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

  category2Session = null
  answerLocked = false
  deps.onFinished?.()
}

export function startCategory2CompositionExperiment(deps: Category2CompositionDeps) {
  stopCategory2CompositionExperiment(false)

  activeDeps = deps
  deps.clearAllCharts()

  const address = getCurrentAddress()

  const session: Category2CompositionSession = {
    runId: createRunId(address),
    address,
    serverTestId: SERVER_TEST_ID,
    trials: buildCategory2Trials(),
    currentTrialArrayIndex: 0,
    shownAtClientMs: 0,
    answerEnabledAtClientMs: 0,
  }

  category2Session = session
  answerLocked = false

  deps.setAnswerHandler(handleCategory2Answer)
  saveCategory2TrialPlan(session, deps)
  showNextCategory2Trial()
}

export function stopCategory2CompositionExperiment(clearCharts = true) {
  countdownToken++
  category2Session = null
  answerLocked = false

  if (activeDeps) {
    activeDeps.setUiState({ phase: 'hidden' })
    activeDeps.setAnswerHandler(undefined)
    if (clearCharts) activeDeps.clearAllCharts()
  }

  activeDeps = null
}

export function isCategory2CompositionExperimentActive() {
  return category2Session !== null
}
