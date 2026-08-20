import { ReactEcs, ReactEcsRenderer, UiEntity, Input, Button } from '@dcl/sdk/react-ecs'
import { getPlayer } from '@dcl/sdk/src/players'
import { Color4 } from '@dcl/sdk/math'
import { engine } from '@dcl/sdk/ecs'
import { executeTask } from '@dcl/sdk/ecs'
import { sendDiscomfortClick } from './index'
import { getLanguage, localizeText, localizeTextList, t, toggleLanguage } from './i18n'
import { NpcUtilsUi } from 'dcl-npc-toolkit'
import type { Category1ExperimentUiState, Category1PredictionLabel } from './category1Tests'
import type { Category2CompositionUiState, Category2DominantAnswer, Category2PercentageEstimates } from './category2Tests'
import type { Category3QuantitativeUiState, Category3ComparisonChoice } from './category3Tests'
import type { Category4TemporalUiState, Category4TrendAnswer, Category4AnomalyAnswer } from './category4Tests'
import type {
  InterClassUiState,
  InterClassScenarioAnswer,
  InterClassAnomalyAnswer,
  InterClassLikertAnswers,
  InterClassLikertQuestion,
  InterClassLikertValue,
} from './interClassTests'

const PROJECT_NAME = 'Sprint review meeting'
const MEETING_NUMBER = 3
const CHAT_SERVER_URL = 'https://spore-pox-reformist.ngrok-free.dev'

type ChatMessage = {
  id: string
  author: string
  address: string
  text: string
  timestamp: string
  createdAt: number
}

export type TestIntroUiState =
  | { phase: 'hidden' }
  | {
      phase: 'visible'
      title: string
      description: string
      instructions: string[]
      note?: string
    }

const profileNameCache: Record<string, string> = {}
const pendingProfileLookups: Record<string, boolean> = {}
const seenMessageIds = new Set<string>()

type CompletedTestsResponse = {
  address?: string
  completedTests?: string[]
  completedMap?: Record<string, boolean>
  filesChecked?: number
  updatedAt?: string
}

type CompletedTestItem = {
  id: string
  label: string
}

const COMPLETED_TEST_ITEMS: CompletedTestItem[] = [
  { id: 'test-1-1', label: 'Intra 1.1' },
  { id: 'test-1-2', label: 'Intra 1.2' },
  { id: 'test-composition', label: 'Intra 2' },
  { id: 'test-3-1', label: 'Intra 3.1' },
  { id: 'test-3-2', label: 'Intra 3.2' },
  { id: 'test-temporal', label: 'Intra 4' },
  { id: 'inter-test-1-a', label: 'Inter 1A' },
  { id: 'inter-test-1-b', label: 'Inter 1B' },
  { id: 'inter-test-1-final-likert', label: 'Inter 1 final' },
  { id: 'inter-test-2-a', label: 'Inter 2A' },
  { id: 'inter-test-2-b', label: 'Inter 2B' },
  { id: 'inter-test-2-final-likert', label: 'Inter 2 final' },
  { id: 'inter-test-3-a', label: 'Inter 3A' },
  { id: 'inter-test-3-b', label: 'Inter 3B' },
  { id: 'inter-test-3-final-likert', label: 'Inter 3 final' },
]

const COMPLETED_TEST_POLLING_INTERVAL = 8

let completedTestIds = new Set<string>()
let completedTestsLoaded = false
let completedTestsLoading = false
let completedTestsError = ''
let completedTestsLastAddress = ''
let completedTestsPollingAccumulator = COMPLETED_TEST_POLLING_INTERVAL

type CompletedTestsChangeListener = () => void
const completedTestsChangeListeners = new Set<CompletedTestsChangeListener>()

function notifyCompletedTestsChangeListeners() {
  for (const listener of completedTestsChangeListeners) {
    listener()
  }
}

export function isTestCompleted(testId: string) {
  const normalized = normalizeCompletedTestId(testId)
  return Boolean(normalized && completedTestIds.has(normalized))
}

export function addCompletedTestsChangeListener(listener: CompletedTestsChangeListener) {
  completedTestsChangeListeners.add(listener)
  return () => completedTestsChangeListeners.delete(listener)
}

let testIntroUiState: TestIntroUiState = { phase: 'hidden' }
let testIntroHandler: (() => void) | undefined
let testIntroConfirmLocked = false

let category1ExperimentUiState: Category1ExperimentUiState = { phase: 'hidden' }
let category1PredictionHandler: ((label: Category1PredictionLabel) => void) | undefined
let category1NumericHandler: ((value: number) => void) | undefined

let category1NumericValue = 5.0
let category1NumericTrialKey = ''
let category1NumericConfirmLocked = false
let category1PredictionLocked = false


let category2CompositionUiState: Category2CompositionUiState = { phase: 'hidden' }
let category2AnswerHandler: ((dominant: Category2DominantAnswer, estimates: Category2PercentageEstimates) => void) | undefined
let category2DominantAnswer: Category2DominantAnswer | undefined
let category2EstimateValues: Category2PercentageEstimates = { negative: 0, neutral: 0, positive: 0 }
let category2TrialKey = ''
let category2ConfirmLocked = false

let category3QuantitativeUiState: Category3QuantitativeUiState = { phase: 'hidden' }
let category3NumericHandler: ((value: number) => void) | undefined
let category3ComparisonHandler: ((choice: Category3ComparisonChoice, distance: number) => void) | undefined
let category3NumericValue = 5.0
let category3NumericTrialKey = ''
let category3NumericConfirmLocked = false
let category3ComparisonChoice: Category3ComparisonChoice | undefined
let category3DistanceValue = 1.0
let category3ComparisonTrialKey = ''
let category3ComparisonConfirmLocked = false

let category4TemporalUiState: Category4TemporalUiState = { phase: 'hidden' }
let category4TemporalAnswerHandler: ((trend: Category4TrendAnswer, anomaly: Category4AnomalyAnswer) => void) | undefined
let category4TrendAnswer: Category4TrendAnswer | undefined
let category4AnomalyAnswer: Category4AnomalyAnswer | undefined
let category4TrialKey = ''
let category4ConfirmLocked = false

let interClassUiState: InterClassUiState = { phase: 'hidden' }
let interClassAnswerHandler: ((answer: InterClassScenarioAnswer, anomaly: InterClassAnomalyAnswer) => void) | undefined
let interClassLikertHandler: ((answers: InterClassLikertAnswers) => void) | undefined
let interClassScenarioAnswer: InterClassScenarioAnswer | undefined
let interClassAnomalyAnswer: InterClassAnomalyAnswer | undefined
let interClassConfirmLocked = false
let interClassTrialKey = ''
let interClassLikertAnswers: InterClassLikertAnswers = {}
let interClassLikertKey = ''
let interClassLikertConfirmLocked = false
let interClassIntroHandler: (() => void) | undefined
let interClassIntroConfirmLocked = false

let isGuiTemporarilyHidden = true
let isChatTemporarilyHidden = true

function toggleGuiVisibility() {
  isGuiTemporarilyHidden = !isGuiTemporarilyHidden
}

function toggleChatVisibility() {
  isChatTemporarilyHidden = !isChatTemporarilyHidden
}

export function setTestIntroUiState(state: TestIntroUiState) {
  testIntroUiState = state
  testIntroConfirmLocked = false
}

export function setTestIntroHandler(handler: (() => void) | undefined) {
  testIntroHandler = handler
  if (!handler) testIntroConfirmLocked = false
}

