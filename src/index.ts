import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { ColliderLayer, engine, EngineInfo, Entity, executeTask, GltfContainer, Material, Transform } from '@dcl/sdk/ecs'
import {
  setupUi,
  setCategory1ExperimentUiState,
  setCategory1PredictionHandler,
  setCategory1NumericHandler,
  setCategory2CompositionUiState,
  setCategory2AnswerHandler,
  setCategory3QuantitativeUiState,
  setCategory3NumericHandler,
  setCategory3ComparisonHandler,
  setCategory4TemporalUiState,
  setCategory4TemporalAnswerHandler,
  setInterClassUiState,
  setInterClassAnswerHandler,
  setInterClassLikertHandler,
  setInterClassIntroHandler,
  setTestIntroUiState,
  setTestIntroHandler,
  markTestCompletedLocally,
  refreshCompletedTestsFromServer
} from './ui'
import { loadJson } from './loadJson'
import {
  addHeatmapChart3D,
  addBarChart3D,
  addDonutChart3D,
  addTriColorDonutChart3D,
  addSentimentImage,
  hideSentimentImages,
  updateSentimentLight,
  resetSentimentLightToNeutral,
  addSentimentMeter3D,
  removeSentimentMeter3D
} from './chart3d'
import { spawnKanbanBoard } from './kanbanBoard3D'
import { spawnTestSelectorBoard } from './testSelectorBoard'
import type { TestMode, GraphType, TestType } from './testTypes'
import { startCategory1Experiment, stopCategory1Experiment, isCategory1ExperimentActive, type Category1Trial, type Category1ExperimentTestType } from './category1Tests'
import { startCategory2CompositionExperiment, stopCategory2CompositionExperiment, isCategory2CompositionExperimentActive, type Category2CompositionTrial } from './category2Tests'
import { startCategory3QuantitativeExperiment, stopCategory3QuantitativeExperiment, isCategory3QuantitativeExperimentActive, type Category3QuantitativeTrial } from './category3Tests'
import { startCategory4TemporalExperiment, stopCategory4TemporalExperiment, isCategory4TemporalExperimentActive, type Category4TemporalTrial } from './category4Tests'
import {
  startInterClassTest1A,
  startInterClassTest1B,
  startInterClassTest2A,
  startInterClassTest2B,
  startInterClassTest3A,
  startInterClassTest3B,
  startInterClassTest1FinalLikert,
  startInterClassTest2FinalLikert,
  startInterClassTest3FinalLikert,
  stopInterClassExperiment,
  isInterClassExperimentActive,
  type InterClassPlaybackFrame,
} from './interClassTests'

// ---------------------------------------------------------------------------
// General configuration
// ---------------------------------------------------------------------------

const IMG_WHITE = 'assets/images/white-image.png'
const IMG_ALERT = 'assets/images/alert-image.png'

const SERVER_URL = 'https://spore-pox-reformist.ngrok-free.dev'
const REFRESH_INTERVAL = 12 // secondi

// Bar chart permanente dedicato alla sentiment analysis dell'audio.
// È indipendente dai grafici dei test e quindi non viene rimosso da clearAllCharts().
const AUDIO_BAR_CHART_POSITION = { x: -8.28, y: 2.15, z: -15.7 }

// Secondo bar chart permanente dedicato ai dati salvati in audio-sentiment.json.
// Mantiene Y e Z del primo grafico e viene spostato di 6 metri verso X negativa.
const AUDIO_SENTIMENT_BAR_CHART_POSITION = {
  x: AUDIO_BAR_CHART_POSITION.x - 6,
  y: AUDIO_BAR_CHART_POSITION.y,
  z: AUDIO_BAR_CHART_POSITION.z,
}

// Terzo bar chart permanente con la combinazione pesata dei due flussi.
// Mantiene la stessa X, viene spostato di 2 metri verso Z positiva
// ed è ruotato di 180° sull'asse Y.
const COMBINED_SENTIMENT_BAR_CHART_POSITION = {
  x: AUDIO_SENTIMENT_BAR_CHART_POSITION.x+8.28,
  y: AUDIO_SENTIMENT_BAR_CHART_POSITION.y,
  z: AUDIO_SENTIMENT_BAR_CHART_POSITION.z+6,
}

type MyRow = {
  id: number
  value: number
  labels: string[]
  timestamp?: string
}

let imageEntity: Entity | null = null
let sentimentImageEntity: Entity | null = null

let chartRootDone: Entity | null = null
let chartRootTodo: Entity | null = null
let chartRoot: Entity | null = null
let chartRootDonut: Entity | null = null
let chartRootTriColor: Entity | null = null
let chartRootHeatmap: Entity | null = null
let chartRootMeter: Entity | null = null

// Root separati: non devono essere toccati dalla pulizia dei grafici usati nei test.
let persistentAudioBarChartRoot: Entity | null = null
let persistentAudioSentimentBarChartRoot: Entity | null = null
let persistentCombinedSentimentBarChartRoot: Entity | null = null

let nextFetch = 0
let isFetching = false
let redrawAfterCurrentFetch = false
let data: MyRow[] = []

const INTRO_PREVIEW_DATA: MyRow[] = [
  { id: 1, value: 3.2, labels: ['negative', 'neutral'] },
  { id: 2, value: 4.1, labels: ['neutral', 'neutral'] },
  { id: 3, value: 5.4, labels: ['neutral', 'positive'] },
  { id: 4, value: 6.7, labels: ['positive', 'neutral'] },
  { id: 5, value: 7.8, labels: ['positive', 'positive'] },
]

// ---------------------------------------------------------------------------
// Experimental configuration state selected through the NPC
// ---------------------------------------------------------------------------

type SelectedTest = {
  mode:   TestMode
  graphs: GraphType[]   // one or more charts active at the same time
  test?:  TestType
}

let selectedTest: SelectedTest = {
  mode:   'none',
  graphs: [],
}

type AllTestsSequenceStep = {
  mode: 'intra' | 'inter'
  graphs: GraphType[]
  test: Exclude<TestType, 'all-tests'>
}

const ALL_TEST_CAT1_GRAPHS: GraphType[] = ['sentiment-image', 'sentiment-light', 'simple-donut', 'sentiment-meter']
const ALL_TEST_CAT3_GRAPHS: GraphType[] = ['simple-donut', 'sentiment-meter']
const ALL_TEST_CAT4_GRAPHS: GraphType[] = ['bar-chart', 'heatmap']

