import { executeTask } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/src/players'
import {
  INTER_CLASS_TEST_1_SCENARIOS,
  type InterClassAnomalyAnswer,
  type InterClassDataPoint,
  type InterClassScenarioAnswer,
} from './interClassScenarioData'

export type { InterClassAnomalyAnswer, InterClassDataPoint, InterClassScenarioAnswer } from './interClassScenarioData'

export type InterClassTestId =
  | 'inter-test-1-a'
  | 'inter-test-1-b'
  | 'inter-test-2-a'
  | 'inter-test-2-b'
  | 'inter-test-3-a'
  | 'inter-test-3-b'

export type InterClassFinalLikertTestId =
  | 'inter-test-1-final-likert'
  | 'inter-test-2-final-likert'
  | 'inter-test-3-final-likert'

export type InterClassUiTestId = InterClassTestId | InterClassFinalLikertTestId
export type InterClassVariantCode = 'A' | 'B'
export type InterClassLikertMode = 'variant' | 'comparative'
export type InterClassLikertValue = 1 | 2 | 3 | 4 | 5
export type InterClassLikertAnswers = Record<string, InterClassLikertValue>
export type InterClassLikertQuestion = {
  code: string
  text: string
}

export type InterClassGraphCompositionLabels = {
  variantA: string[]
  variantB: string[]
}

export type InterClassScenarioTrial = {
  trialIndex: number
  scenarioId: string
  scenarioLabel: string
  description: string
  expectedAnswer: InterClassScenarioAnswer
  expectedAnomaly: InterClassAnomalyAnswer
  anomalyDescription?: string
  data: InterClassDataPoint[]
}

export type InterClassPlaybackFrame = {
  trial: InterClassScenarioTrial
  visibleData: InterClassDataPoint[]
}

export type InterClassUiState =
  | { phase: 'hidden' }
  | {
      phase: 'intro'
      testId: InterClassTestId
      trialIndex: number
      totalTrials: number
      variantCode: InterClassVariantCode
      graphCombinationLabels: string[]
      disclaimer: string
    }
  | {
      phase: 'countdown'
      testId: InterClassUiTestId
      trialIndex: number
      totalTrials: number
      countdownEndAtMs: number
      scenarioLabel: string
      variantCode?: InterClassVariantCode
      graphCombinationLabels?: string[]
    }
  | {
      phase: 'playback'
      testId: InterClassUiTestId
      trialIndex: number
      totalTrials: number
      scenarioLabel: string
      variantCode?: InterClassVariantCode
      graphCombinationLabels?: string[]
      currentPoint: number
      totalPoints: number
    }
  | {
      phase: 'answer'
      testId: InterClassUiTestId
      trialIndex: number
      totalTrials: number
      scenarioLabel: string
      variantCode?: InterClassVariantCode
      graphCombinationLabels?: string[]
    }
  | {
      phase: 'likert'
      testId: InterClassUiTestId
      likertRunId: string
      likertMode: InterClassLikertMode
      trialIndex: number
      totalTrials: number
      title: string
      subtitle: string
      scaleDescription: string
      questions: InterClassLikertQuestion[]
      variantCode?: InterClassVariantCode
      graphCombinationLabels?: string[]
      comparisonGraphCombinationLabels?: InterClassGraphCompositionLabels
    }
  | {
      phase: 'finished'
      testId: InterClassUiTestId
      trialIndex: number
      totalTrials: number
    }

export type InterClassExperimentDeps = {
  serverUrl: string
  clearAllCharts: () => void
  drawPlaybackFrame: (frame: InterClassPlaybackFrame) => void
  setUiState: (state: InterClassUiState) => void
  setAnswerHandler: (
    handler: ((answer: InterClassScenarioAnswer, anomaly: InterClassAnomalyAnswer) => void) | undefined
  ) => void
  setLikertHandler: (handler: ((answers: InterClassLikertAnswers) => void) | undefined) => void
  setIntroHandler: (handler: (() => void) | undefined) => void
  onFinished?: () => void
}

type InterClassSession = {
  runId: string
  address: string
  testId: InterClassTestId
  trials: InterClassScenarioTrial[]
  currentTrialArrayIndex: number
  playbackStartedAtClientMs: number
  answerShownAtClientMs: number
  playbackToken: number
  pendingLikertStartedAtClientMs: number
}