function clampPercentValue(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function updateCategory2Estimate(kind: keyof Category2PercentageEstimates, delta: number) {
  category2EstimateValues = {
    ...category2EstimateValues,
    [kind]: clampPercentValue(category2EstimateValues[kind] + delta),
  }
}

function resetCategory2AnswerState(testId: string, trialIndex: number) {
  const key = `${testId}-${trialIndex}`
  if (category2TrialKey !== key) {
    category2TrialKey = key
    category2DominantAnswer = undefined
    category2EstimateValues = { negative: 0, neutral: 0, positive: 0 }
    category2ConfirmLocked = false
  }
}

export function setCategory2CompositionUiState(state: Category2CompositionUiState) {
  category2CompositionUiState = state

  if (state.phase === 'answer') {
    resetCategory2AnswerState(state.testId, state.trialIndex)
  }

  if (state.phase === 'hidden' || state.phase === 'countdown' || state.phase === 'observation') {
    category2ConfirmLocked = false
  }
}

export function setCategory2AnswerHandler(
  handler: ((dominant: Category2DominantAnswer, estimates: Category2PercentageEstimates) => void) | undefined
) {
  category2AnswerHandler = handler
  if (!handler) category2ConfirmLocked = false
}

function clampNumericValue(value: number) {
  return Math.max(0, Math.min(10, Number(value.toFixed(1))))
}

function updateCategory1NumericValue(delta: number) {
  category1NumericValue = clampNumericValue(category1NumericValue + delta)
}

export function setCategory1ExperimentUiState(state: Category1ExperimentUiState) {
  category1ExperimentUiState = state

  // Reset lock per test 1.2
  if (state.phase === 'trial' && state.testId === 'cat1-test-1-2') {
    const key = `${state.testId}-${state.trialIndex}`
    if (category1NumericTrialKey !== key) {
      category1NumericTrialKey = key
      category1NumericValue = 5.0
      category1NumericConfirmLocked = false
      category1PredictionLocked = false
    }
  }

  // ✅ FIX: reset lock per test 1.1 ad ogni nuovo trial (countdown = nuovo stimolo in arrivo)
  if (state.phase === 'countdown' && state.testId === 'cat1-test-1-1') {
    category1PredictionLocked = false
  }
}

export function setCategory1PredictionHandler(handler: ((label: Category1PredictionLabel) => void) | undefined) {
  category1PredictionHandler = handler
  if (!handler) category1PredictionLocked = false
}

export function setCategory1NumericHandler(handler: ((value: number) => void) | undefined) {
  category1NumericHandler = handler
  if (!handler) category1NumericConfirmLocked = false
}

function updateCategory3NumericValue(delta: number) {
  category3NumericValue = clampNumericValue(category3NumericValue + delta)
}

function updateCategory3DistanceValue(delta: number) {
  category3DistanceValue = clampNumericValue(category3DistanceValue + delta)
}

export function setCategory3QuantitativeUiState(state: Category3QuantitativeUiState) {
  category3QuantitativeUiState = state

  if (state.phase === 'trial') {
    const key = `${state.testId}-${state.trialIndex}`
    if (category3NumericTrialKey !== key) {
      category3NumericTrialKey = key
      category3NumericValue = 5.0
      category3NumericConfirmLocked = false
    }
  }

  if (state.phase === 'comparison') {
    const key = `${state.testId}-${state.trialIndex}`
    if (category3ComparisonTrialKey !== key) {
      category3ComparisonTrialKey = key
      category3ComparisonChoice = undefined
      category3DistanceValue = 1.0
      category3ComparisonConfirmLocked = false
    }
  }

  if (state.phase === 'hidden' || state.phase === 'countdown') {
    category3NumericConfirmLocked = false
    category3ComparisonConfirmLocked = false
  }
}

export function setCategory3NumericHandler(handler: ((value: number) => void) | undefined) {
  category3NumericHandler = handler
  if (!handler) category3NumericConfirmLocked = false
}

export function setCategory3ComparisonHandler(
  handler: ((choice: Category3ComparisonChoice, distance: number) => void) | undefined
) {
  category3ComparisonHandler = handler
  if (!handler) {
    category3ComparisonChoice = undefined
    category3ComparisonConfirmLocked = false
  }
}

function resetCategory4AnswerState(testId: string, trialIndex: number) {
  const key = `${testId}-${trialIndex}`
  if (category4TrialKey !== key) {
    category4TrialKey = key
    category4TrendAnswer = undefined
    category4AnomalyAnswer = undefined
    category4ConfirmLocked = false
  }
}

export function setCategory4TemporalUiState(state: Category4TemporalUiState) {
  category4TemporalUiState = state

  if (state.phase === 'trial') {
    resetCategory4AnswerState(state.testId, state.trialIndex)
  }

  if (state.phase === 'hidden' || state.phase === 'countdown') {
    category4ConfirmLocked = false
  }
}

export function setCategory4TemporalAnswerHandler(
  handler: ((trend: Category4TrendAnswer, anomaly: Category4AnomalyAnswer) => void) | undefined
) {
  category4TemporalAnswerHandler = handler
  if (!handler) {
    category4TrendAnswer = undefined
    category4AnomalyAnswer = undefined
    category4ConfirmLocked = false
  }
}

function resetInterClassAnswerState(testId: string, trialIndex: number) {
  const key = `${testId}-${trialIndex}`
  if (interClassTrialKey !== key) {
    interClassTrialKey = key
    interClassScenarioAnswer = undefined
    interClassAnomalyAnswer = undefined
    interClassConfirmLocked = false
  }
}

function resetInterClassLikertState(state: Extract<InterClassUiState, { phase: 'likert' }>) {
  const key = `${state.testId}-${state.likertRunId}`
  if (interClassLikertKey !== key) {
    interClassLikertKey = key
    interClassLikertAnswers = {}
    interClassLikertConfirmLocked = false
  }
}

export function setInterClassUiState(state: InterClassUiState) {
  interClassUiState = state

  if (state.phase === 'answer') {
    resetInterClassAnswerState(state.testId, state.trialIndex)
  }

  if (state.phase === 'likert') {
    resetInterClassLikertState(state)
  }

  if (state.phase === 'hidden' || state.phase === 'countdown' || state.phase === 'playback' || state.phase === 'finished') {
    interClassScenarioAnswer = undefined
    interClassAnomalyAnswer = undefined
    interClassConfirmLocked = false
    interClassLikertAnswers = {}
    interClassLikertConfirmLocked = false
  }

  if (state.phase === 'intro') {
    interClassIntroConfirmLocked = false
  }
}

export function setInterClassAnswerHandler(
  handler: ((answer: InterClassScenarioAnswer, anomaly: InterClassAnomalyAnswer) => void) | undefined
) {
  interClassAnswerHandler = handler
  if (!handler) {
    interClassScenarioAnswer = undefined
    interClassAnomalyAnswer = undefined
    interClassConfirmLocked = false
  }
}

export function setInterClassLikertHandler(
  handler: ((answers: InterClassLikertAnswers) => void) | undefined
) {
  interClassLikertHandler = handler
  if (!handler) {
    interClassLikertAnswers = {}
    interClassLikertConfirmLocked = false
  }
}

export function setInterClassIntroHandler(handler: (() => void) | undefined) {
  interClassIntroHandler = handler
  if (!handler) interClassIntroConfirmLocked = false
}

let currentInput = ''
let clearInput = false
let chatScrollOffset = 0
let chatMessages: ChatMessage[] = []

// Polling timer based on engine.addSystem
let pollingAccumulator = 0
const POLLING_INTERVAL = 1

const MAX_VISIBLE_MESSAGES = 3

const SP = {
  xs: 6,
  sm: 12,
  md: 18,
  lg: 24,
  xl: 36,
}

const COLORS = {
  surface: Color4.create(0, 0, 0, 1),
  textPrimary: Color4.White(),
  textSecondary: Color4.create(1, 1, 1, 1),
  comfortBg: Color4.create(0, 0.6, 0, 1),
  discomfortBg: Color4.create(0.8, 0, 0, 1),
  dockBg: Color4.create(0, 0, 0, 1),
  divider: Color4.create(1, 1, 1, 1),
  chatBg: Color4.create(0.05, 0.05, 0.05, 0.95),
  inputBg: Color4.create(0.12, 0.12, 0.12, 1),
  sendBg: Color4.create(0.18, 0.18, 0.18, 1),
  chatMessageBg: Color4.create(0.1, 0.1, 0.1, 0.9),
  inputText: Color4.Black(),
  placeholderText: Color4.create(0.7, 0.7, 0.7, 1),
  success: Color4.create(0.15, 0.8, 0.25, 1),
  muted: Color4.create(0.45, 0.45, 0.45, 1),
  warning: Color4.create(1, 0.78, 0.2, 1),
}


function renderGuiVisibilityButton() {
  return (
    <UiEntity
      uiTransform={{
        width: 'auto',
        height: 'auto',
        positionType: 'absolute',
        position: { top: SP.lg, right: SP.lg },
        padding: { top: 4, right: 4, bottom: 4, left: 4 },
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
      }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.75) }}
    >
      <Button
        value={getLanguage() === 'en' ? 'IT' : 'EN'}
        variant="secondary"
        onMouseDown={toggleLanguage}
        uiTransform={{ width: 58, height: 36, margin: { right: SP.sm } }}
        fontSize={14}
      />
      <Button
        value={isChatTemporarilyHidden ? t('Show chat', 'Mostra chat') : t('Hide chat', 'Nascondi chat')}
        variant="secondary"
        onMouseDown={toggleChatVisibility}
        uiTransform={{ width: 112, height: 36, margin: { right: SP.sm } }}
        fontSize={14}
      />
      <Button
        value={isGuiTemporarilyHidden ? t('Show extra UI', 'Mostra UI extra') : t('Hide extra UI', 'Nascondi UI extra')}
        variant="secondary"
        onMouseDown={toggleGuiVisibility}
        uiTransform={{ width: 128, height: 36 }}
        fontSize={14}
      />
    </UiEntity>
  )
}

function normalizeCompletedTestId(testId: string) {
  const normalized = String(testId || '').trim().toLowerCase()

  switch (normalized) {
    case 'cat1-test-1-1':
    case 'category1-test-1-1':
    case 'category-1-test-1-1':
      return 'test-1-1'
    case 'cat1-test-1-2':
    case 'category1-test-1-2':
    case 'category-1-test-1-2':
      return 'test-1-2'
    case 'cat2-test-composition':
    case 'category2-test-composition':
    case 'category-2-test-composition':
    case 'composition-test':
      return 'test-composition'
    case 'cat3-test-3-1':
    case 'category3-test-3-1':
    case 'category-3-test-3-1':
      return 'test-3-1'
    case 'cat3-test-3-2':
    case 'category3-test-3-2':
    case 'category-3-test-3-2':
      return 'test-3-2'
    case 'cat4-test-temporal':
    case 'category4-test-temporal':
    case 'category-4-test-temporal':
    case 'temporal-test':
      return 'test-temporal'
    default:
      return normalized
  }
}

function getCompletedTestsAddress() {
  const player = getPlayer()
  return player?.userId ?? ''
}

export function markTestCompletedLocally(testId: string) {
  const normalized = normalizeCompletedTestId(testId)
  if (!normalized) return
  completedTestIds = new Set([...completedTestIds, normalized])
  completedTestsLoaded = true
  notifyCompletedTestsChangeListeners()
}

export function refreshCompletedTestsFromServer() {
  if (completedTestsLoading) return

  const address = getCompletedTestsAddress()
  if (!address || address === 'Unknown Player') {
    completedTestsError = 'Address not available yet.'
    return
  }

  completedTestsLoading = true
  completedTestsLastAddress = address

  executeTask(async () => {
    try {
      const res = await fetch(`${CHAT_SERVER_URL}/experiment/completed-tests/${encodeURIComponent(address)}`)
      if (!res.ok) {
        completedTestsError = `Completed tests fetch error: ${res.status}`
        return
      }

      const payload = await res.json() as CompletedTestsResponse
      const fromArray = Array.isArray(payload.completedTests) ? payload.completedTests : []
      const fromMap = payload.completedMap
        ? Object.keys(payload.completedMap).filter((key) => payload.completedMap?.[key])
        : []

      completedTestIds = new Set([...fromArray, ...fromMap].map(normalizeCompletedTestId).filter(Boolean))
      completedTestsLoaded = true
      completedTestsError = ''
      notifyCompletedTestsChangeListeners()
    } catch (error) {
      completedTestsError = 'Completed tests fetch failed.'
      console.log('[COMPLETED TESTS] Fetch error', error)
    } finally {
      completedTestsLoading = false
    }
  })
}

function completedTestsPollingSystem(deltaTime: number) {
  completedTestsPollingAccumulator += deltaTime
  if (completedTestsPollingAccumulator < COMPLETED_TEST_POLLING_INTERVAL) return
  completedTestsPollingAccumulator = 0
  refreshCompletedTestsFromServer()
}