const ALL_TESTS_SEQUENCE: AllTestsSequenceStep[] = [
  { mode: 'intra', graphs: ALL_TEST_CAT1_GRAPHS, test: 'test-1-1' },
  { mode: 'intra', graphs: ALL_TEST_CAT1_GRAPHS, test: 'test-1-2' },
  { mode: 'intra', graphs: ['tricolor-donut'], test: 'test-composition' },
  { mode: 'intra', graphs: ALL_TEST_CAT3_GRAPHS, test: 'test-3-1' },
  { mode: 'intra', graphs: ALL_TEST_CAT3_GRAPHS, test: 'test-3-2' },
  { mode: 'intra', graphs: ALL_TEST_CAT4_GRAPHS, test: 'test-temporal' },
  { mode: 'inter', graphs: ['sentiment-image', 'bar-chart'], test: 'inter-test-1-a' },
  { mode: 'inter', graphs: ['sentiment-meter', 'bar-chart'], test: 'inter-test-1-b' },
  { mode: 'inter', graphs: [], test: 'inter-test-1-final-likert' },
  { mode: 'inter', graphs: ['sentiment-image', 'bar-chart'], test: 'inter-test-2-a' },
  { mode: 'inter', graphs: ['tricolor-donut', 'bar-chart'], test: 'inter-test-2-b' },
  { mode: 'inter', graphs: [], test: 'inter-test-2-final-likert' },
  { mode: 'inter', graphs: ['sentiment-meter', 'tricolor-donut'], test: 'inter-test-3-a' },
  { mode: 'inter', graphs: ['bar-chart'], test: 'inter-test-3-b' },
  { mode: 'inter', graphs: [], test: 'inter-test-3-final-likert' },
]

let allTestsSequenceActive = false
let allTestsSequenceQueue: AllTestsSequenceStep[] = []
let allTestsStartingNextStep = false

function getSelectedTestLabel() {
  if (selectedTest.mode === 'none') return 'No test selected'
  if (selectedTest.mode === 'all') return 'All tests sequence'
  const labelMode = selectedTest.mode === 'inter' ? 'Inter-class' : 'Intra-class'
  return `${labelMode}: [${selectedTest.graphs.join(', ')}] / ${selectedTest.test ?? 'test not chosen'}`
}

function cancelAllTestsSequence() {
  allTestsSequenceActive = false
  allTestsSequenceQueue = []
}

function hideTestIntro() {
  setTestIntroHandler(undefined)
  setTestIntroUiState({ phase: 'hidden' })
}


function stopAllGuidedExperiments(clearCharts = false) {
  stopCategory1Experiment(clearCharts)
  stopCategory2CompositionExperiment(clearCharts)
  stopCategory3QuantitativeExperiment(clearCharts)
  stopCategory4TemporalExperiment(clearCharts)
  stopInterClassExperiment(clearCharts)
}

function hideAllGuidedTestUi() {
  setCategory1PredictionHandler(undefined)
  setCategory1NumericHandler(undefined)
  setCategory1ExperimentUiState({ phase: 'hidden' })

  setCategory2AnswerHandler(undefined)
  setCategory2CompositionUiState({ phase: 'hidden' })

  setCategory3NumericHandler(undefined)
  setCategory3ComparisonHandler(undefined)
  setCategory3QuantitativeUiState({ phase: 'hidden' })

  setCategory4TemporalAnswerHandler(undefined)
  setCategory4TemporalUiState({ phase: 'hidden' })

  setInterClassAnswerHandler(undefined)
  setInterClassLikertHandler(undefined)
  setInterClassIntroHandler(undefined)
  setInterClassUiState({ phase: 'hidden' })
}

function cleanupCurrentTestScreen(clearCharts = true) {
  stopAllGuidedExperiments(false)
  hideTestIntro()
  hideAllGuidedTestUi()
  redrawAfterCurrentFetch = false

  if (clearCharts) {
    clearAllCharts()
  }
}

function cleanupBeforeStartingTest() {
  stopAllGuidedExperiments(false)
  hideAllGuidedTestUi()
  redrawAfterCurrentFetch = false
  clearAllCharts()
}

type TestIntroContent = {
  title: string
  description: string
  instructions: string[]
  note?: string
}

function getGraphLabel(graph: GraphType) {
  switch (graph) {
    case 'sentiment-image': return 'sentiment emoji/image'
    case 'sentiment-light': return 'sentiment light'
    case 'simple-donut': return 'simple donut chart'
    case 'sentiment-meter': return 'sentiment bar/meter'
    case 'tricolor-donut': return 'three-colour donut chart'
    case 'bar-chart': return 'temporal bar chart'
    case 'heatmap': return 'heatmap'
    default: return graph
  }
}

function getInterClassIntroVariant(test?: TestType) {
  switch (test) {
    case 'inter-test-1-a': return { testNumber: 1, variant: 'A' }
    case 'inter-test-1-b': return { testNumber: 1, variant: 'B' }
    case 'inter-test-2-a': return { testNumber: 2, variant: 'A' }
    case 'inter-test-2-b': return { testNumber: 2, variant: 'B' }
    case 'inter-test-3-a': return { testNumber: 3, variant: 'A' }
    case 'inter-test-3-b': return { testNumber: 3, variant: 'B' }
    default: return undefined
  }
}

function getInterClassFinalGraphComposition(testNumber: 1 | 2 | 3) {
  if (testNumber === 2) {
    return {
      variantA: ['sentiment-image', 'bar-chart'] as GraphType[],
      variantB: ['tricolor-donut', 'bar-chart'] as GraphType[],
    }
  }

  if (testNumber === 3) {
    return {
      variantA: ['sentiment-meter', 'tricolor-donut'] as GraphType[],
      variantB: ['bar-chart'] as GraphType[],
    }
  }

  return {
    variantA: ['sentiment-image', 'bar-chart'] as GraphType[],
    variantB: ['sentiment-meter', 'bar-chart'] as GraphType[],
  }
}

function getInterClassFinalGraphCompositionText(testNumber: 1 | 2 | 3) {
  const composition = getInterClassFinalGraphComposition(testNumber)
  return {
    variantA: composition.variantA.map(getGraphLabel).join(', '),
    variantB: composition.variantB.map(getGraphLabel).join(', '),
  }
}