type InterClassFinalLikertSession = {
  runId: string
  address: string
  testId: InterClassFinalLikertTestId
  testNumber: 1 | 2 | 3
  startedAtClientMs: number
}

const INTER_TEST_1_A_ID: InterClassTestId = 'inter-test-1-a'
const INTER_TEST_1_B_ID: InterClassTestId = 'inter-test-1-b'
const INTER_TEST_2_A_ID: InterClassTestId = 'inter-test-2-a'
const INTER_TEST_2_B_ID: InterClassTestId = 'inter-test-2-b'
const INTER_TEST_3_A_ID: InterClassTestId = 'inter-test-3-a'
const INTER_TEST_3_B_ID: InterClassTestId = 'inter-test-3-b'
const INTER_TEST_1_FINAL_LIKERT_ID: InterClassFinalLikertTestId = 'inter-test-1-final-likert'
const INTER_TEST_2_FINAL_LIKERT_ID: InterClassFinalLikertTestId = 'inter-test-2-final-likert'
const INTER_TEST_3_FINAL_LIKERT_ID: InterClassFinalLikertTestId = 'inter-test-3-final-likert'

let lastInterTest1AScenarioId: string | undefined
let lastInterTest1BScenarioId: string | undefined
let lastInterTest2AScenarioId: string | undefined
let lastInterTest2BScenarioId: string | undefined
let lastInterTest3AScenarioId: string | undefined
let lastInterTest3BScenarioId: string | undefined

// Global shuffled queue used by all inter-class cases.
// This makes the 8 scenario variants rotate without repetition before starting a new cycle.
let interClassScenarioQueue: string[] = []

const COUNTDOWN_MS = 500
// One prerecorded data point is appended every 3 seconds during playback.
const FRAME_MS = 500

let activeDeps: InterClassExperimentDeps | null = null
let interClassSession: InterClassSession | null = null
let interClassFinalLikertSession: InterClassFinalLikertSession | null = null
let playbackTokenCounter = 0
let answerLocked = false
let introLocked = false

const INTER_CLASS_ACCELERATED_DISCLAIMER = 'This simulation is accelerated compared with the intended use to make testing easier.'

function waitMs(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function shuffleTrials<T>(items: T[]): T[] {
  const copy = [...items]

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = copy[i]
    copy[i] = copy[j]
    copy[j] = tmp
  }

  return copy
}

const INTER_CLASS_VARIANT_LIKERT_TEXTS: Record<1 | 2 | 3, string[]> = {
  1: [
    'I clearly understood the current sentiment value.',
    'The visualizations were easy to read in the 3D virtual environment.',
    'I felt confident in my answer about the conversation trend.',
  ],
  2: [
    'I clearly understood the composition of positive, neutral, and negative messages.',
    'The visualizations were easy to read in the 3D virtual environment.',
    'I felt confident in my answer about the conversation trend.',
  ],
  3: [
    'I clearly understood whether the sentiment was improving, worsening, or staying stable.',
    'The visualizations were easy to read in the 3D virtual environment.',
    'I felt confident in my answer about the conversation trend.',
  ],
}

const INTER_CLASS_COMPARATIVE_LIKERT_TEXTS: Record<1 | 2 | 3, string[]> = {
  1: [
    'In terms of quickly understanding the current sentiment, Variant A is better than Variant B.',
    'In terms of precisely estimating the current sentiment value, Variant A is better than Variant B.',
    'In terms of monitoring a conversation in real time, Variant A is better than Variant B.',
  ],
  2: [
    'In terms of understanding the dominant sentiment, Variant A is better than Variant B.',
    'In terms of distinguishing a neutral conversation from a polarized one, Variant A is better than Variant B.',
    'In terms of understanding the conversation quickly without too much visual information, Variant A is better than Variant B.',
  ],
  3: [
    'In terms of understanding the evolution of sentiment over time, Variant A is better than Variant B.',
    'In terms of identifying critical moments or anomalies, Variant A is better than Variant B.',
    'In terms of understanding the current overall state of the conversation, Variant A is better than Variant B.',
  ],
}