function renderCompletedTestRow(item: CompletedTestItem) {
  const completed = completedTestIds.has(item.id)

  return (
    <UiEntity
      key={`completed-test-${item.id}`}
      uiTransform={{
        width: '100%',
        height: 24,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        margin: { bottom: 2 },
      }}
    >
      <UiEntity
        uiTransform={{ width: 26, height: 22, margin: { right: SP.xs } }}
        uiText={{
          value: completed ? '✓' : '○',
          fontSize: 16,
          color: completed ? COLORS.success : COLORS.muted,
        }}
      />
      <UiEntity
        uiTransform={{ width: 150, height: 22 }}
        uiText={{
          value: localizeText(item.label),
          fontSize: 13,
          color: completed ? COLORS.textPrimary : COLORS.placeholderText,
        }}
      />
    </UiEntity>
  )
}

function renderCompletedTestsPanel() {
  const completedCount = COMPLETED_TEST_ITEMS.filter((item) => completedTestIds.has(item.id)).length
  const statusText = completedTestsLoading
    ? t('Updating...', 'Aggiornamento...')
    : completedTestsError
      ? completedTestsError
      : completedTestsLoaded
        ? t(`${completedCount} / ${COMPLETED_TEST_ITEMS.length} completed`, `${completedCount} / ${COMPLETED_TEST_ITEMS.length} completati`)
        : t('Waiting for address...', 'In attesa dell’indirizzo...')
  const firstColumnItems = COMPLETED_TEST_ITEMS.slice(0, Math.ceil(COMPLETED_TEST_ITEMS.length / 2))
  const secondColumnItems = COMPLETED_TEST_ITEMS.slice(Math.ceil(COMPLETED_TEST_ITEMS.length / 2))

  return (
    <UiEntity
      uiTransform={{
        width: 430,
        height: 'auto',
        positionType: 'absolute',
        position: { top: 74, right: SP.lg },
        padding: { top: SP.sm, right: SP.sm, bottom: SP.sm, left: SP.sm },
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
      }}
      uiBackground={{ color: COLORS.chatBg }}
    >
      <UiEntity
        uiTransform={{
          width: '100%',
          height: 'auto',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          margin: { bottom: SP.xs },
        }}
      >
        <UiEntity
          uiTransform={{ width: 190, height: 'auto' }}
          uiText={{ value: t('Completed tests', 'Test completati'), fontSize: 16, color: COLORS.textPrimary }}
        />
        <UiEntity
          uiTransform={{ width: 200, height: 'auto' }}
          uiText={{
            value: localizeText(statusText),
            fontSize: 12,
            color: completedTestsError ? COLORS.warning : COLORS.textSecondary,
          }}
        />
      </UiEntity>
      {completedTestsLastAddress && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.sm } }}
          uiText={{ value: shortAddress(completedTestsLastAddress), fontSize: 11, color: COLORS.placeholderText }}
        />
      )}
      <UiEntity
        uiTransform={{
          width: '100%',
          height: 'auto',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}
      >
        <UiEntity
          uiTransform={{
            width: 198,
            height: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
          }}
        >
          {firstColumnItems.map(renderCompletedTestRow)}
        </UiEntity>
        <UiEntity
          uiTransform={{
            width: 198,
            height: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
          }}
        >
          {secondColumnItems.map(renderCompletedTestRow)}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

async function fetchProfileName(address: string): Promise<string | null> {
  const endpoints = [
    `https://peer.decentraland.org/lambdas/profile/${encodeURIComponent(address)}`,
    `https://peer.decentraland.org/lambdas/profiles/${encodeURIComponent(address)}`,
    `https://peer-testing.decentraland.org/lambdas/profile/${encodeURIComponent(address)}`,
    `https://peer-testing.decentraland.org/lambdas/profiles/${encodeURIComponent(address)}`
  ]

  for (const url of endpoints) {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        console.log('Profile not available on', url, 'status:', response.status)
        continue
      }
      const data = await response.json()
      const directName = data?.name
      if (typeof directName === 'string' && directName.trim().length > 0) {
        return directName.trim()
      }
      const wrappedName = data?.avatars?.[0]?.name
      if (typeof wrappedName === 'string' && wrappedName.trim().length > 0) {
        return wrappedName.trim()
      }
    } catch (error) {
      console.log('Profile fetch error on', url, error)
    }
  }
  return null
}

function shortAddress(address: string): string {
  if (!address || address.length < 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function sortMessages(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
    return a.id.localeCompare(b.id)
  })
}

function resolveAuthorName(address: string, messageId: string) {
  if (!address || address === 'Unknown Player') return

  if (profileNameCache[address]) {
    chatMessages = sortMessages(
      chatMessages.map((msg) =>
        msg.id === messageId ? { ...msg, author: profileNameCache[address] } : msg
      )
    )
    return
  }

  if (pendingProfileLookups[address]) return
  pendingProfileLookups[address] = true

  executeTask(async () => {
    const name = await fetchProfileName(address)
    if (name) {
      profileNameCache[address] = name
      chatMessages = sortMessages(
        chatMessages.map((msg) =>
          msg.address === address ? { ...msg, author: name } : msg
        )
      )
    }
    delete pendingProfileLookups[address]
  })
}

function addMessageToChat(message: ChatMessage) {
  if (seenMessageIds.has(message.id)) return
  seenMessageIds.add(message.id)
  chatMessages = sortMessages([...chatMessages, message])
  chatScrollOffset = Math.max(0, chatMessages.length - MAX_VISIBLE_MESSAGES)
  resolveAuthorName(message.address, message.id)
}