function getTestIntroContent(mode: TestMode, graphs: GraphType[], test?: TestType): TestIntroContent | null {
  const graphText = graphs.length > 0 ? graphs.map(getGraphLabel).join(', ') : 'the questionnaire screen'

  switch (test) {
    case 'all-tests':
      return {
        title: 'Complete all tests',
        description: 'You will complete the full sequence of tests using the GUI controls.',
        instructions: [
          'Follow the instructions shown during each test.',
          'Answer using the GUI controls when they appear.',
          'The sequence will continue automatically from one test to the next whenever possible.',
        ],
        note: 'Press Start when you are ready to begin the full flow.',
      }

    case 'test-1-1':
      return {
        title: 'Intra-class Test 1.1 - immediate sentiment recognition',
        description: `You will complete this test using: ${graphText}.`,
        instructions: [
          `Look at the visualization shown in the scene: ${graphText}.`,
          'Choose the sentiment label that best describes what the element is communicating.',
          'Rely on your first interpretation.',
        ],
        note: 'Press Start when you are ready to begin.',
      }

    case 'test-1-2':
      return {
        title: 'Intra-class Test 1.2 - numeric interpretation',
        description: `You will complete this test using: ${graphText}.`,
        instructions: [
          `Observe the visualization shown in the scene: ${graphText}.`,
          'Assign a value from 0 to 10 to the sentiment you perceive.',
          'Use the number that best represents your interpretation of the visual feedback.',
        ],
      }

    case 'test-composition':
      return {
        title: 'Intra-class Test 2 - sentiment composition',
        description: 'You will complete this test using: three-colour donut chart.',
        instructions: [
          'Identify the dominant sentiment class: positive, neutral, negative or unclear.',
          'Estimate the percentage of positive, neutral and negative messages.',
          'Use the chart to read the distribution between the three classes.',
        ],
      }

    case 'test-3-1':
      return {
        title: 'Intra-class Test 3.1 - precise value estimation',
        description: `You will complete this test using: ${graphText}.`,
        instructions: [
          `Observe the visualization shown in the scene: ${graphText}.`,
          'Enter the value you think it indicates on a 0-10 scale.',
          'Use one decimal digit when needed.',
        ],
      }

    case 'test-3-2':
      return {
        title: 'Intra-class Test 3.2 - comparison between values',
        description: `You will complete this test using: ${graphText}.`,
        instructions: [
          'Look at both visualizations displayed in the scene.',
          'Select which one indicates a more positive sentiment.',
          'Estimate how far apart the two values are.',
        ],
      }

    case 'test-temporal':
      return {
        title: 'Intra-class Test 4 - temporal sentiment reading',
        description: `You will complete this test using: ${graphText}.`,
        instructions: [
          `Observe the temporal visualization shown in the scene: ${graphText}.`,
          'Decide whether the conversation is improving, worsening or remaining stable.',
          'Report whether there are significant moments, peaks or anomalies.',
        ],
      }

    case 'inter-test-1-final-likert':
    case 'inter-test-2-final-likert':
    case 'inter-test-3-final-likert': {
      const testNumber = test === 'inter-test-2-final-likert' ? 2 : test === 'inter-test-3-final-likert' ? 3 : 1
      const composition = getInterClassFinalGraphCompositionText(testNumber)
      return {
        title: `Inter-class Test ${testNumber} - final Likert scale`,
        description: `You will complete the final questionnaire using the 1-5 Likert scale in the GUI. Variant A uses: ${composition.variantA}. Variant B uses: ${composition.variantB}.`,
        instructions: [
          `Variant A: ${composition.variantA}.`,
          `Variant B: ${composition.variantB}.`,
          'Read each statement carefully.',
          'Answer using the 1-5 Likert scale shown in the GUI.',
          'Base your answers on the two variants you observed, not on a single scenario only.',
        ],
        note: 'Press Start to open the final scale.',
      }
    }

    case 'inter-test-1-a':
    case 'inter-test-1-b':
    case 'inter-test-2-a':
    case 'inter-test-2-b':
    case 'inter-test-3-a':
    case 'inter-test-3-b': {
      const variantInfo = getInterClassIntroVariant(test)
      const variantText = variantInfo ? `Inter-class Test ${variantInfo.testNumber} - Variant ${variantInfo.variant}` : 'Inter-class test'
      return {
        title: `${variantText} - meeting simulation`,
        description: `You will complete Variant ${variantInfo?.variant ?? ''} using: ${graphText}.`,
        instructions: [
          `Current variant: Variant ${variantInfo?.variant ?? ''}.`,
          `Use the visualization combination selected for this variant: ${graphText}.`,
          'Track the general sentiment trend during the playback.',
          'At the end, answer the GUI questions about the trend and any significant changes.',
        ],
        note: 'Press Start when you are ready to begin the simulation.',
      }
    }

    default:
      if (mode === 'inter') {
        return {
          title: 'Inter-class test',
          description: `You will complete this test using: ${graphText}.`,
          instructions: [
            'Observe the visualizations in the scene.',
            'Use the GUI to answer the questions when prompted.',
          ],
        }
      }
      return null
  }
}

function showIntroPreviewCharts(graphs: GraphType[]) {
  if (graphs.length === 0) {
    clearAllCharts()
    return
  }

  clearAllCharts()

  // Draw synchronously so the participant can identify the selected charts
  // while reading the intro. If live data has not arrived yet, use a small
  // preview-only dataset instead of leaving the scene empty.
  const previewData = data.length > 0 ? data : INTRO_PREVIEW_DATA
  drawSelectedCharts(previewData, [], [])

  // Also force a fresh fetch now instead of waiting for the next polling tick.
  requestImmediateRedraw()
}

function runAfterOptionalIntro(mode: TestMode, graphs: GraphType[], test: TestType | undefined, startFlow: () => void) {
  if (!test) {
    hideTestIntro()
    cleanupBeforeStartingTest()
    startFlow()
    return
  }

  const intro = getTestIntroContent(mode, graphs, test)
  if (!intro) {
    hideTestIntro()
    cleanupBeforeStartingTest()
    startFlow()
    return
  }

  setTestIntroHandler(() => {
    hideTestIntro()
    cleanupBeforeStartingTest()
    startFlow()
  })
  setTestIntroUiState({
    phase: 'visible',
    ...intro,
  })
  showIntroPreviewCharts(graphs)
}

function refreshCompletedTestsSoon(test?: TestType) {
  if (test) markTestCompletedLocally(test)
  refreshCompletedTestsFromServer()

  // The server may still be finishing the JSON write when onFinished is called.
  // A second refresh shortly after avoids showing stale progress in the GUI.
  setTimeout(() => {
    refreshCompletedTestsFromServer()
  }, 1200)
}

function finishSelectedTestOrContinueAllTests() {
  refreshCompletedTestsSoon(selectedTest.test)

  if (allTestsSequenceActive) {
    startNextAllTestsStep()
    return
  }

  selectedTest = { mode: 'none', graphs: [] }
}

function startNextAllTestsStep() {
  const nextStep = allTestsSequenceQueue.shift()

  if (!nextStep) {
    cancelAllTestsSequence()
    selectedTest = { mode: 'none', graphs: [] }
    clearAllCharts()
    refreshCompletedTestsSoon('all-tests')
    console.log('[ALL TESTS] Sequence completed')
    return
  }

  allTestsStartingNextStep = true
  try {
    selectTest(nextStep.mode, nextStep.graphs, nextStep.test)
  } finally {
    allTestsStartingNextStep = false
  }
}

function startAllTestsSequence() {
  cleanupCurrentTestScreen(true)

  allTestsSequenceQueue = [...ALL_TESTS_SEQUENCE]
  allTestsSequenceActive = true
  selectedTest = { mode: 'all', graphs: [], test: 'all-tests' }
  console.log('[ALL TESTS] Sequence started')

  startNextAllTestsStep()
}