function getInterClassTestNumber(testId: InterClassTestId): 1 | 2 | 3 {
  if (testId === INTER_TEST_2_A_ID || testId === INTER_TEST_2_B_ID) return 2
  if (testId === INTER_TEST_3_A_ID || testId === INTER_TEST_3_B_ID) return 3
  return 1
}

function getInterClassVariantCode(testId: InterClassTestId): InterClassVariantCode {
  return testId.endsWith('-b') ? 'B' : 'A'
}

function getFinalLikertTestNumber(testId: InterClassFinalLikertTestId): 1 | 2 | 3 {
  if (testId === INTER_TEST_2_FINAL_LIKERT_ID) return 2
  if (testId === INTER_TEST_3_FINAL_LIKERT_ID) return 3
  return 1
}

function buildVariantLikertQuestions(testId: InterClassTestId): InterClassLikertQuestion[] {
  const testNumber = getInterClassTestNumber(testId)
  const variant = getInterClassVariantCode(testId)
  return INTER_CLASS_VARIANT_LIKERT_TEXTS[testNumber].map((text, index) => ({
    code: `T${testNumber}-${variant}${index + 1}`,
    text,
  }))
}

function buildComparativeLikertQuestions(testNumber: 1 | 2 | 3): InterClassLikertQuestion[] {
  return INTER_CLASS_COMPARATIVE_LIKERT_TEXTS[testNumber].map((text, index) => ({
    code: `T${testNumber}-C${index + 1}`,
    text,
  }))
}

function getLikertScaleDescription(mode: InterClassLikertMode) {
  return mode === 'comparative'
    ? '1 = Strongly disagree, 5 = Strongly agree.'
    : '1 = Strongly disagree, 5 = Strongly agree.'
}

function getInterClassCaseId(testId: InterClassTestId) {
  switch (testId) {
    case INTER_TEST_1_B_ID: return '1B'
    case INTER_TEST_2_A_ID: return '2A'
    case INTER_TEST_2_B_ID: return '2B'
    case INTER_TEST_3_A_ID: return '3A'
    case INTER_TEST_3_B_ID: return '3B'
    case INTER_TEST_1_A_ID:
    default: return '1A'
  }
}

function getInterClassGraphCombination(testId: InterClassTestId) {
  switch (testId) {
    case INTER_TEST_1_B_ID:
      return ['sentiment-meter', 'bar-chart']
    case INTER_TEST_2_B_ID:
      return ['tricolor-donut', 'bar-chart']
    case INTER_TEST_3_A_ID:
      return ['sentiment-meter', 'tricolor-donut']
    case INTER_TEST_3_B_ID:
      return ['bar-chart']
    case INTER_TEST_1_A_ID:
    case INTER_TEST_2_A_ID:
    default:
      return ['sentiment-image', 'bar-chart']
  }
}

function getInterClassGraphLabel(graph: string) {
  switch (graph) {
    case 'sentiment-image':
      return 'Sentiment image'
    case 'sentiment-meter':
      return 'Sentiment meter'
    case 'tricolor-donut':
      return '3-color donut'
    case 'bar-chart':
      return 'Temporal bar chart'
    default:
      return graph
  }
}

function getInterClassGraphCombinationLabels(testId: InterClassTestId) {
  return getInterClassGraphCombination(testId).map(getInterClassGraphLabel)
}

function getInterClassGraphCompositionLabels(testNumber: 1 | 2 | 3): InterClassGraphCompositionLabels {
  const variantATestId = testNumber === 2
    ? INTER_TEST_2_A_ID
    : testNumber === 3
      ? INTER_TEST_3_A_ID
      : INTER_TEST_1_A_ID

  const variantBTestId = testNumber === 2
    ? INTER_TEST_2_B_ID
    : testNumber === 3
      ? INTER_TEST_3_B_ID
      : INTER_TEST_1_B_ID

  return {
    variantA: getInterClassGraphCombinationLabels(variantATestId),
    variantB: getInterClassGraphCombinationLabels(variantBTestId),
  }
}

