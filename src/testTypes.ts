export type TestMode = 'none' | 'intra' | 'inter' | 'all'

export type GraphType =
  | 'sentiment-image'
  | 'sentiment-light'
  | 'simple-donut'
  | 'sentiment-meter'
  | 'tricolor-donut'
  | 'bar-chart'
  | 'heatmap'

export type TestType =
  | 'test-1-1'
  | 'test-1-2'
  | 'test-composition'
  | 'test-3-1'
  | 'test-3-2'
  | 'test-temporal'
  | 'inter-test-1-a'
  | 'inter-test-1-b'
  | 'inter-test-2-a'
  | 'inter-test-2-b'
  | 'inter-test-3-a'
  | 'inter-test-3-b'
  | 'inter-test-1-final-likert'
  | 'inter-test-2-final-likert'
  | 'inter-test-3-final-likert'
  | 'all-tests'

export type SelectTestFn = (
  mode: TestMode,
  graphs?: GraphType | GraphType[],
  test?: TestType
) => void