// graphs can be a single GraphType or an array — always normalized to an array
function selectTest(mode: TestMode, graphs?: GraphType | GraphType[], test?: TestType) {
  const graphList: GraphType[] = graphs === undefined
    ? []
    : Array.isArray(graphs) ? graphs : [graphs]

  cleanupCurrentTestScreen(true)

  if (!allTestsStartingNextStep && test !== 'all-tests') {
    cancelAllTestsSequence()
  }

  if (test === 'all-tests') {
    runAfterOptionalIntro(mode, graphList, test, startAllTestsSequence)
    return
  }

  // Final comparative Likert scales for inter-class tests.
  // These are launched from the third option on each inter-class A/B selection screen.
  if (mode === 'inter' && (test === 'inter-test-1-final-likert' || test === 'inter-test-2-final-likert' || test === 'inter-test-3-final-likert')) {
    stopCategory1Experiment(false)
    stopCategory2CompositionExperiment(false)
    stopCategory3QuantitativeExperiment(false)
    stopCategory4TemporalExperiment(false)
    stopInterClassExperiment(false)

    selectedTest = { mode, graphs: graphList, test }
    console.log('[TEST SELECTED]', getSelectedTestLabel())

    const startFinalLikert = test === 'inter-test-2-final-likert'
      ? startInterClassTest2FinalLikert
      : test === 'inter-test-3-final-likert'
        ? startInterClassTest3FinalLikert
        : startInterClassTest1FinalLikert

    runAfterOptionalIntro(mode, graphList, test, () => {
      startFinalLikert({
        serverUrl: SERVER_URL,
        clearAllCharts,
        drawPlaybackFrame: drawInterClassTest1AFrame,
        setUiState: setInterClassUiState,
        setAnswerHandler: setInterClassAnswerHandler,
        setLikertHandler: setInterClassLikertHandler,
        setIntroHandler: setInterClassIntroHandler,
        onFinished: finishSelectedTestOrContinueAllTests,
      })
    })
    return
  }

  // Guided inter-class tests:
  // Test 1A: sentiment emoji + temporal bar chart.
  // Test 1B: sentiment meter + temporal bar chart.
  // Test 2A: sentiment emoji + temporal bar chart.
  // Test 2B: sentiment emoji + tricolor donut + temporal bar chart.
  // Test 3A: sentiment meter + tricolor donut, without explicit temporal chart.
  // Test 3B: temporal bar chart only.
  if (mode === 'inter' && (test === 'inter-test-1-a' || test === 'inter-test-1-b' || test === 'inter-test-2-a' || test === 'inter-test-2-b' || test === 'inter-test-3-a' || test === 'inter-test-3-b')) {
    stopCategory1Experiment(false)
    stopCategory2CompositionExperiment(false)
    stopCategory3QuantitativeExperiment(false)
    stopCategory4TemporalExperiment(false)
    stopInterClassExperiment(false)

    selectedTest = { mode, graphs: graphList, test }
    console.log('[TEST SELECTED]', getSelectedTestLabel())

    const startInterClassTest = test === 'inter-test-1-b'
      ? startInterClassTest1B
      : test === 'inter-test-2-a'
        ? startInterClassTest2A
        : test === 'inter-test-2-b'
          ? startInterClassTest2B
          : test === 'inter-test-3-a'
            ? startInterClassTest3A
            : test === 'inter-test-3-b'
              ? startInterClassTest3B
              : startInterClassTest1A

    const drawPlaybackFrame = test === 'inter-test-1-b'
      ? drawInterClassTest1BFrame
      : test === 'inter-test-2-b'
        ? drawInterClassTest2BFrame
        : test === 'inter-test-3-a'
          ? drawInterClassTest3AFrame
          : test === 'inter-test-3-b'
            ? drawInterClassTest3BFrame
            : drawInterClassTest1AFrame

    runAfterOptionalIntro(mode, graphList, test, () => {
      startInterClassTest({
        serverUrl: SERVER_URL,
        clearAllCharts,
        drawPlaybackFrame,
        setUiState: setInterClassUiState,
        setAnswerHandler: setInterClassAnswerHandler,
        setLikertHandler: setInterClassLikertHandler,
        setIntroHandler: setInterClassIntroHandler,
        onFinished: finishSelectedTestOrContinueAllTests,
      })
    })
    return
  }

  // Guided Category 1 tests: they start countdown, randomized trials,
  // response UI and server-side saving.
  if (mode === 'intra' && (test === 'test-1-1' || test === 'test-1-2')) {
    stopCategory2CompositionExperiment(false)
    stopCategory3QuantitativeExperiment(false)
    stopCategory4TemporalExperiment(false)
    stopInterClassExperiment(false)

    selectedTest = { mode, graphs: graphList, test }
    console.log('[TEST SELECTED]', getSelectedTestLabel())

    runAfterOptionalIntro(mode, graphList, test, () => {
      startCategory1Experiment(test as Category1ExperimentTestType, {
        serverUrl: SERVER_URL,
        clearAllCharts,
        drawTrialGraph: drawCategory1TrialGraph,
        setUiState: setCategory1ExperimentUiState,
        setPredictionHandler: setCategory1PredictionHandler,
        setNumericHandler: setCategory1NumericHandler,
        onFinished: finishSelectedTestOrContinueAllTests,
      })
    })
    return
  }

  // Guided Category 2 test: controlled tricolor donut configurations,
  // dominant-class answer and percentage estimates.
  if (mode === 'intra' && test === 'test-composition') {
    stopCategory1Experiment(false)
    stopCategory3QuantitativeExperiment(false)
    stopCategory4TemporalExperiment(false)
    stopInterClassExperiment(false)

    selectedTest = { mode, graphs: graphList, test }
    console.log('[TEST SELECTED]', getSelectedTestLabel())

    runAfterOptionalIntro(mode, graphList, test, () => {
      startCategory2CompositionExperiment({
        serverUrl: SERVER_URL,
        clearAllCharts,
        drawTrialGraph: drawCategory2TrialGraph,
        setUiState: setCategory2CompositionUiState,
        setAnswerHandler: setCategory2AnswerHandler,
        onFinished: finishSelectedTestOrContinueAllTests,
      })
    })
    return
  }

  // Guided Category 3 tests:
  // 3.1 estimates a single quantitative value.
  // 3.2 compares two quantitative visualizations and estimates their distance.
  if (mode === 'intra' && (test === 'test-3-1' || test === 'test-3-2')) {
    stopCategory1Experiment(false)
    stopCategory2CompositionExperiment(false)
    stopCategory4TemporalExperiment(false)
    stopInterClassExperiment(false)

    selectedTest = { mode, graphs: graphList, test }
    console.log('[TEST SELECTED]', getSelectedTestLabel())

    runAfterOptionalIntro(mode, graphList, test, () => {
      startCategory3QuantitativeExperiment(test, {
        serverUrl: SERVER_URL,
        clearAllCharts,
        drawTrialGraph: drawCategory3QuantitativeTrialGraph,
        setUiState: setCategory3QuantitativeUiState,
        setNumericHandler: setCategory3NumericHandler,
        setComparisonHandler: setCategory3ComparisonHandler,
        onFinished: finishSelectedTestOrContinueAllTests,
      })
    })
    return
  }

  // Guided Category 4 temporal test:
  // 6 scenarios, 3 assigned to bar chart and 3 to heatmap, alternating graph type.
  if (mode === 'intra' && test === 'test-temporal') {
    stopCategory1Experiment(false)
    stopCategory2CompositionExperiment(false)
    stopCategory3QuantitativeExperiment(false)
    stopInterClassExperiment(false)

    selectedTest = { mode, graphs: graphList, test }
    console.log('[TEST SELECTED]', getSelectedTestLabel())

    runAfterOptionalIntro(mode, graphList, test, () => {
      startCategory4TemporalExperiment({
        serverUrl: SERVER_URL,
        clearAllCharts,
        drawTrialGraph: drawCategory4TemporalTrialGraph,
        setUiState: setCategory4TemporalUiState,
        setAnswerHandler: setCategory4TemporalAnswerHandler,
        onFinished: finishSelectedTestOrContinueAllTests,
      })
    })
    return
  }

  // When switching to another test, close any active guided test.
  stopCategory1Experiment(false)
  stopCategory2CompositionExperiment(false)
  stopCategory3QuantitativeExperiment(false)
  stopCategory4TemporalExperiment(false)
  stopInterClassExperiment(false)
  hideTestIntro()

  selectedTest = { mode, graphs: graphList, test }
  console.log('[TEST SELECTED]', getSelectedTestLabel())
  clearAllCharts()

  // If data is already loaded, apply the configuration immediately
  // without waiting for the next polling tick. A fresh fetch still follows.
  if (data.length > 0) {
    drawSelectedCharts(data, [], [])
  }

  requestImmediateRedraw()
}