function getInterClassCaseDescription(testId: InterClassTestId) {
  switch (testId) {
    case INTER_TEST_1_B_ID:
      return 'Inter-class Test 1 Case B: one random prerecorded scenario different from the last Case A scenario when available, sentiment meter + temporal bar chart, one data point every 3 seconds.'
    case INTER_TEST_2_A_ID:
      return 'Inter-class Test 2 Case A: one random prerecorded scenario different from the last Case B scenario when available, sentiment emoji + temporal bar chart, one data point every 3 seconds.'
    case INTER_TEST_2_B_ID:
      return 'Inter-class Test 2 Case B: one random prerecorded scenario different from the last Case A scenario when available, tricolor donut + temporal bar chart, one data point every 3 seconds.'
    case INTER_TEST_3_A_ID:
      return 'Inter-class Test 3 Case A: one random prerecorded scenario different from the last Case B scenario when available, sentiment meter + tricolor donut, one data point every 3 seconds.'
    case INTER_TEST_3_B_ID:
      return 'Inter-class Test 3 Case B: one random prerecorded scenario different from the last Case A scenario when available, temporal bar chart only, one data point every 3 seconds.'
    case INTER_TEST_1_A_ID:
    default:
      return 'Inter-class Test 1 Case A: one random prerecorded scenario different from the last Case B scenario when available, sentiment emoji + temporal bar chart, one data point every 3 seconds.'
  }
}

function getScenarioToAvoid(testId: InterClassTestId) {
  switch (testId) {
    case INTER_TEST_1_A_ID:
      return lastInterTest1BScenarioId
    case INTER_TEST_1_B_ID:
      return lastInterTest1AScenarioId
    case INTER_TEST_2_A_ID:
      return lastInterTest2BScenarioId
    case INTER_TEST_2_B_ID:
      return lastInterTest2AScenarioId
    case INTER_TEST_3_A_ID:
      return lastInterTest3BScenarioId
    case INTER_TEST_3_B_ID:
      return lastInterTest3AScenarioId
    default:
      return undefined
  }
}

function rememberScenario(testId: InterClassTestId, scenarioId: string) {
  switch (testId) {
    case INTER_TEST_1_A_ID:
      lastInterTest1AScenarioId = scenarioId
      break
    case INTER_TEST_1_B_ID:
      lastInterTest1BScenarioId = scenarioId
      break
    case INTER_TEST_2_A_ID:
      lastInterTest2AScenarioId = scenarioId
      break
    case INTER_TEST_2_B_ID:
      lastInterTest2BScenarioId = scenarioId
      break
    case INTER_TEST_3_A_ID:
      lastInterTest3AScenarioId = scenarioId
      break
    case INTER_TEST_3_B_ID:
      lastInterTest3BScenarioId = scenarioId
      break
  }
}

function refillInterClassScenarioQueue() {
  interClassScenarioQueue = shuffleTrials(
    INTER_CLASS_TEST_1_SCENARIOS.map((scenario) => scenario.scenarioId)
  )
}

function getScenarioById(scenarioId: string) {
  return INTER_CLASS_TEST_1_SCENARIOS.find((scenario) => scenario.scenarioId === scenarioId)
}

function takeNextScenarioFromQueue(scenarioToAvoid?: string) {
  if (interClassScenarioQueue.length === 0) {
    refillInterClassScenarioQueue()
  }

  if (interClassScenarioQueue.length === 0) return undefined

  let selectedQueueIndex = 0

  // When a paired case has just used a scenario, prefer a different one.
  // The exception is when the queue contains only that scenario: in that case we keep
  // the no-repeat cycle intact and use it, then the next call starts a fresh cycle.
  if (scenarioToAvoid && interClassScenarioQueue.length > 1) {
    const alternativeIndex = interClassScenarioQueue.findIndex((scenarioId) => scenarioId !== scenarioToAvoid)
    if (alternativeIndex >= 0) {
      selectedQueueIndex = alternativeIndex
    }
  }

  const [scenarioId] = interClassScenarioQueue.splice(selectedQueueIndex, 1)
  return scenarioId ? getScenarioById(scenarioId) : undefined
}

function buildSingleRandomScenarioTrial(testId: InterClassTestId): InterClassScenarioTrial[] {
  const scenarioToAvoid = getScenarioToAvoid(testId)
  const scenario = takeNextScenarioFromQueue(scenarioToAvoid)

  if (!scenario) return []

  rememberScenario(testId, scenario.scenarioId)

  return [{
    ...scenario,
    trialIndex: 1,
  }]
}