async function addLocalChatMessage(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return

  const player = getPlayer()
  const address = player?.userId ?? 'Unknown Player'
  const createdAt = Date.now()
  const messageId = `${createdAt}-${Math.random()}`
  const fallbackAuthor = profileNameCache[address] ?? shortAddress(address)

  const newMessage: ChatMessage = {
    id: messageId,
    author: fallbackAuthor,
    address,
    text: trimmed,
    timestamp: new Date(createdAt).toLocaleTimeString(),
    createdAt
  }

  addMessageToChat(newMessage)
  currentInput = ''
  clearInput = true

  executeTask(async () => {
    try {
      const response = await fetch(`${CHAT_SERVER_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMessage)
      })
      if (!response.ok) {
        console.log('Error sending message to server:', response.status)
      }
    } catch (error) {
      console.log('Fetch error /chat', error)
    }
  })

  console.log(
    '[CUSTOM_CHAT_LOCAL]',
    JSON.stringify({
      author: fallbackAuthor,
      address,
      text: trimmed,
      timestamp: new Date(createdAt).toISOString()
    })
  )
}

function scrollChatUp() {
  chatScrollOffset = Math.max(0, chatScrollOffset - 1)
}

function scrollChatDown() {
  const maxOffset = Math.max(0, chatMessages.length - MAX_VISIBLE_MESSAGES)
  chatScrollOffset = Math.min(maxOffset, chatScrollOffset + 1)
}

// Polling system based on the Decentraland game loop.
// Reads from /messages/csv to preserve the persistent CSV order,
// even after restarting the server.
function chatPollingSystem(deltaTime: number) {
  pollingAccumulator += deltaTime
  if (pollingAccumulator < POLLING_INTERVAL) return
  pollingAccumulator = 0

  executeTask(async () => {
    try {
      const res = await fetch(`${CHAT_SERVER_URL}/messages/csv`)
      if (!res.ok) {
        console.log('Fetch error /messages/csv:', res.status)
        return
      }
      const messages = await res.json() as ChatMessage[]
      messages.forEach((msg) => addMessageToChat(msg))
    } catch (e) {
      console.log('Fetch error chat', e)
    }
  })
}

async function debugFetchAllMessages() {
  executeTask(async () => {
    try {
      const res = await fetch(`${CHAT_SERVER_URL}/messages/csv`)
      if (!res.ok) {
        console.log('[DEBUG] Fetch error /messages/csv:', res.status)
        return
      }
      const messages = await res.json()
      console.log('[DEBUG] ALL MESSAGES FROM CSV:')
      console.log(JSON.stringify(messages, null, 2))
    } catch (e) {
      console.log('[DEBUG] Debug fetch error', e)
    }
  })
}


function renderTestIntroInstruction(text: string, index: number) {
  return (
    <UiEntity
      key={`intro-${index}`}
      uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
      uiText={{ value: `• ${localizeText(text)}`, fontSize: 14, color: COLORS.textPrimary }}
    />
  )
}

function renderTestIntroPanel() {
  const state = testIntroUiState
  if (state.phase === 'hidden') return null

  return (
    <UiEntity
      uiTransform={{
        width: 760,
        height: 'auto',
        positionType: 'absolute',
        position: { bottom: SP.xl, left: '50%' },
        margin: { left: -380 },
        padding: { top: SP.md, right: SP.lg, bottom: SP.md, left: SP.lg },
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      uiBackground={{ color: COLORS.chatBg }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
        uiText={{ value: localizeText(state.title), fontSize: 20, color: COLORS.textPrimary }}
      />

      <UiEntity
        uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.sm } }}
        uiText={{ value: localizeText(state.description), fontSize: 15, color: COLORS.textSecondary }}
      />

      <UiEntity
        uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.sm }, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}
      >
        {state.instructions.map((instruction, index) => renderTestIntroInstruction(instruction, index))}
      </UiEntity>

      {state.note && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.sm } }}
          uiText={{ value: localizeText(state.note), fontSize: 13, color: COLORS.placeholderText }}
        />
      )}

      <Button
        value={testIntroConfirmLocked ? t('Starting...', 'Avvio...') : t('Start', 'Avvia')}
        variant="primary"
        onMouseDown={() => {
          if (testIntroConfirmLocked) return
          testIntroConfirmLocked = true
          testIntroHandler?.()
        }}
        uiTransform={{ width: 180, height: 48, margin: { top: SP.xs } }}
        fontSize={16}
      />
    </UiEntity>
  )
}

function renderPredictionButton(label: Category1PredictionLabel) {
  return (
    <Button
      value={localizeText(label)}
      variant="secondary"
      onMouseDown={() => {
        if (category1PredictionLocked) return
        category1PredictionLocked = true
        category1PredictionHandler?.(label)
      }}
      uiTransform={{ width: 105, height: 42, margin: { right: SP.xs, bottom: SP.xs } }}
      fontSize={14}
    />
  )
}

function renderNumericStepButton(label: string, delta: number, width = 76) {
  return (
    <Button
      value={label}
      variant="secondary"
      onMouseDown={() => {
        // Important: +/- buttons only update the UI value.
        // Non chiamano il gestore del test e quindi non avanzano il trial.
        updateCategory1NumericValue(delta)
      }}
      uiTransform={{ width, height: 42, margin: { right: SP.xs, bottom: SP.xs } }}
      fontSize={15}
    />
  )
}

function renderNumericConfirmButton() {
  return (
    <Button
      value={t('Confirm', 'Conferma')}
      variant="primary"
      onMouseDown={() => {
        if (category1NumericConfirmLocked) return
        category1NumericConfirmLocked = true
        category1NumericHandler?.(clampNumericValue(category1NumericValue))
      }}
      uiTransform={{ width: 160, height: 46, margin: { top: SP.xs } }}
      fontSize={16}
    />
  )
}


function getRemainingSeconds(endAtMs: number) {
  return Math.max(0, Math.ceil((endAtMs - Date.now()) / 1000))
}

function getDominantLabel(label: Category2DominantAnswer) {
  switch (label) {
    case 'negative': return t('Negative', 'Negativo')
    case 'neutral': return t('Neutral', 'Neutro')
    case 'positive': return t('Positive', 'Positivo')
    case 'unclear': return t('Unclear', 'Non chiaro')
  }
}

function renderCategory2DominantButton(label: Category2DominantAnswer) {
  const selected = category2DominantAnswer === label

  return (
    <Button
      value={selected ? `✓ ${getDominantLabel(label)}` : getDominantLabel(label)}
      variant={selected ? 'primary' : 'secondary'}
      onMouseDown={() => {
        if (category2ConfirmLocked) return
        category2DominantAnswer = label
      }}
      uiTransform={{ width: 130, height: 42, margin: { right: SP.xs, bottom: SP.xs } }}
      fontSize={13}
    />
  )
}

function renderCategory2PercentButton(label: string, kind: keyof Category2PercentageEstimates, delta: number, width = 58) {
  return (
    <Button
      value={label}
      variant="secondary"
      onMouseDown={() => {
        if (category2ConfirmLocked) return
        updateCategory2Estimate(kind, delta)
      }}
      uiTransform={{ width, height: 34, margin: { right: SP.xs } }}
      fontSize={12}
    />
  )
}

function renderCategory2EstimateRow(label: string, kind: keyof Category2PercentageEstimates) {
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: 'auto',
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        margin: { bottom: SP.xs },
      }}
    >
      <UiEntity
        uiTransform={{ width: 90, height: 'auto', margin: { right: SP.xs } }}
        uiText={{ value: localizeText(label), fontSize: 13, color: COLORS.textSecondary }}
      />
      {renderCategory2PercentButton('-10', kind, -10)}
      {renderCategory2PercentButton('-1', kind, -1, 48)}
      <UiEntity
        uiTransform={{ width: 62, height: 34, display: 'flex', justifyContent: 'center', alignItems: 'center', margin: { right: SP.xs } }}
        uiBackground={{ color: Color4.create(0.18, 0.36, 0.60, 1) }}
      >
        <UiEntity
          uiTransform={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
          uiText={{ value: `${category2EstimateValues[kind]}%`, fontSize: 13, color: COLORS.textPrimary }}
        />
      </UiEntity>
      {renderCategory2PercentButton('+1', kind, 1, 48)}
      {renderCategory2PercentButton('+10', kind, 10)}
    </UiEntity>
  )
}

function renderCategory2ConfirmButton() {
  const total = category2EstimateValues.negative + category2EstimateValues.neutral + category2EstimateValues.positive
  const canConfirm = !!category2DominantAnswer && !category2ConfirmLocked

  return (
    <UiEntity
      uiTransform={{ width: '100%', height: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: 'auto', margin: { top: SP.xs, bottom: SP.xs } }}
        uiText={{ value: t(`Estimated total: ${total}%`, `Totale stimato: ${total}%`), fontSize: 13, color: total === 100 ? COLORS.textSecondary : COLORS.placeholderText }}
      />
      <Button
        value={canConfirm ? t('Confirm', 'Conferma') : t('Select dominant', 'Seleziona dominante')}
        variant={canConfirm ? 'primary' : 'secondary'}
        onMouseDown={() => {
          if (!canConfirm || !category2DominantAnswer) return
          category2ConfirmLocked = true
          category2AnswerHandler?.(category2DominantAnswer, { ...category2EstimateValues })
        }}
        uiTransform={{ width: 190, height: 46, margin: { top: SP.xs } }}
        fontSize={15}
      />
    </UiEntity>
  )
}


function renderCategory3NumericStepButton(label: string, delta: number, width = 86) {
  return (
    <Button
      value={label}
      variant="secondary"
      onMouseDown={() => {
        // The +/- buttons only update the UI value.
        // They do not submit the answer and do not advance the trial.
        updateCategory3NumericValue(delta)
      }}
      uiTransform={{ width, height: 42, margin: { right: SP.xs, bottom: SP.xs } }}
      fontSize={15}
    />
  )
}

function renderCategory3DistanceStepButton(label: string, delta: number, width = 86) {
  return (
    <Button
      value={label}
      variant="secondary"
      onMouseDown={() => {
        updateCategory3DistanceValue(delta)
      }}
      uiTransform={{ width, height: 42, margin: { right: SP.xs, bottom: SP.xs } }}
      fontSize={15}
    />
  )
}

function renderCategory3ConfirmButton() {
  return (
    <Button
      value={t('Confirm', 'Conferma')}
      variant="primary"
      onMouseDown={() => {
        if (category3NumericConfirmLocked) return
        category3NumericConfirmLocked = true
        category3NumericHandler?.(clampNumericValue(category3NumericValue))
      }}
      uiTransform={{ width: 160, height: 46, margin: { top: SP.xs } }}
      fontSize={16}
    />
  )
}

function renderCategory3ComparisonChoiceButton(choice: Category3ComparisonChoice, label: string) {
  const selected = category3ComparisonChoice === choice
  return (
    <Button
      value={selected ? `✓ ${localizeText(label)}` : localizeText(label)}
      variant={selected ? 'primary' : 'secondary'}
      onMouseDown={() => {
        category3ComparisonChoice = choice
      }}
      uiTransform={{ width: 190, height: 46, margin: { right: SP.xs, bottom: SP.xs } }}
      fontSize={15}
    />
  )
}

function renderCategory3ComparisonConfirmButton() {
  return (
    <Button
      value={t('Confirm', 'Conferma')}
      variant="primary"
      onMouseDown={() => {
        if (category3ComparisonConfirmLocked) return
        if (!category3ComparisonChoice) return
        category3ComparisonConfirmLocked = true
        category3ComparisonHandler?.(category3ComparisonChoice, clampNumericValue(category3DistanceValue))
      }}
      uiTransform={{ width: 160, height: 46, margin: { top: SP.xs } }}
      fontSize={16}
    />
  )
}

function renderCategory3QuantitativePanel() {
  const state = category3QuantitativeUiState
  if (state.phase === 'hidden') return null

  const title = state.testId === 'cat3-test-3-2'
    ? 'Category 3 - Test 3.2'
    : 'Category 3 - Test 3.1'

  const progress = state.phase === 'finished'
    ? t(`Completed: ${state.totalTrials} / ${state.totalTrials}`, `Completato: ${state.totalTrials} / ${state.totalTrials}`)
    : t(`Stimulus ${state.trialIndex} / ${state.totalTrials}`, `Stimolo ${state.trialIndex} / ${state.totalTrials}`)

  const countdownText = state.phase === 'countdown'
    ? String(Math.max(1, Math.ceil((state.countdownEndAtMs - Date.now()) / 1000)))
    : ''

  const graphLabel = state.phase === 'countdown'
    ? state.graphLabel
    : state.phase === 'trial'
      ? state.graphLabel
      : state.phase === 'comparison'
        ? `${state.leftGraphLabel} vs ${state.rightGraphLabel}`
        : ''

  return (
    <UiEntity
      uiTransform={{
        width: 620,
        height: 'auto',
        positionType: 'absolute',
        position: { bottom: SP.xl, left: '50%' },
        margin: { left: -310 },
        padding: { top: SP.sm, right: SP.lg, bottom: SP.sm, left: SP.lg },
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      uiBackground={{ color: COLORS.chatBg }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
        uiText={{ value: localizeText(title), fontSize: 18, color: COLORS.textPrimary }}
      />

      <UiEntity
        uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
        uiText={{ value: progress, fontSize: 15, color: COLORS.textSecondary }}
      />

      {state.phase !== 'finished' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.sm } }}
          uiText={{ value: localizeText(graphLabel), fontSize: 15, color: COLORS.textSecondary }}
        />
      )}

      {state.phase === 'countdown' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
          uiText={{ value: t(`Get ready... ${countdownText}`, `Preparati... ${countdownText}`), fontSize: 24, color: COLORS.textPrimary }}
        />
      )}

      {state.phase === 'trial' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        >
          <UiEntity
            uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
            uiText={{ value: t('What value from 0.0 to 10.0 is this chart communicating?\n(0 = Awful, 10 = Great)', 'Quale valore da 0,0 a 10,0 comunica questo grafico?\n(0 = Pessimo, 10 = Ottimo)'), fontSize: 16, color: COLORS.textPrimary }}
          />
          <UiEntity
            uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.sm } }}
            uiText={{ value: t('Use the buttons to enter a continuous value with one decimal place.', 'Usa i pulsanti per inserire un valore continuo con una cifra decimale.'), fontSize: 13, color: COLORS.placeholderText }}
          />
          <UiEntity
            uiTransform={{
              width: 150,
              height: 58,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              margin: { bottom: SP.sm },
            }}
            uiBackground={{ color: Color4.create(0.18, 0.36, 0.60, 1) }}
          >
            <UiEntity
              uiTransform={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
              uiText={{ value: category3NumericValue.toFixed(1), fontSize: 30, color: COLORS.textPrimary }}
            />
          </UiEntity>
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 'auto',
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            {renderCategory3NumericStepButton('-1', -1)}
            {renderCategory3NumericStepButton('-0.1', -0.1, 86)}
            {renderCategory3NumericStepButton('+0.1', 0.1, 86)}
            {renderCategory3NumericStepButton('+1', 1)}
          </UiEntity>
          {renderCategory3ConfirmButton()}
        </UiEntity>
      )}

      {state.phase === 'comparison' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        >
          <UiEntity
            uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
            uiText={{ value: t('Which chart communicates a more positive sentiment?', 'Quale grafico comunica un sentimento più positivo?'), fontSize: 16, color: COLORS.textPrimary }}
          />
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 'auto',
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              flexWrap: 'wrap',
              margin: { bottom: SP.sm },
            }}
          >
            {renderCategory3ComparisonChoiceButton('simple-donut', 'Simple donut')}
            {renderCategory3ComparisonChoiceButton('sentiment-meter', 'Sentiment meter')}
          </UiEntity>

          <UiEntity
            uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
            uiText={{ value: t('How far apart are the two values?', 'Quanto sono distanti i due valori?'), fontSize: 16, color: COLORS.textPrimary }}
          />
          <UiEntity
            uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.sm } }}
            uiText={{ value: t('Estimate the distance from 0.0 to 10.0 with one decimal place.', 'Stima la distanza da 0,0 a 10,0 con una cifra decimale.'), fontSize: 13, color: COLORS.placeholderText }}
          />
          <UiEntity
            uiTransform={{
              width: 150,
              height: 58,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              margin: { bottom: SP.sm },
            }}
            uiBackground={{ color: Color4.create(0.18, 0.36, 0.60, 1) }}
          >
            <UiEntity
              uiTransform={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
              uiText={{ value: category3DistanceValue.toFixed(1), fontSize: 30, color: COLORS.textPrimary }}
            />
          </UiEntity>
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 'auto',
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            {renderCategory3DistanceStepButton('-1', -1)}
            {renderCategory3DistanceStepButton('-0.1', -0.1, 86)}
            {renderCategory3DistanceStepButton('+0.1', 0.1, 86)}
            {renderCategory3DistanceStepButton('+1', 1)}
          </UiEntity>
          {renderCategory3ComparisonConfirmButton()}
        </UiEntity>
      )}

      {state.phase === 'finished' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', margin: { top: SP.xs } }}
          uiText={{ value: t('Test completed. Thank you!', 'Test completato. Grazie!'), fontSize: 18, color: COLORS.textPrimary }}
        />
      )}
    </UiEntity>
  )
}


function getCategory4TrendLabel(answer: Category4TrendAnswer) {
  switch (answer) {
    case 'improving': return t('Improving', 'In miglioramento')
    case 'worsening': return t('Worsening', 'In peggioramento')
    case 'stable': return t('Stable', 'Stabile')
    case 'unclear': return t('Unclear', 'Non chiaro')
  }
}

function getCategory4AnomalyLabel(answer: Category4AnomalyAnswer) {
  switch (answer) {
    case 'none': return t('No anomaly', 'Nessuna anomalia')
    case 'early': return t('Early', 'All’inizio')
    case 'middle': return t('Middle', 'A metà')
    case 'late': return t('Late', 'Alla fine')
  }
}

function renderCategory4TrendButton(answer: Category4TrendAnswer) {
  const selected = category4TrendAnswer === answer

  return (
    <Button
      value={selected ? `✓ ${getCategory4TrendLabel(answer)}` : getCategory4TrendLabel(answer)}
      variant={selected ? 'primary' : 'secondary'}
      onMouseDown={() => {
        if (category4ConfirmLocked) return
        category4TrendAnswer = answer
      }}
      uiTransform={{ width: 140, height: 42, margin: { right: SP.xs, bottom: SP.xs } }}
      fontSize={13}
    />
  )
}

function renderCategory4AnomalyButton(answer: Category4AnomalyAnswer) {
  const selected = category4AnomalyAnswer === answer

  return (
    <Button
      value={selected ? `✓ ${getCategory4AnomalyLabel(answer)}` : getCategory4AnomalyLabel(answer)}
      variant={selected ? 'primary' : 'secondary'}
      onMouseDown={() => {
        if (category4ConfirmLocked) return
        category4AnomalyAnswer = answer
      }}
      uiTransform={{ width: 140, height: 42, margin: { right: SP.xs, bottom: SP.xs } }}
      fontSize={13}
    />
  )
}

function renderCategory4ConfirmButton() {
  const canConfirm = !!category4TrendAnswer && !!category4AnomalyAnswer && !category4ConfirmLocked

  return (
    <Button
      value={canConfirm ? t('Confirm', 'Conferma') : t('Select answers', 'Seleziona le risposte')}
      variant={canConfirm ? 'primary' : 'secondary'}
      onMouseDown={() => {
        if (!canConfirm || !category4TrendAnswer || !category4AnomalyAnswer) return
        category4ConfirmLocked = true
        category4TemporalAnswerHandler?.(category4TrendAnswer, category4AnomalyAnswer)
      }}
      uiTransform={{ width: 180, height: 46, margin: { top: SP.xs } }}
      fontSize={15}
    />
  )
}

function renderCategory4TemporalPanel() {
  const state = category4TemporalUiState
  if (state.phase === 'hidden') return null

  const progress = state.phase === 'finished'
    ? t(`Completed: ${state.totalTrials} / ${state.totalTrials}`, `Completato: ${state.totalTrials} / ${state.totalTrials}`)
    : t(`Stimulus ${state.trialIndex} / ${state.totalTrials}`, `Stimolo ${state.trialIndex} / ${state.totalTrials}`)

  const countdownText = state.phase === 'countdown'
    ? String(Math.max(1, Math.ceil((state.countdownEndAtMs - Date.now()) / 1000)))
    : ''

  return (
    <UiEntity
      uiTransform={{
        width: 660,
        height: 'auto',
        positionType: 'absolute',
        position: { bottom: SP.xl, left: '50%' },
        margin: { left: -330 },
        padding: { top: SP.sm, right: SP.lg, bottom: SP.sm, left: SP.lg },
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      uiBackground={{ color: COLORS.chatBg }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
        uiText={{ value: t('Category 4 - Temporal test', 'Categoria 4 - Test temporale'), fontSize: 18, color: COLORS.textPrimary }}
      />

      <UiEntity
        uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
        uiText={{ value: progress, fontSize: 15, color: COLORS.textSecondary }}
      />

      {state.phase !== 'finished' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.sm } }}
          uiText={{ value: localizeText(state.graphLabel), fontSize: 15, color: COLORS.textSecondary }}
        />
      )}

      {state.phase === 'countdown' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
          uiText={{ value: t(`Get ready... ${countdownText}`, `Preparati... ${countdownText}`), fontSize: 24, color: COLORS.textPrimary }}
        />
      )}

      {state.phase === 'trial' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        >
          <UiEntity
            uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
            uiText={{ value: t('What is the general sentiment trend?', 'Qual è l’andamento generale del sentimento?'), fontSize: 16, color: COLORS.textPrimary }}
          />
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 'auto',
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              flexWrap: 'wrap',
              margin: { bottom: SP.sm },
            }}
          >
            {renderCategory4TrendButton('improving')}
            {renderCategory4TrendButton('worsening')}
            {renderCategory4TrendButton('stable')}
            {renderCategory4TrendButton('unclear')}
          </UiEntity>

          <UiEntity
            uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
            uiText={{ value: t('Is there a significant anomaly? If yes, where?', 'È presente un’anomalia significativa? Se sì, dove?'), fontSize: 16, color: COLORS.textPrimary }}
          />
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 'auto',
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              flexWrap: 'wrap',
              margin: { bottom: SP.sm },
            }}
          >
            {renderCategory4AnomalyButton('none')}
            {renderCategory4AnomalyButton('early')}
            {renderCategory4AnomalyButton('middle')}
            {renderCategory4AnomalyButton('late')}
          </UiEntity>

          {renderCategory4ConfirmButton()}
        </UiEntity>
      )}

      {state.phase === 'finished' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', margin: { top: SP.xs } }}
          uiText={{ value: t('Test completed. Thank you!', 'Test completato. Grazie!'), fontSize: 18, color: COLORS.textPrimary }}
        />
      )}
    </UiEntity>
  )
}


function getInterClassAnswerLabel(answer: InterClassScenarioAnswer) {
  switch (answer) {
    case 'stable-positive': return t('Stable positive', 'Positivo stabile')
    case 'sudden-drop': return t('Sudden drop', 'Calo improvviso')
    case 'gradual-improvement': return t('Gradual improvement', 'Miglioramento graduale')
    case 'polarized': return t('Polarized', 'Polarizzata')
    case 'unclear': return t('Unclear', 'Non chiaro')
  }
}

function renderInterClassAnswerButton(answer: InterClassScenarioAnswer) {
  const selected = interClassScenarioAnswer === answer

  return (
    <Button
      value={selected ? `✓ ${getInterClassAnswerLabel(answer)}` : getInterClassAnswerLabel(answer)}
      variant={selected ? 'primary' : 'secondary'}
      onMouseDown={() => {
        if (interClassConfirmLocked) return
        interClassScenarioAnswer = answer
      }}
      uiTransform={{ width: 190, height: 46, margin: { right: SP.xs, bottom: SP.xs } }}
      fontSize={14}
    />
  )
}

function getInterClassAnomalyLabel(answer: InterClassAnomalyAnswer) {
  switch (answer) {
    case 'none': return t('No anomaly', 'Nessuna anomalia')
    case 'early': return t('Early', 'All’inizio')
    case 'middle': return t('Middle', 'A metà')
    case 'late': return t('Late', 'Alla fine')
  }
}

function renderInterClassAnomalyButton(answer: InterClassAnomalyAnswer) {
  const selected = interClassAnomalyAnswer === answer

  return (
    <Button
      value={selected ? `✓ ${getInterClassAnomalyLabel(answer)}` : getInterClassAnomalyLabel(answer)}
      variant={selected ? 'primary' : 'secondary'}
      onMouseDown={() => {
        if (interClassConfirmLocked) return
        interClassAnomalyAnswer = answer
      }}
      uiTransform={{ width: 140, height: 42, margin: { right: SP.xs, bottom: SP.xs } }}
      fontSize={13}
    />
  )
}

function renderInterClassConfirmButton() {
  const canConfirm = !!interClassScenarioAnswer && !!interClassAnomalyAnswer && !interClassConfirmLocked

  return (
    <Button
      value={canConfirm ? t('Confirm', 'Conferma') : t('Select answers', 'Seleziona le risposte')}
      variant={canConfirm ? 'primary' : 'secondary'}
      onMouseDown={() => {
        if (!canConfirm || !interClassScenarioAnswer || !interClassAnomalyAnswer) return
        interClassConfirmLocked = true
        interClassAnswerHandler?.(interClassScenarioAnswer, interClassAnomalyAnswer)
      }}
      uiTransform={{ width: 180, height: 46, margin: { top: SP.xs } }}
      fontSize={15}
    />
  )
}


function setInterClassLikertValue(questionCode: string, value: InterClassLikertValue) {
  if (interClassLikertConfirmLocked) return
  interClassLikertAnswers = {
    ...interClassLikertAnswers,
    [questionCode]: value,
  }
}

function renderInterClassLikertValueButton(questionCode: string, value: InterClassLikertValue) {
  const selected = interClassLikertAnswers[questionCode] === value

  return (
    <Button
      value={selected ? `✓ ${value}` : `${value}`}
      variant={selected ? 'primary' : 'secondary'}
      onMouseDown={() => setInterClassLikertValue(questionCode, value)}
      uiTransform={{ width: 48, height: 38, margin: { right: SP.xs, bottom: SP.xs } }}
      fontSize={13}
    />
  )
}

function renderInterClassLikertQuestion(question: InterClassLikertQuestion) {
  return (
    <UiEntity
      key={question.code}
      uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.sm }, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
        uiText={{ value: `${question.code} - ${localizeText(question.text)}`, fontSize: 13, color: COLORS.textPrimary }}
      />
      <UiEntity
        uiTransform={{
          width: '100%',
          height: 'auto',
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        {renderInterClassLikertValueButton(question.code, 1)}
        {renderInterClassLikertValueButton(question.code, 2)}
        {renderInterClassLikertValueButton(question.code, 3)}
        {renderInterClassLikertValueButton(question.code, 4)}
        {renderInterClassLikertValueButton(question.code, 5)}
      </UiEntity>
    </UiEntity>
  )
}

function renderInterClassLikertConfirmButton(questions: InterClassLikertQuestion[]) {
  const canConfirm = questions.every((question) => interClassLikertAnswers[question.code] !== undefined) && !interClassLikertConfirmLocked

  return (
    <Button
      value={canConfirm ? t('Confirm Likert answers', 'Conferma risposte Likert') : t('Answer all questions', 'Rispondi a tutte le domande')}
      variant={canConfirm ? 'primary' : 'secondary'}
      onMouseDown={() => {
        if (!canConfirm) return
        interClassLikertConfirmLocked = true
        interClassLikertHandler?.(interClassLikertAnswers)
      }}
      uiTransform={{ width: 230, height: 46, margin: { top: SP.xs } }}
      fontSize={14}
    />
  )
}

function renderInterClassIntroButton() {
  return (
    <Button
      value={interClassIntroConfirmLocked ? t('Starting...', 'Avvio...') : t('Start test', 'Avvia test')}
      variant="primary"
      onMouseDown={() => {
        if (interClassIntroConfirmLocked) return
        interClassIntroConfirmLocked = true
        interClassIntroHandler?.()
      }}
      uiTransform={{ width: 180, height: 46, margin: { top: SP.sm } }}
      fontSize={15}
    />
  )
}

function getInterClassStateVariantCode(state: InterClassUiState) {
  return 'variantCode' in state ? state.variantCode : undefined
}

function getInterClassStateGraphLabels(state: InterClassUiState) {
  return 'graphCombinationLabels' in state ? state.graphCombinationLabels : undefined
}

function renderInterClassVariantLine(state: InterClassUiState) {
  const variantCode = getInterClassStateVariantCode(state)
  if (!variantCode) return null

  return (
    <UiEntity
      uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
      uiText={{ value: t(`Current variant: Variant ${variantCode}`, `Variante attuale: Variante ${variantCode}`), fontSize: 15, color: COLORS.textPrimary }}
    />
  )
}

function renderInterClassGraphLine(state: InterClassUiState) {
  const graphLabels = getInterClassStateGraphLabels(state)
  if (!graphLabels || graphLabels.length === 0) return null

  return (
    <UiEntity
      uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
      uiText={{ value: t(`Variant visualizations: ${graphLabels.join(', ')}.`, `Visualizzazioni della variante: ${localizeTextList(graphLabels).join(', ')}.`), fontSize: 13, color: COLORS.placeholderText }}
    />
  )
}

function renderInterClassComparisonComposition(state: InterClassUiState) {
  if (state.phase !== 'likert' || state.likertMode !== 'comparative' || !state.comparisonGraphCombinationLabels) return null

  return (
    <UiEntity
      uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.sm }, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
        uiText={{
          value: t(`Variant A visualizations: ${state.comparisonGraphCombinationLabels.variantA.join(', ')}.`, `Visualizzazioni Variante A: ${localizeTextList(state.comparisonGraphCombinationLabels.variantA).join(', ')}.`),
          fontSize: 14,
          color: COLORS.textPrimary,
        }}
      />
      <UiEntity
        uiTransform={{ width: '100%', height: 'auto' }}
        uiText={{
          value: t(`Variant B visualizations: ${state.comparisonGraphCombinationLabels.variantB.join(', ')}.`, `Visualizzazioni Variante B: ${localizeTextList(state.comparisonGraphCombinationLabels.variantB).join(', ')}.`),
          fontSize: 14,
          color: COLORS.textPrimary,
        }}
      />
    </UiEntity>
  )
}

function renderInterClassPanel() {
  const state = interClassUiState
  if (state.phase === 'hidden') return null

  const title = state.phase === 'likert'
    ? state.title
    : state.testId === 'inter-test-1-b'
      ? 'Inter-class Test 1 - Variant B'
      : state.testId === 'inter-test-2-a'
        ? 'Inter-class Test 2 - Variant A'
        : state.testId === 'inter-test-2-b'
          ? 'Inter-class Test 2 - Variant B'
          : state.testId === 'inter-test-3-a'
            ? 'Inter-class Test 3 - Variant A'
            : state.testId === 'inter-test-3-b'
              ? 'Inter-class Test 3 - Variant B'
              : state.testId === 'inter-test-1-final-likert'
                ? 'Inter-class Test 1 - final comparison'
                : state.testId === 'inter-test-2-final-likert'
                  ? 'Inter-class Test 2 - final comparison'
                  : state.testId === 'inter-test-3-final-likert'
                    ? 'Inter-class Test 3 - final comparison'
                    : 'Inter-class Test 1 - Variant A'

  const progress = state.phase === 'finished'
    ? t(`Completed: ${state.totalTrials} / ${state.totalTrials}`, `Completato: ${state.totalTrials} / ${state.totalTrials}`)
    : state.phase === 'likert' && state.likertMode === 'comparative'
      ? t('Final comparative scale', 'Scala comparativa finale')
      : t(`Scenario ${state.trialIndex} / ${state.totalTrials}`, `Scenario ${state.trialIndex} / ${state.totalTrials}`)

  const countdownText = state.phase === 'countdown'
    ? String(Math.max(1, Math.ceil((state.countdownEndAtMs - Date.now()) / 1000)))
    : ''

  return (
    <UiEntity
      uiTransform={{
        width: 760,
        height: 'auto',
        positionType: 'absolute',
        position: { bottom: SP.xl, left: '50%' },
        margin: { left: -380 },
        padding: { top: SP.sm, right: SP.lg, bottom: SP.sm, left: SP.lg },
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      uiBackground={{ color: COLORS.chatBg }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
        uiText={{ value: localizeText(title), fontSize: 18, color: COLORS.textPrimary }}
      />

      <UiEntity
        uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
        uiText={{ value: progress, fontSize: 15, color: COLORS.textSecondary }}
      />

      {renderInterClassVariantLine(state)}
      {state.phase !== 'intro' && renderInterClassGraphLine(state)}
      {renderInterClassComparisonComposition(state)}

      {state.phase === 'intro' && (
        <UiEntity uiTransform={{ width: '100%', height: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <UiEntity
            uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
            uiText={{
              value: t(`Variant ${state.variantCode} visualizations: ${state.graphCombinationLabels.join(', ')}.`, `Visualizzazioni Variante ${state.variantCode}: ${localizeTextList(state.graphCombinationLabels).join(', ')}.`),
              fontSize: 15,
              color: COLORS.textPrimary,
            }}
          />
          <UiEntity
            uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
            uiText={{ value: localizeText(state.disclaimer), fontSize: 13, color: COLORS.placeholderText }}
          />
          {renderInterClassIntroButton()}
        </UiEntity>
      )}

      {state.phase === 'countdown' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
          uiText={{ value: t(`Get ready... ${countdownText}`, `Preparati... ${countdownText}`), fontSize: 24, color: COLORS.textPrimary }}
        />
      )}

      {state.phase === 'playback' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
          uiText={{ value: t(`Playback: ${state.currentPoint} / ${state.totalPoints}`, `Riproduzione: ${state.currentPoint} / ${state.totalPoints}`), fontSize: 17, color: COLORS.textPrimary }}
        />
      )}

      {state.phase === 'answer' && (
        <UiEntity uiTransform={{ width: '100%', height: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <UiEntity
            uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.sm } }}
            uiText={{ value: t('Which scenario best describes the conversation?', 'Quale scenario descrive meglio la conversazione?'), fontSize: 16, color: COLORS.textPrimary }}
          />
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 'auto',
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            {renderInterClassAnswerButton('stable-positive')}
            {renderInterClassAnswerButton('sudden-drop')}
            {renderInterClassAnswerButton('gradual-improvement')}
            {renderInterClassAnswerButton('polarized')}
            {renderInterClassAnswerButton('unclear')}
          </UiEntity>

          <UiEntity
            uiTransform={{ width: '100%', height: 'auto', margin: { top: SP.sm, bottom: SP.sm } }}
            uiText={{ value: t('Is there a significant anomaly? If yes, where?', 'È presente un’anomalia significativa? Se sì, dove?'), fontSize: 16, color: COLORS.textPrimary }}
          />
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 'auto',
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            {renderInterClassAnomalyButton('none')}
            {renderInterClassAnomalyButton('early')}
            {renderInterClassAnomalyButton('middle')}
            {renderInterClassAnomalyButton('late')}
          </UiEntity>

          {renderInterClassConfirmButton()}
        </UiEntity>
      )}

      {state.phase === 'likert' && (
        <UiEntity uiTransform={{ width: '100%', height: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <UiEntity
            uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
            uiText={{ value: localizeText(state.subtitle), fontSize: 15, color: COLORS.textPrimary }}
          />
          <UiEntity
            uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.sm } }}
            uiText={{ value: localizeText(state.scaleDescription), fontSize: 13, color: COLORS.placeholderText }}
          />
          {state.questions.map((question) => renderInterClassLikertQuestion(question))}
          {renderInterClassLikertConfirmButton(state.questions)}
        </UiEntity>
      )}

      {state.phase === 'finished' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', margin: { top: SP.xs } }}
          uiText={{ value: t('Test completed. Thank you!', 'Test completato. Grazie!'), fontSize: 18, color: COLORS.textPrimary }}
        />
      )}
    </UiEntity>
  )
}

function renderCategory1ExperimentPanel() {
  const state = category1ExperimentUiState
  if (state.phase === 'hidden') return null

  const title = state.testId === 'cat1-test-1-1'
    ? 'Category 1 - Test 1.1'
    : 'Category 1 - Test 1.2'

  const progress = state.phase === 'finished'
    ? t(`Completed: ${state.totalTrials} / ${state.totalTrials}`, `Completato: ${state.totalTrials} / ${state.totalTrials}`)
    : t(`Stimulus ${state.trialIndex} / ${state.totalTrials}`, `Stimolo ${state.trialIndex} / ${state.totalTrials}`)

  const countdownText = state.phase === 'countdown'
    ? String(Math.max(1, Math.ceil((state.countdownEndAtMs - Date.now()) / 1000)))
    : ''

  return (
    <UiEntity
      uiTransform={{
        width: 620,
        height: 'auto',
        positionType: 'absolute',
        position: { bottom: SP.xl, left: '50%' },
        margin: { left: -310 },
        padding: { top: SP.sm, right: SP.lg, bottom: SP.sm, left: SP.lg },
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      uiBackground={{ color: COLORS.chatBg }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
        uiText={{ value: localizeText(title), fontSize: 18, color: COLORS.textPrimary }}
      />

      <UiEntity
        uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
        uiText={{ value: progress, fontSize: 15, color: COLORS.textSecondary }}
      />

      {state.phase !== 'finished' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.sm } }}
          uiText={{ value: localizeText(state.graphLabel), fontSize: 15, color: COLORS.textSecondary }}
        />
      )}

      {state.phase === 'countdown' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
          uiText={{ value: t(`Get ready... ${countdownText}`, `Preparati... ${countdownText}`), fontSize: 24, color: COLORS.textPrimary }}
        />
      )}

      {state.phase === 'trial' && state.testId === 'cat1-test-1-1' && (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <UiEntity
            uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.sm } }}
            uiText={{ value: t('Which sentiment does this element communicate?', 'Quale sentimento comunica questo elemento?'), fontSize: 16, color: COLORS.textPrimary }}
          />
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 'auto',
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            {renderPredictionButton('Awful')}
            {renderPredictionButton('Bad')}
            {renderPredictionButton('Neutral')}
            {renderPredictionButton('Good')}
            {renderPredictionButton('Great')}
          </UiEntity>
        </UiEntity>
      )}

      {state.phase === 'trial' && state.testId === 'cat1-test-1-2' && (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <UiEntity
            uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
            uiText={{ value: t('What value from 0 to 10 do you think it communicates?\n(0 = Awful, 10 = Great)', 'Quale valore da 0 a 10 pensi che comunichi?\n(0 = Pessimo, 10 = Ottimo)'), fontSize: 16, color: COLORS.textPrimary }}
          />
          <UiEntity
            uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.sm } }}
            uiText={{ value: t('Use the buttons to enter a continuous value with one decimal place.', 'Usa i pulsanti per inserire un valore continuo con una cifra decimale.'), fontSize: 13, color: COLORS.placeholderText }}
          />
          <UiEntity
            uiTransform={{
              width: 150,
              height: 58,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              margin: { bottom: SP.sm },
            }}
            uiBackground={{ color: Color4.create(0.18, 0.36, 0.60, 1) }}
          >
            <UiEntity
              uiTransform={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
              uiText={{ value: category1NumericValue.toFixed(1), fontSize: 30, color: COLORS.textPrimary }}
            />
          </UiEntity>
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 'auto',
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            {renderNumericStepButton('-1', -1)}
            {renderNumericStepButton('-0.1', -0.1, 86)}
            {renderNumericStepButton('+0.1', 0.1, 86)}
            {renderNumericStepButton('+1', 1)}
          </UiEntity>
          {renderNumericConfirmButton()}
        </UiEntity>
      )}

      {state.phase === 'finished' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', margin: { top: SP.xs } }}
          uiText={{ value: t('Test completed. Thank you!', 'Test completato. Grazie!'), fontSize: 18, color: COLORS.textPrimary }}
        />
      )}
    </UiEntity>
  )
}


function renderCategory2CompositionPanel() {
  const state = category2CompositionUiState
  if (state.phase === 'hidden') return null

  const progress = state.phase === 'finished'
    ? t(`Completed: ${state.totalTrials} / ${state.totalTrials}`, `Completato: ${state.totalTrials} / ${state.totalTrials}`)
    : t(`Configuration ${state.trialIndex} / ${state.totalTrials}`, `Configurazione ${state.trialIndex} / ${state.totalTrials}`)

  return (
    <UiEntity
      uiTransform={{
        width: 680,
        height: 'auto',
        positionType: 'absolute',
        position: { bottom: SP.xl, left: '50%' },
        margin: { left: -340 },
        padding: { top: SP.sm, right: SP.lg, bottom: SP.sm, left: SP.lg },
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      uiBackground={{ color: COLORS.chatBg }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
        uiText={{ value: t('Category 2 - Composition test', 'Categoria 2 - Test di composizione'), fontSize: 18, color: COLORS.textPrimary }}
      />
      <UiEntity
        uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
        uiText={{ value: progress, fontSize: 15, color: COLORS.textSecondary }}
      />

      {state.phase !== 'finished' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
          uiText={{ value: localizeText(state.graphLabel), fontSize: 15, color: COLORS.textSecondary }}
        />
      )}

      {state.phase === 'countdown' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
          uiText={{ value: `Get ready... ${getRemainingSeconds(state.countdownEndAtMs)}`, fontSize: 24, color: COLORS.textPrimary }}
        />
      )}

      {state.phase === 'observation' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        >
          <UiEntity
            uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
            uiText={{ value: t(`Observe the chart: ${getRemainingSeconds(state.observationEndAtMs)}s`, `Osserva il grafico: ${getRemainingSeconds(state.observationEndAtMs)}s`), fontSize: 22, color: COLORS.textPrimary }}
          />
          <UiEntity
            uiTransform={{ width: '100%', height: 'auto' }}
            uiText={{ value: t('The questions will appear after 5 seconds.', 'Le domande appariranno dopo 5 secondi.'), fontSize: 13, color: COLORS.placeholderText }}
          />
        </UiEntity>
      )}

      {state.phase === 'answer' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        >
          <UiEntity
            uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.sm } }}
            uiText={{ value: t('What is the dominant sentiment?', 'Qual è il sentimento dominante?'), fontSize: 16, color: COLORS.textPrimary }}
          />
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 'auto',
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              flexWrap: 'wrap',
              margin: { bottom: SP.sm },
            }}
          >
            {renderCategory2DominantButton('negative')}
            {renderCategory2DominantButton('neutral')}
            {renderCategory2DominantButton('positive')}
            {renderCategory2DominantButton('unclear')}
          </UiEntity>

          <UiEntity
            uiTransform={{ width: '100%', height: 'auto', margin: { bottom: SP.xs } }}
            uiText={{ value: t('Estimate the percentage of each class:', 'Stima la percentuale di ogni classe:'), fontSize: 15, color: COLORS.textPrimary }}
          />
          {renderCategory2EstimateRow('Negative', 'negative')}
          {renderCategory2EstimateRow('Neutral', 'neutral')}
          {renderCategory2EstimateRow('Positive', 'positive')}
          {renderCategory2ConfirmButton()}
        </UiEntity>
      )}

      {state.phase === 'finished' && (
        <UiEntity
          uiTransform={{ width: '100%', height: 'auto', margin: { top: SP.xs } }}
          uiText={{ value: t('Test completed. Thank you!', 'Test completato. Grazie!'), fontSize: 18, color: COLORS.textPrimary }}
        />
      )}
    </UiEntity>
  )
}

export function setupUi() {

  // Register polling systems in the game loop
  engine.addSystem(chatPollingSystem)
  engine.addSystem(completedTestsPollingSystem)
  refreshCompletedTestsFromServer()

  // Register the UI once; it is rendered every frame
  ReactEcsRenderer.setUiRenderer(ui)
}

const ui = () => {
  const inputValue = clearInput ? ' ' : ''
  if (clearInput) clearInput = false

  const sortedMessages = sortMessages(chatMessages)

  const maxOffset = Math.max(0, sortedMessages.length - MAX_VISIBLE_MESSAGES)
  if (chatScrollOffset > maxOffset) {
    chatScrollOffset = maxOffset
  }

  const visibleMessages = sortedMessages.slice(
    chatScrollOffset,
    chatScrollOffset + MAX_VISIBLE_MESSAGES
  )

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
      }}
    >
      <UiEntity
        uiTransform={{
          width: '100%',
          height: '100%',
          positionType: 'absolute',
        }}
      >
        {!isGuiTemporarilyHidden && <NpcUtilsUi />}

      {renderCompletedTestsPanel()}
      {testIntroUiState.phase !== 'hidden' && renderTestIntroPanel()}
      {category1ExperimentUiState.phase !== 'hidden' && renderCategory1ExperimentPanel()}
      {category2CompositionUiState.phase !== 'hidden' && renderCategory2CompositionPanel()}
      {category3QuantitativeUiState.phase !== 'hidden' && renderCategory3QuantitativePanel()}
      {category4TemporalUiState.phase !== 'hidden' && renderCategory4TemporalPanel()}
      {interClassUiState.phase !== 'hidden' && renderInterClassPanel()}

      <UiEntity
        uiTransform={{
          width: 'auto',
          height: 'auto',
          positionType: 'absolute',
          position: { top: SP.lg, left: '38%' },
          padding: { top: SP.sm, right: SP.xl, bottom: SP.sm, left: SP.xl },
          display: isGuiTemporarilyHidden ? 'none' : 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
        }}
        uiBackground={{ color: COLORS.surface }}
      >
        <UiEntity
          uiTransform={{ width: 'auto', height: 'auto', margin: { bottom: SP.xs } }}
          uiText={{ value: t('Project state', 'Stato del progetto'), fontSize: 20, color: COLORS.textPrimary }}
        />
        <UiEntity
          uiTransform={{ width: '100%', height: 2, margin: { bottom: SP.sm } }}
          uiBackground={{ color: COLORS.divider }}
        />
        <UiEntity
          uiTransform={{ width: 'auto', height: 'auto' }}
          uiText={{ value: `Sprint ${MEETING_NUMBER}`, fontSize: 20, color: COLORS.textSecondary }}
        />
      </UiEntity>

      <UiEntity
        uiTransform={{
          width: 'auto',
          height: 'auto',
          positionType: 'absolute',
          position: { top: SP.lg, left: '52%' },
          padding: { top: SP.sm, right: SP.xl, bottom: SP.sm, left: SP.xl },
          display: isGuiTemporarilyHidden ? 'none' : 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
        }}
        uiBackground={{ color: COLORS.surface }}
      >
        <UiEntity
          uiTransform={{ width: 'auto', height: 'auto', margin: { bottom: SP.xs } }}
          uiText={{ value: t('Current ceremony', 'Cerimonia attuale'), fontSize: 20, color: COLORS.textPrimary }}
        />
        <UiEntity
          uiTransform={{ width: '100%', height: 2, margin: { bottom: SP.sm } }}
          uiBackground={{ color: COLORS.divider }}
        />
        <UiEntity
          uiTransform={{ width: 'auto', height: 'auto' }}
          uiText={{ value: t(PROJECT_NAME, 'Riunione di revisione dello sprint'), fontSize: 20, color: COLORS.textSecondary }}
        />
      </UiEntity>

      <UiEntity
        uiTransform={{
          width: 'auto',
          height: 'auto',
          positionType: 'absolute',
          position: { right: SP.xl, top: '40%' },
          display: isGuiTemporarilyHidden ? 'none' : 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: { top: SP.sm, right: SP.lg, bottom: SP.sm, left: SP.lg },
        }}
        uiBackground={{ color: COLORS.surface }}
      >
        <UiEntity
          uiTransform={{ width: 'auto', height: 'auto', justifyContent: 'center', margin: { bottom: SP.xs } }}
          uiText={{ value: t('Software Developer', 'Sviluppatore software'), fontSize: 20, color: COLORS.textPrimary }}
        />
        <UiEntity
          uiTransform={{ width: '100%', height: 2, margin: { bottom: SP.sm } }}
          uiBackground={{ color: COLORS.divider }}
        />
        <UiEntity
          uiTransform={{ width: 240, height: 'auto' }}
          uiText={{
            value: t(`Workload Sprint${MEETING_NUMBER}\nUS1 priority 1\nUS2 priority 3\nUS17 priority 1`, `Carico di lavoro Sprint ${MEETING_NUMBER}\nUS1 priorità 1\nUS2 priorità 3\nUS17 priorità 1`),
            fontSize: 16,
            color: COLORS.textSecondary,
          }}
        />
      </UiEntity>

      {/* CHAT CUSTOM */}
      <UiEntity
        uiTransform={{
          width: 460,
          height: 360,
          positionType: 'absolute',
          position: { left: SP.lg * 2, bottom: SP.xl * 10 },
          display: isChatTemporarilyHidden ? 'none' : 'flex',
          flexDirection: 'column',
          padding: { top: SP.sm, right: SP.sm, bottom: SP.sm, left: SP.sm },
        }}
        uiBackground={{ color: COLORS.chatBg }}
      >
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 'auto',
            margin: { bottom: SP.sm },
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <UiEntity
            uiTransform={{ width: 'auto', height: 'auto' }}
            uiText={{ value: t('Scene chat', 'Chat della scena'), fontSize: 20, color: COLORS.textPrimary }}
          />
          <UiEntity
            uiTransform={{
              width: 'auto',
              height: 'auto',
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <Button
              value="▲"
              variant="secondary"
              onMouseDown={scrollChatUp}
              uiTransform={{ width: 36, height: 28, margin: { right: SP.xs } }}
              fontSize={14}
            />
            <Button
              value="▼"
              variant="secondary"
              onMouseDown={scrollChatDown}
              uiTransform={{ width: 36, height: 28 }}
              fontSize={14}
            />
            <Button
              value="DEBUG"
              variant="secondary"
              onMouseDown={debugFetchAllMessages}
              uiTransform={{ width: 80, height: 28, margin: { left: SP.sm } }}
              fontSize={12}
            />
          </UiEntity>
        </UiEntity>

        <UiEntity
          uiTransform={{ width: '100%', height: 2, margin: { bottom: SP.sm } }}
          uiBackground={{ color: COLORS.divider }}
        />

        <UiEntity
          uiTransform={{
            width: '100%',
            height: 220,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            margin: { bottom: SP.sm },
          }}
        >
          {visibleMessages.map((msg) => (
            <UiEntity
              key={`chat-msg-${msg.id}`}
              uiTransform={{
                width: '100%',
                minHeight: 36,
                height: 'auto',
                margin: { bottom: SP.xs },
                padding: { top: 6, right: 8, bottom: 6, left: 8 },
              }}
              uiBackground={{ color: COLORS.chatMessageBg }}
            >
              <UiEntity
                uiTransform={{ width: '100%', height: 'auto' }}
                uiText={{
                  value: `[${msg.timestamp}] ${msg.author}: ${msg.text}`,
                  fontSize: 14,
                  color: COLORS.textSecondary,
                  textWrap: 'wrap',
                }}
              />
            </UiEntity>
          ))}
        </UiEntity>

        <UiEntity
          uiTransform={{
            width: '100%',
            height: 'auto',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <UiEntity
            uiTransform={{
              width: 330,
              height: 42,
              margin: { right: SP.sm },
              padding: { left: 8, right: 8 },
            }}
            uiBackground={{ color: COLORS.inputBg }}
          >
            <Input
              value={inputValue}
              onChange={(value) => { currentInput = value }}
              onSubmit={(value) => { addLocalChatMessage(value) }}
              placeholder={t('Write a message...', 'Scrivi un messaggio...')}
              placeholderColor={COLORS.placeholderText}
              fontSize={16}
              color={COLORS.inputText}
              uiTransform={{ width: '100%', height: '100%' }}
            />
          </UiEntity>
          <Button
            value={t('Send', 'Invia')}
            variant="secondary"
            onMouseDown={() => { addLocalChatMessage(currentInput) }}
            uiTransform={{ width: 88, height: 42 }}
            fontSize={16}
          />
        </UiEntity>
      </UiEntity>

      <UiEntity
        uiTransform={{
          width: 'auto',
          height: 'auto',
          positionType: 'absolute',
          position: { right: SP.xl, bottom: SP.xl },
          display: isGuiTemporarilyHidden ? 'none' : 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: { top: SP.sm, right: SP.lg, bottom: SP.sm, left: SP.lg },
        }}
        uiBackground={{ color: COLORS.dockBg }}
      >
        <UiEntity
          uiTransform={{
            width: 'auto',
            height: 'auto',
            margin: { bottom: SP.md },
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
          uiText={{ value: t('How do you feel?', 'Come ti senti?'), fontSize: 20, color: COLORS.textPrimary }}
        />
        <UiEntity
          uiTransform={{
            width: 'auto',
            height: 'auto',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'flex-start',
          }}
        >
          <UiEntity
            uiTransform={{
              width: 'auto',
              height: 'auto',
              margin: { right: SP.xl },
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <UiEntity
              uiTransform={{
                width: 88,
                height: 88,
                margin: { bottom: SP.sm },
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
              }}
              uiBackground={{ color: COLORS.comfortBg }}
              onMouseDown={() => {
                const player = getPlayer()
                const timestamp = new Date().toISOString()
                console.log(`[COMFORT]`, JSON.stringify({
                  project: PROJECT_NAME,
                  meeting: MEETING_NUMBER,
                  employee: player?.userId ?? 'Unknown Player',
                  timestamp,
                }))
              }}
            >
              <UiEntity
                uiTransform={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                uiText={{ value: '✓', fontSize: 40, color: COLORS.textPrimary }}
              />
            </UiEntity>
            <UiEntity
              uiTransform={{ width: 'auto', height: 'auto', display: 'flex', alignItems: 'center' }}
              uiText={{ value: t('Comfort', 'A mio agio'), fontSize: 16, color: COLORS.textSecondary }}
            />
          </UiEntity>

          <UiEntity
            uiTransform={{
              width: 'auto',
              height: 'auto',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <UiEntity
              uiTransform={{
                width: 88,
                height: 88,
                margin: { bottom: SP.sm },
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
              }}
              uiBackground={{ color: COLORS.discomfortBg }}
              onMouseDown={() => {
                const player = getPlayer()
                sendDiscomfortClick(player?.userId)
                const timestamp = new Date().toISOString()
                console.log(`[DISCOMFORT]`, JSON.stringify({
                  project: PROJECT_NAME,
                  meeting: MEETING_NUMBER,
                  employee: player?.userId ?? 'Unknown Player',
                  timestamp,
                }))
              }}
            >
              <UiEntity
                uiTransform={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                uiText={{ value: '!', fontSize: 40, color: COLORS.textPrimary }}
              />
            </UiEntity>
            <UiEntity
              uiTransform={{ width: 'auto', height: 'auto', display: 'flex', alignItems: 'center' }}
              uiText={{ value: t('Discomfort', 'Disagio'), fontSize: 16, color: COLORS.textSecondary }}
            />
          </UiEntity>
        </UiEntity>
      </UiEntity>
        </UiEntity>

      {renderGuiVisibilityButton()}
    </UiEntity>
  )
}