// ---------------------------------------------------------------------------
// Global alert — counting logic lives on the server
// ---------------------------------------------------------------------------

export function sendDiscomfortClick(name?: string | undefined) {
  if (!imageEntity) {
    console.log('Image obj does not exist in scene')
    return
  }

  executeTask(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/alert/click`, { method: 'POST' })
      if (!res.ok) {
        console.log('Error /alert/click:', res.status)
        return
      }
      const responseData = await res.json()
      console.log(`[ALERT] click registered — window total: ${responseData.count}, triggered: ${responseData.triggered}`)
    } catch (e) {
      console.log('Fetch error /alert/click', e)
    }
  })

  console.log(`[DISCOMFORT] ${name ?? 'Unknown'} clicked discomfort`)
}

export function setSceneImage(img: string) {
  if (!imageEntity) {
    console.log('Image obj does not exist in scene')
    return
  }
  Material.setBasicMaterial(imageEntity, {
    texture: Material.Texture.Common({ src: img })
  })
}

// ---------------------------------------------------------------------------
// Polling alert state from the server
// ---------------------------------------------------------------------------

let lastAlertState = false
let alertPollingAccumulator = 0
const ALERT_POLLING_INTERVAL = 2

engine.addSystem((deltaTime: number) => {
  alertPollingAccumulator += deltaTime
  if (alertPollingAccumulator < ALERT_POLLING_INTERVAL) return
  alertPollingAccumulator = 0

  executeTask(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/alert/state`)
      if (!res.ok) return
      const responseData = await res.json()
      const active: boolean = responseData.active
      if (active !== lastAlertState) {
        lastAlertState = active
        setSceneImage(active ? IMG_ALERT : IMG_WHITE)
        console.log(`[ALERT] state changed → ${active ? 'ALERT' : 'normal'}`)
      }
    } catch (e) {
      console.log('Fetch error /alert/state', e)
    }
  })
})

// ---------------------------------------------------------------------------
// Clear charts
// ---------------------------------------------------------------------------

function clearAllCharts() {
  if (chartRootDone) { engine.removeEntityWithChildren(chartRootDone); chartRootDone = null }
  if (chartRootTodo) { engine.removeEntityWithChildren(chartRootTodo); chartRootTodo = null }
  if (chartRoot)     { engine.removeEntityWithChildren(chartRoot);     chartRoot = null     }
  if (chartRootDonut) { engine.removeEntityWithChildren(chartRootDonut); chartRootDonut = null }
  if (chartRootTriColor) { engine.removeEntityWithChildren(chartRootTriColor); chartRootTriColor = null }
  if (chartRootHeatmap)  { engine.removeEntityWithChildren(chartRootHeatmap);  chartRootHeatmap = null  }
  removeSentimentMeter3D()
  chartRootMeter = null
  hideSentimentImages()
  sentimentImageEntity = null
  resetSentimentLightToNeutral()
}

function drawCategory1TrialGraph(trial: Category1Trial) {
  switch (trial.graph) {
    case 'sentiment-image':
      sentimentImageEntity = addSentimentImage(trial.value, {
        position: { x: -12.2, y: 3, z: -2.8 },
        rotation: { x: 0, y: 90, z: 0 },
        scale: { x: 2, y: 2, z: 2 },
      })
      break

    case 'sentiment-light':
      updateSentimentLight(trial.value, {
        position: { x: -4.2, y: 3, z: -2.8 },
        intensity: 40000,
      })
      break

    case 'simple-donut':
      chartRootDonut = addDonutChart3D({
        position: { x: -1.5, y: 3, z: 5.98 },
        value: trial.value,
        maxValue: 10,
        outerRadius: 1,
        innerRadius: 0.6,
        showLabel: false,
        zOffset: 0.01,
      })
      break

    case 'sentiment-meter':
      chartRootMeter = addSentimentMeter3D({
        value: trial.value,
        position: { x: -12.28, y: 1, z: 0 },
        rotation: { x: 0, y: 270, z: 0 },
        width: 4,
        barHeight: 0.25,
        showLabels: true,
        showValue: false,
        zOffset: 0.01,
      })
      break
  }
}


function drawCategory2TrialGraph(trial: Category2CompositionTrial) {
  chartRootTriColor = addTriColorDonutChart3D({
    negativeCount: trial.negativePercent,
    neutralCount: trial.neutralPercent,
    positiveCount: trial.positivePercent,
    position: { x: -7, y: 3, z: 5.98 },
    outerRadius: 1,
    innerRadius: 0.6,
    zOffset: 0.01,
  })
}