function buildInterClassTrials(testId: InterClassTestId): InterClassScenarioTrial[] {
  // Each inter-class case uses exactly one random prerecorded scenario.
  return buildSingleRandomScenarioTrial(testId)
}

function createRunId(testId: InterClassUiTestId, address: string) {
  const addressPart = String(address || 'unknown').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
  return `${testId}_${Date.now()}_${addressPart || 'unknown'}`
}

function getCurrentAddress() {
  const player = getPlayer()
  return player?.userId ?? 'unknown'
}

function saveTrialPlan(session: InterClassSession, deps: InterClassExperimentDeps) {
  const plan = {
    runId: session.runId,
    address: session.address,
    testId: session.testId,
    totalTrials: session.trials.length,
    caseId: getInterClassCaseId(session.testId),
    graphCombination: getInterClassGraphCombination(session.testId),
    caseDescription: getInterClassCaseDescription(session.testId),
    variantLikertQuestions: buildVariantLikertQuestions(session.testId),
    variantLikertScale: getLikertScaleDescription('variant'),
    trials: session.trials.map((trial) => ({
      trialIndex: trial.trialIndex,
      scenarioId: trial.scenarioId,
      scenarioLabel: trial.scenarioLabel,
      description: trial.description,
      expectedAnswer: trial.expectedAnswer,
      expectedAnomaly: trial.expectedAnomaly,
      anomalyDescription: trial.anomalyDescription,
      totalPoints: trial.data.length,
      data: trial.data,
    })),
    createdAtClient: new Date().toISOString(),
  }

  executeTask(async () => {
    try {
      const res = await fetch(`${deps.serverUrl}/experiment/trial-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plan, null, 2),
      })

      if (!res.ok) {
        console.log(`[INTER ${getInterClassCaseId(session.testId)}] Error saving trial plan:`, res.status)
      }
    } catch (err) {
      console.log(`[INTER ${getInterClassCaseId(session.testId)}] Fetch error /experiment/trial-plan`, err)
    }
  })
}

function sendResponse(response: Record<string, unknown>, deps: InterClassExperimentDeps) {
  executeTask(async () => {
    try {
      const res = await fetch(`${deps.serverUrl}/experiment/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response, null, 2),
      })

      if (!res.ok) {
        console.log('[INTER] Error saving response:', res.status)
      }
    } catch (err) {
      console.log('[INTER] Fetch error /experiment/response', err)
    }
  })
}

function showInterClassIntro() {
  const deps = activeDeps
  const session = interClassSession
  if (!deps || !session) return

  const firstTrial = session.trials[session.currentTrialArrayIndex]
  if (!firstTrial) {
    finishInterClassExperiment()
    return
  }

  introLocked = false
  deps.clearAllCharts()
  deps.setIntroHandler(handleIntroContinue)
  deps.setUiState({
    phase: 'intro',
    testId: session.testId,
    trialIndex: firstTrial.trialIndex,
    totalTrials: session.trials.length,
    variantCode: getInterClassVariantCode(session.testId),
    graphCombinationLabels: getInterClassGraphCombinationLabels(session.testId),
    disclaimer: INTER_CLASS_ACCELERATED_DISCLAIMER,
  })
}

function handleIntroContinue() {
  if (!activeDeps || !interClassSession || introLocked) return

  introLocked = true
  activeDeps.setIntroHandler(undefined)
  showNextTrial()
}

function showNextTrial() {
  const deps = activeDeps
  const session = interClassSession
  if (!deps || !session) return

  if (session.currentTrialArrayIndex >= session.trials.length) {
    finishInterClassExperiment()
    return
  }

  deps.clearAllCharts()
  answerLocked = true

  const trial = session.trials[session.currentTrialArrayIndex]
  const countdownEndAtMs = Date.now() + COUNTDOWN_MS
  const token = ++playbackTokenCounter
  session.playbackToken = token

  deps.setUiState({
    phase: 'countdown',
    testId: session.testId,
    trialIndex: trial.trialIndex,
    totalTrials: session.trials.length,
    countdownEndAtMs,
    scenarioLabel: trial.scenarioLabel,
    variantCode: getInterClassVariantCode(session.testId),
    graphCombinationLabels: getInterClassGraphCombinationLabels(session.testId),
  })

  executeTask(async () => {
    await waitMs(COUNTDOWN_MS)

    if (!interClassSession || interClassSession.runId !== session.runId) return
    if (interClassSession.playbackToken !== token) return

    startPlaybackForCurrentTrial()
  })
}

function startPlaybackForCurrentTrial() {
  const deps = activeDeps
  const session = interClassSession
  if (!deps || !session) return

  const trial = session.trials[session.currentTrialArrayIndex]
  if (!trial) {
    finishInterClassExperiment()
    return
  }

  const token = ++playbackTokenCounter
  session.playbackToken = token
  session.playbackStartedAtClientMs = Date.now()
  answerLocked = true

  executeTask(async () => {
    for (let i = 0; i < trial.data.length; i++) {
      if (!interClassSession || interClassSession.runId !== session.runId) return
      if (interClassSession.playbackToken !== token) return

      const visibleData = trial.data.slice(0, i + 1)
      deps.clearAllCharts()
      deps.drawPlaybackFrame({ trial, visibleData })
      deps.setUiState({
        phase: 'playback',
        testId: session.testId,
        trialIndex: trial.trialIndex,
        totalTrials: session.trials.length,
        scenarioLabel: trial.scenarioLabel,
        variantCode: getInterClassVariantCode(session.testId),
        graphCombinationLabels: getInterClassGraphCombinationLabels(session.testId),
        currentPoint: i + 1,
        totalPoints: trial.data.length,
      })

      await waitMs(FRAME_MS)
    }

    if (!interClassSession || interClassSession.runId !== session.runId) return
    if (interClassSession.playbackToken !== token) return

    showAnswerUi()
  })
}

function showAnswerUi() {
  const deps = activeDeps
  const session = interClassSession
  if (!deps || !session) return

  const trial = session.trials[session.currentTrialArrayIndex]
  if (!trial) {
    finishInterClassExperiment()
    return
  }

  session.answerShownAtClientMs = Date.now()
  answerLocked = false

  deps.setUiState({
    phase: 'answer',
    testId: session.testId,
    trialIndex: trial.trialIndex,
    totalTrials: session.trials.length,
    scenarioLabel: trial.scenarioLabel,
    variantCode: getInterClassVariantCode(session.testId),
    graphCombinationLabels: getInterClassGraphCombinationLabels(session.testId),
  })
}

function handleAnswer(answer: InterClassScenarioAnswer, anomaly: InterClassAnomalyAnswer) {
  const deps = activeDeps
  const session = interClassSession
  if (!deps || !session || answerLocked) return

  const trial = session.trials[session.currentTrialArrayIndex]
  if (!trial) return

  answerLocked = true

  const answeredAtClientMs = Date.now()
  const responseTimeMs = answeredAtClientMs - session.answerShownAtClientMs
  const observationTimeMs = session.answerShownAtClientMs - session.playbackStartedAtClientMs
  const isScenarioCorrect = answer === trial.expectedAnswer
  const isAnomalyCorrect = anomaly === trial.expectedAnomaly
  const isCorrect = isScenarioCorrect && isAnomalyCorrect

  const response = {
    runId: session.runId,
    address: session.address,
    testId: session.testId,
    trialIndex: trial.trialIndex,
    totalTrials: session.trials.length,

    caseId: getInterClassCaseId(session.testId),
    graphCombination: getInterClassGraphCombination(session.testId),
    scenarioId: trial.scenarioId,
    scenarioLabel: trial.scenarioLabel,
    expectedAnswer: trial.expectedAnswer,
    selectedAnswer: answer,
    isScenarioCorrect,
    expectedAnomaly: trial.expectedAnomaly,
    selectedAnomaly: anomaly,
    isAnomalyCorrect,
    anomalyDescription: trial.anomalyDescription,
    isCorrect,
    accuracyType: isCorrect ? 'correct' : 'wrong',

    playbackStartedAtClientMs: session.playbackStartedAtClientMs,
    answerShownAtClientMs: session.answerShownAtClientMs,
    answeredAtClientMs,
    observationTimeMs,
    responseTimeMs,
    totalPoints: trial.data.length,
    createdAtClient: new Date().toISOString(),
  }

  sendResponse(response, deps)
  showVariantLikertUi()
}