function drawCategory3QuantitativeTrialGraph(trial: Category3QuantitativeTrial) {
  if (trial.kind === 'comparison') {
    const donutValue = trial.leftGraph === 'simple-donut' ? trial.leftValue : trial.rightValue
    const meterValue = trial.leftGraph === 'sentiment-meter' ? trial.leftValue : trial.rightValue

    chartRootDonut = addDonutChart3D({
      position: { x: -1.5, y: 3, z: 5.98 },
      value: donutValue,
      maxValue: 10,
      outerRadius: 1,
      innerRadius: 0.6,
      showLabel: false,
      zOffset: 0.01,
    })

    chartRootMeter = addSentimentMeter3D({
      value: meterValue,
      position: { x: -12.28, y: 1, z: 0 },
      rotation: { x: 0, y: 270, z: 0 },
      width: 4,
      barHeight: 0.25,
      showLabels: true,
      showValue: false,
      zOffset: 0.01,
    })

    return
  }

  switch (trial.graph) {
    case 'simple-donut':
      chartRootDonut = addDonutChart3D({
        position: { x: -1.5, y: 3, z: 5.98 },
        value: trial.value,
        maxValue: 10,
        outerRadius: 1,
        innerRadius: 0.6,
        showLabel: false,
        zOffset: 0.01,
      })
      break

    case 'sentiment-meter':
      chartRootMeter = addSentimentMeter3D({
        value: trial.value,
        position: { x: -12.28, y: 1, z: 0 },
        rotation: { x: 0, y: 270, z: 0 },
        width: 4,
        barHeight: 0.25,
        showLabels: true,
        showValue: false,
        zOffset: 0.01,
      })
      break
  }
}

function drawCategory4TemporalTrialGraph(trial: Category4TemporalTrial) {
  switch (trial.graph) {
    case 'bar-chart':
      chartRoot = addBarChart3D(trial.values, {
        position: { x: -3.6, y: 2.1, z: -7.48 },
        width: 4,
        height: 2,
        yMax: 10,
        grid: true,
        labels: true,
        mirrorX: true,
        zOffset: 0.01,
      })
      break

    case 'heatmap':
      chartRootHeatmap = addHeatmapChart3D(trial.values, {
        position: { x: -12.2, y: 2.2, z: 0 },
        rotation: { x: 0, y: 270, z: 0 },
        cellSize: 0.2,
        showValues: false,
        zOffset: 0.01,
        maxItems: 300,
      })
      break
  }
}

function drawInterClassTest1AFrame(frame: InterClassPlaybackFrame) {
  clearAllCharts()

  const latest = frame.visibleData[frame.visibleData.length - 1]
  if (!latest) return

  sentimentImageEntity = addSentimentImage(latest.value, {
    position: { x: -12.2, y: 3, z: -2.8 },
    rotation: { x: 0, y: 90, z: 0 },
    scale: { x: 2, y: 2, z: 2 },
  })

  chartRoot = addBarChart3D(frame.visibleData, {
    position: { x: -3.6, y: 2.1, z: -7.48 },
    width: 4,
    height: 2,
    yMax: 10,
    grid: true,
    labels: true,
    mirrorX: true,
    zOffset: 0.01,
  })
}

function drawInterClassTest1BFrame(frame: InterClassPlaybackFrame) {
  clearAllCharts()

  const latest = frame.visibleData[frame.visibleData.length - 1]
  if (!latest) return

  chartRootMeter = addSentimentMeter3D({
    value: latest.value,
    position: { x: -12.28, y: 1, z: 0 },
    rotation: { x: 0, y: 270, z: 0 },
    width: 4,
    barHeight: 0.25,
    showLabels: true,
    showValue: false,
    zOffset: 0.01,
  })

  chartRoot = addBarChart3D(frame.visibleData, {
    position: { x: -3.6, y: 2.1, z: -7.48 },
    width: 4,
    height: 2,
    yMax: 10,
    grid: true,
    labels: true,
    mirrorX: true,
    zOffset: 0.01,
  })
}

function drawInterClassTest2BFrame(frame: InterClassPlaybackFrame) {
  clearAllCharts()

  const latest = frame.visibleData[frame.visibleData.length - 1]
  if (!latest) return

  const counts = latest.labels.reduce(
    (acc, label) => { acc[label] = (acc[label] ?? 0) + 1; return acc },
    {} as Record<string, number>
  )

  chartRootTriColor = addTriColorDonutChart3D({
    negativeCount: counts['negative'] ?? 0,
    neutralCount: counts['neutral'] ?? 0,
    positiveCount: counts['positive'] ?? 0,
    position: { x: -7, y: 3, z: 5.98 },
  })

  chartRoot = addBarChart3D(frame.visibleData, {
    position: { x: -3.6, y: 2.1, z: -7.48 },
    width: 4,
    height: 2,
    yMax: 10,
    grid: true,
    labels: true,
    mirrorX: true,
    zOffset: 0.01,
  })
}

function drawInterClassTest3AFrame(frame: InterClassPlaybackFrame) {
  clearAllCharts()

  const latest = frame.visibleData[frame.visibleData.length - 1]
  if (!latest) return

  chartRootMeter = addSentimentMeter3D({
    value: latest.value,
    position: { x: -12.28, y: 1, z: 0 },
    rotation: { x: 0, y: 270, z: 0 },
    width: 4,
    barHeight: 0.25,
    showLabels: true,
    showValue: false,
    zOffset: 0.01,
  })

  const counts = latest.labels.reduce(
    (acc, label) => { acc[label] = (acc[label] ?? 0) + 1; return acc },
    {} as Record<string, number>
  )

  chartRootTriColor = addTriColorDonutChart3D({
    negativeCount: counts['negative'] ?? 0,
    neutralCount: counts['neutral'] ?? 0,
    positiveCount: counts['positive'] ?? 0,
    position: { x: -7, y: 3, z: 5.98 },
  })
}

function drawInterClassTest3BFrame(frame: InterClassPlaybackFrame) {
  clearAllCharts()

  chartRoot = addBarChart3D(frame.visibleData, {
    position: { x: -3.6, y: 2.1, z: -7.48 },
    width: 4,
    height: 2,
    yMax: 10,
    grid: true,
    labels: true,
    mirrorX: true,
    zOffset: 0.01,
  })
}


// ---------------------------------------------------------------------------
// Draw charts based on the selected test
// ---------------------------------------------------------------------------

function getLatestRow(rows: MyRow[]) {
  return rows.length > 0 ? rows[rows.length - 1] : undefined
}

function getLatestLabelCounts(rows: MyRow[]) {
  const latest = getLatestRow(rows)
  return (latest?.labels ?? []).reduce(
    (acc, label) => { acc[label] = (acc[label] ?? 0) + 1; return acc },
    {} as Record<string, number>
  )
}