function showVariantLikertUi() {
  const deps = activeDeps
  const session = interClassSession
  if (!deps || !session) return

  const trial = session.trials[session.currentTrialArrayIndex]
  if (!trial) return

  session.pendingLikertStartedAtClientMs = Date.now()
  const testNumber = getInterClassTestNumber(session.testId)
  const variant = getInterClassVariantCode(session.testId)

  deps.setUiState({
    phase: 'likert',
    testId: session.testId,
    likertRunId: `${session.runId}-variant-${trial.trialIndex}`,
    likertMode: 'variant',
    trialIndex: trial.trialIndex,
    totalTrials: session.trials.length,
    title: `Inter-class Test ${testNumber} - Variant ${variant} questionnaire`,
    subtitle: `Please answer these 3 questions for Variant ${variant} before continuing.`,
    scaleDescription: getLikertScaleDescription('variant'),
    questions: buildVariantLikertQuestions(session.testId),
    variantCode: variant,
    graphCombinationLabels: getInterClassGraphCombinationLabels(session.testId),
  })
}

function finishCurrentVariantAfterLikert(answers: InterClassLikertAnswers) {
  const deps = activeDeps
  const session = interClassSession
  if (!deps || !session) return

  const trial = session.trials[session.currentTrialArrayIndex]
  if (!trial) return

  const answeredAtClientMs = Date.now()
  const testNumber = getInterClassTestNumber(session.testId)
  const variant = getInterClassVariantCode(session.testId)
  const questions = buildVariantLikertQuestions(session.testId)

  sendResponse({
    responseType: 'inter-class-likert-variant',
    runId: session.runId,
    address: session.address,
    testId: session.testId,
    testNumber,
    variant,
    caseId: getInterClassCaseId(session.testId),
    graphCombination: getInterClassGraphCombination(session.testId),
    scenarioId: trial.scenarioId,
    scenarioLabel: trial.scenarioLabel,
    trialIndex: trial.trialIndex,
    totalTrials: session.trials.length,
    likertMode: 'variant',
    scaleDescription: getLikertScaleDescription('variant'),
    questions,
    answers,
    startedAtClientMs: session.pendingLikertStartedAtClientMs,
    answeredAtClientMs,
    responseTimeMs: answeredAtClientMs - session.pendingLikertStartedAtClientMs,
    createdAtClient: new Date().toISOString(),
  }, deps)

  session.currentTrialArrayIndex++
  showNextTrial()
}

function handleLikertAnswers(answers: InterClassLikertAnswers) {
  if (interClassFinalLikertSession) {
    finishFinalLikert(answers)
    return
  }

  if (interClassSession) {
    finishCurrentVariantAfterLikert(answers)
  }
}

function finishInterClassExperiment() {
  const deps = activeDeps
  const session = interClassSession
  if (!deps || !session) return

  const totalTrials = session.trials.length

  deps.clearAllCharts()
  deps.setAnswerHandler(undefined)
  deps.setLikertHandler(undefined)
  deps.setIntroHandler(undefined)
  deps.setUiState({
    phase: 'finished',
    testId: session.testId,
    trialIndex: totalTrials,
    totalTrials,
  })

  interClassSession = null
  answerLocked = false
  deps.onFinished?.()
}

function startInterClassTest(testId: InterClassTestId, deps: InterClassExperimentDeps) {
  stopInterClassExperiment(false)

  activeDeps = deps
  deps.clearAllCharts()

  const address = getCurrentAddress()
  const session: InterClassSession = {
    runId: createRunId(testId, address),
    address,
    testId,
    trials: buildInterClassTrials(testId),
    currentTrialArrayIndex: 0,
    playbackStartedAtClientMs: 0,
    answerShownAtClientMs: 0,
    playbackToken: 0,
    pendingLikertStartedAtClientMs: 0,
  }

  interClassSession = session
  answerLocked = false
  introLocked = false

  deps.setAnswerHandler(handleAnswer)
  deps.setLikertHandler(handleLikertAnswers)
  saveTrialPlan(session, deps)
  showInterClassIntro()
}

function showFinalLikertUi(testId: InterClassFinalLikertTestId, deps: InterClassExperimentDeps) {
  stopInterClassExperiment(false)

  activeDeps = deps
  deps.clearAllCharts()
  deps.setAnswerHandler(undefined)
  deps.setIntroHandler(undefined)
  deps.setLikertHandler(handleLikertAnswers)

  const address = getCurrentAddress()
  const testNumber = getFinalLikertTestNumber(testId)
  const startedAtClientMs = Date.now()

  interClassFinalLikertSession = {
    runId: createRunId(testId, address),
    address,
    testId,
    testNumber,
    startedAtClientMs,
  }

  deps.setUiState({
    phase: 'likert',
    testId,
    likertRunId: interClassFinalLikertSession.runId,
    likertMode: 'comparative',
    trialIndex: 1,
    totalTrials: 1,
    title: `Inter-class Test ${testNumber} - final comparison`,
    subtitle: 'Answer these 3 questions only after completing both variants A and B. Every statement is phrased as Variant A being better than Variant B.',
    scaleDescription: getLikertScaleDescription('comparative'),
    questions: buildComparativeLikertQuestions(testNumber),
    comparisonGraphCombinationLabels: getInterClassGraphCompositionLabels(testNumber),
  })
}

function finishFinalLikert(answers: InterClassLikertAnswers) {
  const deps = activeDeps
  const session = interClassFinalLikertSession
  if (!deps || !session) return

  const answeredAtClientMs = Date.now()
  const questions = buildComparativeLikertQuestions(session.testNumber)

  sendResponse({
    responseType: 'inter-class-likert-comparative',
    runId: session.runId,
    address: session.address,
    testId: session.testId,
    testNumber: session.testNumber,
    likertMode: 'comparative',
    scaleDescription: getLikertScaleDescription('comparative'),
    questions,
    answers,
    comparisonGraphCombinationLabels: getInterClassGraphCompositionLabels(session.testNumber),
    startedAtClientMs: session.startedAtClientMs,
    answeredAtClientMs,
    responseTimeMs: answeredAtClientMs - session.startedAtClientMs,
    createdAtClient: new Date().toISOString(),
  }, deps)

  deps.clearAllCharts()
  deps.setLikertHandler(undefined)
  deps.setIntroHandler(undefined)
  deps.setUiState({
    phase: 'finished',
    testId: session.testId,
    trialIndex: 1,
    totalTrials: 1,
  })

  interClassFinalLikertSession = null
  deps.onFinished?.()
}

export function startInterClassTest1FinalLikert(deps: InterClassExperimentDeps) {
  showFinalLikertUi(INTER_TEST_1_FINAL_LIKERT_ID, deps)
}

export function startInterClassTest2FinalLikert(deps: InterClassExperimentDeps) {
  showFinalLikertUi(INTER_TEST_2_FINAL_LIKERT_ID, deps)
}

export function startInterClassTest3FinalLikert(deps: InterClassExperimentDeps) {
  showFinalLikertUi(INTER_TEST_3_FINAL_LIKERT_ID, deps)
}

export function startInterClassTest1A(deps: InterClassExperimentDeps) {
  startInterClassTest(INTER_TEST_1_A_ID, deps)
}

export function startInterClassTest1B(deps: InterClassExperimentDeps) {
  startInterClassTest(INTER_TEST_1_B_ID, deps)
}

export function startInterClassTest2A(deps: InterClassExperimentDeps) {
  startInterClassTest(INTER_TEST_2_A_ID, deps)
}

export function startInterClassTest2B(deps: InterClassExperimentDeps) {
  startInterClassTest(INTER_TEST_2_B_ID, deps)
}

export function startInterClassTest3A(deps: InterClassExperimentDeps) {
  startInterClassTest(INTER_TEST_3_A_ID, deps)
}

export function startInterClassTest3B(deps: InterClassExperimentDeps) {
  startInterClassTest(INTER_TEST_3_B_ID, deps)
}

export function stopInterClassExperiment(clearCharts = true) {
  playbackTokenCounter++
  interClassSession = null
  interClassFinalLikertSession = null
  answerLocked = false
  introLocked = false

  if (activeDeps) {
    activeDeps.setUiState({ phase: 'hidden' })
    activeDeps.setAnswerHandler(undefined)
    activeDeps.setLikertHandler(undefined)
    activeDeps.setIntroHandler(undefined)
    if (clearCharts) activeDeps.clearAllCharts()
  }

  activeDeps = null
}

export function isInterClassExperimentActive() {
  return interClassSession !== null || interClassFinalLikertSession !== null
}