function drawSelectedCharts(newData: MyRow[], newDoneData: MyRow[], newTodoData: MyRow[]) {
  if (selectedTest.mode === 'none') {
    console.log('[TEST] No test selected: charts hidden')
    data = newData
    return
  }


  const latest = getLatestRow(newData)
  if (!latest) {
    console.log('[TEST] No data in data.json')
    return
  }

  const counts = getLatestLabelCounts(newData)

  for (const graph of selectedTest.graphs) {
    switch (graph) {
      case 'sentiment-image':
        sentimentImageEntity = addSentimentImage(latest.value, {
          position: { x: -12.2, y: 3, z: -2.8 },
          rotation: { x: 0, y: 90, z: 0 },
          scale: { x: 2, y: 2, z: 2 }
        })
        break

      case 'sentiment-light':
        updateSentimentLight(latest.value, {
          position: { x: -4.2, y: 3, z: -2.8 },
          intensity: 40000
        })
        break

      case 'simple-donut':
        chartRootDonut = addDonutChart3D({
          position: { x: -1.5, y: 3, z: 5.98 },
          value: latest.value,
          maxValue: 10,
          outerRadius: 1,
          innerRadius: 0.6,
          showLabel: true,
          zOffset: 0.01
        })
        break

      case 'sentiment-meter':
        chartRootMeter = addSentimentMeter3D({
          value: latest.value,
          position: { x: -12.28, y: 1, z: 0 },
          rotation: { x: 0, y: 270, z: 0 },
          width: 4,
          barHeight: 0.25,
          showLabels: true,
          showValue: true,
          zOffset: 0.01
        })
        break

      case 'tricolor-donut':
        chartRootTriColor = addTriColorDonutChart3D({
          negativeCount: counts['negative'] ?? 0,
          neutralCount:  counts['neutral']  ?? 0,
          positiveCount: counts['positive'] ?? 0,
          position: { x: -7, y: 3, z: 5.98 }
        })
        break

      case 'bar-chart':
        chartRoot = addBarChart3D(newData, {
          position: { x: -3.6, y: 2.1, z: -7.48 },
          width: 4,
          height: 2,
          yMax: 10,
          grid: true,
          labels: true,
          mirrorX: true,
          zOffset: 0.01
        })
        break

      case 'heatmap':
        chartRootHeatmap = addHeatmapChart3D(newData, {
          position: { x: -12.2, y: 2.2, z: 0 },
          rotation: { x: 0, y: 270, z: 0 },
          cellSize: 0.2,
          showValues: false,
          zOffset: 0.01,
          maxItems: 300
        })
        break

      default:
        console.log('[TEST] Unknown graph:', graph)
        break
    }
  }

  void newDoneData
  void newTodoData
  data = newData
}

// ---------------------------------------------------------------------------
// Persistent audio sentiment bar chart
// ---------------------------------------------------------------------------

function updatePersistentAudioBarChart(rows: MyRow[]) {
  if (persistentAudioBarChartRoot) {
    engine.removeEntityWithChildren(persistentAudioBarChartRoot)
    persistentAudioBarChartRoot = null
  }

  persistentAudioBarChartRoot = addBarChart3D(rows, {
    position: AUDIO_BAR_CHART_POSITION,
    width: 4,
    height: 2,
    yMax: 10,
    grid: true,
    labels: true,
    mirrorX: true,
    zOffset: 0.01,
  })
}

// Aggiorna il secondo grafico permanente con i risultati prodotti dall'analisi audio.
function updatePersistentAudioSentimentBarChart(rows: MyRow[]) {
  if (persistentAudioSentimentBarChartRoot) {
    engine.removeEntityWithChildren(persistentAudioSentimentBarChartRoot)
    persistentAudioSentimentBarChartRoot = null
  }

  persistentAudioSentimentBarChartRoot = addBarChart3D(rows, {
    position: AUDIO_SENTIMENT_BAR_CHART_POSITION,
    width: 4,
    height: 2,
    yMax: 10,
    grid: true,
    labels: true,
    mirrorX: true,
    zOffset: 0.01,
  })
}

// Combina data.json e audio-sentiment.json usando finestre temporali di 20 secondi.
// Le finestre partono dal timestamp più vecchio presente nei due flussi e
// continuano fino al timestamp più recente, includendo anche eventuali finestre vuote.
// Peso data.json = 1, peso audio-sentiment.json = 2.
// Se in una finestra manca uno dei due flussi, quel flusso vale 5 (neutral).
// Se mancano entrambi, il valore combinato della finestra resta 5.
const COMBINED_WINDOW_SECONDS = 20
const NEUTRAL_SENTIMENT_VALUE = 5

type TimedSentimentRow = {
  row: MyRow
  timeSeconds: number
}

function parseTimestampToSeconds(timestamp?: string): number | null {
  const match = String(timestamp ?? '').trim().match(/^(\d{2}):(\d{2}):(\d{2})$/)
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    return null
  }

  return hours * 3600 + minutes * 60 + seconds
}

function formatSecondsAsTimestamp(totalSeconds: number): string {
  const secondsInDay = 24 * 60 * 60
  const normalized = (
    (Math.floor(totalSeconds) % secondsInDay) + secondsInDay
  ) % secondsInDay

  const hours = Math.floor(normalized / 3600)
  const minutes = Math.floor((normalized % 3600) / 60)
  const seconds = normalized % 60

  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':')
}

function getTimedSentimentRows(rows: MyRow[]): TimedSentimentRow[] {
  const timedRows: TimedSentimentRow[] = []

  for (const row of rows) {
    const timeSeconds = parseTimestampToSeconds(row.timestamp)
    if (timeSeconds === null) continue

    timedRows.push({ row, timeSeconds })
  }

  return timedRows
}

function getWindowAverageValue(
  rows: TimedSentimentRow[],
  windowStart: number,
  windowEnd: number
): number {
  let total = 0
  let count = 0

  for (const item of rows) {
    if (item.timeSeconds < windowStart || item.timeSeconds >= windowEnd) {
      continue
    }

    const value = Number(item.row.value)
    if (!Number.isFinite(value)) continue

    total += Math.max(0, Math.min(10, value))
    count++
  }

  return count > 0 ? total / count : NEUTRAL_SENTIMENT_VALUE
}

function getWindowLabels(
  rows: TimedSentimentRow[],
  windowStart: number,
  windowEnd: number
): string[] {
  const labels: string[] = []

  for (const item of rows) {
    if (item.timeSeconds < windowStart || item.timeSeconds >= windowEnd) {
      continue
    }

    labels.push(...(item.row.labels ?? []))
  }

  return labels
}

function combineSentimentRows(dataRows: MyRow[], audioRows: MyRow[]): MyRow[] {
  const timedDataRows = getTimedSentimentRows(dataRows)
  const timedAudioRows = getTimedSentimentRows(audioRows)
  const allTimedRows = [...timedDataRows, ...timedAudioRows]

  if (allTimedRows.length === 0) return []

  const oldestTimestamp = Math.min(
    ...allTimedRows.map((item) => item.timeSeconds)
  )
  const newestTimestamp = Math.max(
    ...allTimedRows.map((item) => item.timeSeconds)
  )

  const windowCount =
    Math.floor(
      (newestTimestamp - oldestTimestamp) / COMBINED_WINDOW_SECONDS
    ) + 1

  const combinedRows: MyRow[] = []

  for (let windowIndex = 0; windowIndex < windowCount; windowIndex++) {
    const windowStart =
      oldestTimestamp + windowIndex * COMBINED_WINDOW_SECONDS
    const windowEnd = windowStart + COMBINED_WINDOW_SECONDS

    const dataValue = getWindowAverageValue(
      timedDataRows,
      windowStart,
      windowEnd
    )
    const audioValue = getWindowAverageValue(
      timedAudioRows,
      windowStart,
      windowEnd
    )

    const combinedValue = (dataValue + 2 * audioValue) / 3

    combinedRows.push({
      id: windowIndex + 1,
      timestamp: formatSecondsAsTimestamp(windowStart),
      value: Math.max(0, Math.min(10, combinedValue)),
      labels: [
        ...getWindowLabels(timedDataRows, windowStart, windowEnd),
        ...getWindowLabels(timedAudioRows, windowStart, windowEnd),
      ],
    })
  }

  return combinedRows
}

function updatePersistentCombinedSentimentBarChart(
  dataRows: MyRow[],
  audioRows: MyRow[]
) {
  if (persistentCombinedSentimentBarChartRoot) {
    engine.removeEntityWithChildren(persistentCombinedSentimentBarChartRoot)
    persistentCombinedSentimentBarChartRoot = null
  }

  const combinedRows = combineSentimentRows(dataRows, audioRows)

  persistentCombinedSentimentBarChartRoot = addBarChart3D(combinedRows, {
    position: COMBINED_SENTIMENT_BAR_CHART_POSITION,
    width: 4,
    height: 2,
    yMax: 10,
    grid: true,
    labels: true,
    mirrorX: true,
    zOffset: 0.01,
  })

  // Ruota soltanto il grafico combinato per renderlo visibile dal lato opposto.
  const combinedTransform = Transform.getMutable(
    persistentCombinedSentimentBarChartRoot
  )
  combinedTransform.rotation = Quaternion.fromEulerDegrees(0, 180, 0)
}

// ---------------------------------------------------------------------------
// Data loading and chart refresh
// ---------------------------------------------------------------------------

function requestImmediateRedraw() {
  nextFetch = 0

  executeTask(async () => {
    await fetchAndDraw(true)
  })
}

async function fetchAndDraw(forceRedraw = false) {
  if (isFetching) {
    if (forceRedraw) redrawAfterCurrentFetch = true
    return
  }
  isFetching = true

  try {
    const newDoneData = await loadJson<MyRow[]>(`${SERVER_URL}/done.json`)
    const newTodoData = await loadJson<MyRow[]>(`${SERVER_URL}/todo.json`)
    const newData     = await loadJson<MyRow[]>(`${SERVER_URL}/data.json`)
    console.log('Data reloaded:', newData.length, 'rows')

    // Aggiorna sempre il primo grafico permanente con data.json,
    // anche mentre è attivo un test guidato.
    updatePersistentAudioBarChart(newData)

    // Il secondo grafico legge i record contenuti in audio-sentiment.json
    // attraverso l'endpoint dedicato del server.
    try {
      const newAudioSentimentData = await loadJson<MyRow[]>(
        `${SERVER_URL}/audio-analysis/json`
      )
      console.log(
        'Audio sentiment reloaded:',
        newAudioSentimentData.length,
        'rows'
      )
      updatePersistentAudioSentimentBarChart(newAudioSentimentData)
      updatePersistentCombinedSentimentBarChart(
        newData,
        newAudioSentimentData
      )
    } catch (audioErr) {
      // Un eventuale errore dell'endpoint audio non deve interrompere
      // l'aggiornamento di data.json o dei grafici usati nei test.
      console.error('Error while loading audio-sentiment.json:', audioErr)
    }

    // During guided tests, automatic redraw of live data must not run,
    // otherwise polling would remove the current stimulus.
    if (isCategory1ExperimentActive() || isCategory2CompositionExperimentActive() || isCategory3QuantitativeExperimentActive() || isCategory4TemporalExperimentActive() || isInterClassExperimentActive()) {
      data = newData
      return
    }

    clearAllCharts()
    drawSelectedCharts(newData, newDoneData, newTodoData)
  } catch (err) {
    console.error('Error while loading JSON:', err)
  } finally {
    isFetching = false

    if (redrawAfterCurrentFetch) {
      redrawAfterCurrentFetch = false
      requestImmediateRedraw()
    }
  }
}

engine.addSystem(() => {
  const info = EngineInfo.getOrNull(engine.RootEntity)
  if (!info) return
  const now = info.totalRuntime
  if (now >= nextFetch) {
    if (now < 6389581824) nextFetch = now + REFRESH_INTERVAL
    fetchAndDraw()
  }
})



// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function main() {
  executeTask(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/messages/reset`, { method: 'POST' })
      if (!res.ok) console.log('CSV reset error:', res.status)
      else console.log('[CHAT] messages.csv reset')
    } catch (e) { console.log('Fetch error /messages/reset', e) }
  })

  executeTask(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/reset`, { method: 'POST' })
      if (!res.ok) console.log('JSON reset error:', res.status)
      else console.log('[CHAT] data.json reset')
    } catch (e) { console.log('Fetch error /reset', e) }
  })

  imageEntity = engine.getEntityOrNullByName('Image')

  const room = engine.addEntity()
  GltfContainer.create(room, {
    src: 'assets/scene/Models/conference_room_-_3d/newConferenceRoom7.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER
  })
  Transform.create(room, {
    position: { x: 4, y: 0, z: 5 },
    scale: { x: 2.25, y: 1.5, z: 2.5 }
  })

  if (imageEntity) {
    Material.setPbrMaterial(imageEntity, {
      texture: Material.Texture.Common({ src: IMG_WHITE })
    })
  }

  // Keep the sentiment light visible in a neutral state when no active test is using it.
  resetSentimentLightToNeutral()

  // Crea subito tutti e tre i bar chart permanenti, anche se i rispettivi
  // file JSON sono ancora vuoti. Il polling li aggiornerà ogni REFRESH_INTERVAL.
  updatePersistentAudioBarChart(data)
  updatePersistentAudioSentimentBarChart([])
  updatePersistentCombinedSentimentBarChart(data, [])

  spawnKanbanBoard(Vector3.create(3.75, 1, 2.5), undefined, 90)

  spawnTestSelectorBoard({ x: 2.3, y: 2.1, z: 6.1 }, 180, selectTest)
}

setupUi()