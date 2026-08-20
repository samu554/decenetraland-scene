import {
  engine,
  Transform,
  Material,
  MeshRenderer,
  TextShape,
  MeshCollider,
  ColliderLayer,
  pointerEventsSystem,
  InputAction,
  Entity,
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'

// ---------------------------------------------------------------------------
// Shared test types
// ---------------------------------------------------------------------------

import type { GraphType, SelectTestFn } from './testTypes'
import { localizeText, onLanguageChange } from './i18n'

// ---------------------------------------------------------------------------
// Board colors
// ---------------------------------------------------------------------------

const C = {
  panelBg:    Color4.create(0.08, 0.08, 0.12, 1),
  headerBg:   Color4.create(0.14, 0.14, 0.22, 1),
  btnIdle:    Color4.create(0.18, 0.36, 0.60, 1),
  btnBack:    Color4.create(0.28, 0.28, 0.28, 1),
  btnConfirm: Color4.create(0.15, 0.50, 0.20, 1),
  textLight:  Color4.create(0.95, 0.95, 0.95, 1),
  pendingNote: Color4.create(0.75, 0.75, 0.82, 1),
  divider:    Color4.create(0.35, 0.35, 0.55, 1),
}

// ---------------------------------------------------------------------------
// Screen types
// ---------------------------------------------------------------------------

type BtnDef = {
  label:   string
  color?:  Color4
  goTo?:   ScreenId
  action?: () => void
}

type ScreenDef = {
  title:  string
  body?:  string
  buttons: BtnDef[]
}

type ScreenId =
  | 'start'
  | 'hide-all'
  | 'inter-class'
  | 'inter-test-1'
  | 'inter-test-2'
  | 'inter-test-3'
  | 'intra-class'
  | 'cat1-tests'
  | 'cat2-tests'
  | 'cat3-graphs'
  | 'cat3-donut-tests'
  | 'cat3-meter-tests'
  | 'cat4-tests'
  | 'selected'

// ---------------------------------------------------------------------------
// Screen factory
// ---------------------------------------------------------------------------

// Cat. 1 — all four charts together
const CAT1_ALL: GraphType[] = ['sentiment-image', 'sentiment-light', 'simple-donut', 'sentiment-meter']

// Cat. 3 — donut + meter together
const CAT3_ALL: GraphType[] = ['simple-donut', 'sentiment-meter']

// Cat. 4 — bar chart + heatmap together
const CAT4_ALL: GraphType[] = ['bar-chart', 'heatmap']

// Inter-class — combinations used in the three experimental comparisons
// Test 1: current sentiment value with temporal context available
const INTER_TEST_1_A: GraphType[] = ['sentiment-image', 'bar-chart']
const INTER_TEST_1_B: GraphType[] = ['sentiment-meter', 'bar-chart']

// Test 2: class distribution plus aggregate temporal trend
const INTER_TEST_2_A: GraphType[] = ['sentiment-image', 'bar-chart']
const INTER_TEST_2_B: GraphType[] = ['tricolor-donut', 'bar-chart']

// Test 3: non-temporal charts versus explicit temporal context
const INTER_TEST_3_A: GraphType[] = ['sentiment-meter', 'tricolor-donut']
const INTER_TEST_3_B: GraphType[] = ['bar-chart']

function buildScreens(selectTest: SelectTestFn): Record<ScreenId, ScreenDef> {
  return {

    // ── Start ────────────────────────────────────────────────────────────────
    'start': {
      title: 'Configure test',
      body:  'Choose the mode:',
      buttons: [
        { label: 'Run all tests', goTo: 'selected', color: C.btnConfirm, action: () => selectTest('all', [], 'all-tests') },
        { label: 'Intra-class',   goTo: 'intra-class'  },
        { label: 'Inter-class',   goTo: 'inter-class'  },
        { label: 'Hide all', goTo: 'hide-all',     action: () => selectTest('none'), color: C.btnBack },
      ],
    },

    'hide-all': {
      title: 'Hide all',
      body:  'Visualizations\nhidden.',
      buttons: [
        { label: '< Back', goTo: 'start', color: C.btnBack },
      ],
    },

    // ── Inter-class ─────────────────────────────────────────────────────────
    'inter-class': {
      title: 'Inter-class',
      body:  'Choose the comparison\nbetween categories:',
      buttons: [
        { label: 'Test 1', goTo: 'inter-test-1' },
        { label: 'Test 2', goTo: 'inter-test-2' },
        { label: 'Test 3', goTo: 'inter-test-3' },
        { label: '< Back', goTo: 'start', color: C.btnBack },
      ],
    },

    'inter-test-1': {
      title: 'Inter - Test 1',
      body:  'Temporal chart +\ncurrent value reading.\nA: emoji + bars\nB: sentiment meter + bars',
      buttons: [
        {
          label: 'Case A',
          goTo: 'selected',
          color: C.btnConfirm,
          action: () => selectTest('inter', INTER_TEST_1_A, 'inter-test-1-a'),
        },
        {
          label: 'Case B',
          goTo: 'selected',
          color: C.btnConfirm,
          action: () => selectTest('inter', INTER_TEST_1_B, 'inter-test-1-b'),
        },
        {
          label: 'Final Likert',
          goTo: 'selected',
          color: C.btnConfirm,
          action: () => selectTest('inter', [], 'inter-test-1-final-likert'),
        },
        { label: '< Back', goTo: 'inter-class', color: C.btnBack },
      ],
    },

    'inter-test-2': {
      title: 'Inter - Test 2',
      body:  'Aggregate trend\nversus sentiment composition.\nA: emoji + bars\nB: 3-color donut + bars',
      buttons: [
        {
          label: 'Case A',
          goTo: 'selected',
          color: C.btnConfirm,
          action: () => selectTest('inter', INTER_TEST_2_A, 'inter-test-2-a'),
        },
        {
          label: 'Case B',
          goTo: 'selected',
          color: C.btnConfirm,
          action: () => selectTest('inter', INTER_TEST_2_B, 'inter-test-2-b'),
        },
        {
          label: 'Final Likert',
          goTo: 'selected',
          color: C.btnConfirm,
          action: () => selectTest('inter', [], 'inter-test-2-final-likert'),
        },
        { label: '< Back', goTo: 'inter-class', color: C.btnBack },
      ],
    },

    'inter-test-3': {
      title: 'Inter - Test 3',
      body:  'Current-state charts\nversus temporal context.\nA: meter + 3-color donut\nB: bars only',
      buttons: [
        {
          label: 'Case A',
          goTo: 'selected',
          color: C.btnConfirm,
          action: () => selectTest('inter', INTER_TEST_3_A, 'inter-test-3-a'),
        },
        {
          label: 'Case B',
          goTo: 'selected',
          color: C.btnConfirm,
          action: () => selectTest('inter', INTER_TEST_3_B, 'inter-test-3-b'),
        },
        {
          label: 'Final Likert',
          goTo: 'selected',
          color: C.btnConfirm,
          action: () => selectTest('inter', [], 'inter-test-3-final-likert'),
        },
        { label: '< Back', goTo: 'inter-class', color: C.btnBack },
      ],
    },

    // ── Category selection ──────────────────────────────────────────────────
    'intra-class': {
      title: 'Intra-class',
      body:  'Choose the category:',
      buttons: [
        { label: 'Cat.1 Indicators',   goTo: 'cat1-tests'  },
        { label: 'Cat.2 Composition', goTo: 'cat2-tests'  },
        { label: 'Cat.3 Quantitative', goTo: 'cat3-graphs' },
        { label: 'Cat.4 Temporal',    goTo: 'cat4-tests'  },
        { label: '< Back',         goTo: 'start', color: C.btnBack },
      ],
    },

    // ── Cat. 1 ───────────────────────────────────────────────────────────────
    'cat1-tests': {
      title: 'Cat.1 - Indicators',
      body:  '1.1: classify the sentiment.\n1.2: assign a 0-10 value.\nCharts: emoji, light, donut and meter.',
      buttons: [
        {
          label: 'Test 1.1',
          goTo: 'selected',
          color: C.btnConfirm,
          action: () => selectTest('intra', CAT1_ALL, 'test-1-1'),
        },
        {
          label: 'Test 1.2',
          goTo: 'selected',
          color: C.btnConfirm,
          action: () => selectTest('intra', CAT1_ALL, 'test-1-2'),
        },
        { label: '< Back', goTo: 'intra-class', color: C.btnBack },
      ],
    },

    // ── Cat. 2 ───────────────────────────────────────────────────────────────
    'cat2-tests': {
      title: 'Cat.2 - Composition',
      body:  'Estimate the dominant class and %\nof the three classes.\nChart: 3-color donut.',
      buttons: [
        {
          label: 'Start test',
          goTo: 'selected',
          color: C.btnConfirm,
          action: () => selectTest('intra', 'tricolor-donut', 'test-composition'),
        },
        { label: '< Back', goTo: 'intra-class', color: C.btnBack },
      ],
    },

    // ── Cat. 3 ───────────────────────────────────────────────────────────────
    'cat3-graphs': {
      title: 'Cat.3 - Quantitative',
      body:  '3.1: estimate the value (0-10).\n3.2: choose the higher value\nand estimate the distance.\nCharts: donut + meter.',
      buttons: [
        {
          label: 'Test 3.1',
          goTo: 'selected',
          color: C.btnConfirm,
          action: () => selectTest('intra', CAT3_ALL, 'test-3-1'),
        },
        {
          label: 'Test 3.2',
          goTo: 'selected',
          color: C.btnConfirm,
          action: () => selectTest('intra', CAT3_ALL, 'test-3-2'),
        },
        { label: '< Back', goTo: 'intra-class', color: C.btnBack },
      ],
    },

    // schermi cat3 non più usati ma necessari per soddisfare il tipo ScreenId
    'cat3-donut-tests': {
      title: 'Cat.3 - Donut',
      body:  '',
      buttons: [{ label: '< Back', goTo: 'cat3-graphs', color: C.btnBack }],
    },

    'cat3-meter-tests': {
      title: 'Cat.3 - Meter',
      body:  '',
      buttons: [{ label: '< Back', goTo: 'cat3-graphs', color: C.btnBack }],
    },

    // ── Cat. 4 ───────────────────────────────────────────────────────────────
    'cat4-tests': {
      title: 'Cat.4 - Temporal',
      body:  'Read the trend and report\nwhether anomalies are present.\nCharts: bars + heatmap.',
      buttons: [
        {
          label: 'Start test',
          goTo: 'selected',
          color: C.btnConfirm,
          action: () => selectTest('intra', CAT4_ALL, 'test-temporal'),
        },
        { label: '< Back', goTo: 'intra-class', color: C.btnBack },
      ],
    },

    // ── Confirmation ─────────────────────────────────────────────────────────────
    'selected': {
      title: 'Test configured',
      body:  'Configuration applied.\nClick the board to\nchange scenario.',
      buttons: [
        { label: 'Change test', goTo: 'start', color: C.btnBack },
      ],
    },
  }
}

// ---------------------------------------------------------------------------
// Dimensioni layout board
// ---------------------------------------------------------------------------

const BOARD = {
  width:      2.3,
  height:     2.7,
  depth:      0.06,
  headerH:    0.30,
  bodyH:      0.55,
  btnW:       1.90,
  btnH:       0.24,
  btnDepth:   0.05,
  btnGap:     0.06,
  paddingTop: 0.08,
  fontSize: {
    title: 2.0,
    body:  1.2,
    btn:   1.6,
    footer: 0.85,
  },
}

// ---------------------------------------------------------------------------
// Costruzione board
// ---------------------------------------------------------------------------

export function spawnTestSelectorBoard(
  position: { x: number; y: number; z: number },
  rotationY: number,
  selectTest: SelectTestFn
) {
  const screens = buildScreens(selectTest)

  let currentScreenId: ScreenId = 'start'
  let currentEntities: Entity[] = []

  // Root della board
  const boardRoot = engine.addEntity()
  Transform.create(boardRoot, {
    position: Vector3.create(position.x, position.y, position.z),
    rotation: Quaternion.fromEulerDegrees(0, rotationY, 0),
  })

  // Pannello di sfondo fisso
  const panel = engine.addEntity()
  Transform.create(panel, {
    parent: boardRoot,
    position: Vector3.create(0, 0, 0),
    scale: Vector3.create(BOARD.width, BOARD.height, BOARD.depth),
  })
  MeshRenderer.setBox(panel)
  Material.setBasicMaterial(panel, { diffuseColor: C.panelBg })

  // Header fisso
  const headerZ = BOARD.depth / 2 + 0.002
  const headerBg = engine.addEntity()
  Transform.create(headerBg, {
    parent: boardRoot,
    position: Vector3.create(0, BOARD.height / 2 - BOARD.headerH / 2, headerZ),
    scale: Vector3.create(BOARD.width, BOARD.headerH, 0.01),
  })
  MeshRenderer.setBox(headerBg)
  Material.setBasicMaterial(headerBg, { diffuseColor: C.headerBg })

  // Linea divisoria
  const divider = engine.addEntity()
  Transform.create(divider, {
    parent: boardRoot,
    position: Vector3.create(0, BOARD.height / 2 - BOARD.headerH - 0.005, headerZ),
    scale: Vector3.create(BOARD.width, 0.008, 0.01),
  })
  MeshRenderer.setBox(divider)
  Material.setBasicMaterial(divider, { diffuseColor: C.divider })

  // ---------------------------------------------------------------------------
  // Render schermo
  // ---------------------------------------------------------------------------

  function renderScreen(id: ScreenId) {
    currentScreenId = id

    for (const e of currentEntities) engine.removeEntity(e)
    currentEntities = []

    const screen = screens[id]
    const z = BOARD.depth / 2 + 0.003
    const rot180 = Quaternion.fromEulerDegrees(0, 180, 0)

    // Titolo
    const titleE = engine.addEntity()
    Transform.create(titleE, {
      parent: boardRoot,
      position: Vector3.create(0, BOARD.height / 2 - BOARD.headerH / 2, z),
      rotation: rot180,
    })
    TextShape.create(titleE, {
      text: localizeText(screen.title),
      fontSize: BOARD.fontSize.title,
      textColor: C.textLight,
    })
    currentEntities.push(titleE)

    // Body
    if (screen.body) {
      const bodyE = engine.addEntity()
      Transform.create(bodyE, {
        parent: boardRoot,
        position: Vector3.create(
          0,
          BOARD.height / 2 - BOARD.headerH - BOARD.bodyH / 2 - 0.04,
          z
        ),
        rotation: rot180,
      })
      TextShape.create(bodyE, {
        text: localizeText(screen.body),
        fontSize: BOARD.fontSize.body,
        textColor: C.textLight,
      })
      currentEntities.push(bodyE)
    }


    // Footer note
    const footerE = engine.addEntity()
    Transform.create(footerE, {
      parent: boardRoot,
      position: Vector3.create(0, -BOARD.height / 2 + 0.13, z),
      rotation: rot180,
    })
    TextShape.create(footerE, {
      text: localizeText('Repeating a test overwrites the previous result.'),
      fontSize: BOARD.fontSize.footer,
      textColor: C.pendingNote,
    })
    currentEntities.push(footerE)

    // Bottoni
    const btnAreaTop =
      BOARD.height / 2 - BOARD.headerH - BOARD.bodyH - BOARD.paddingTop

    screen.buttons.forEach((btn, i) => {
      const btnCenterY = btnAreaTop - BOARD.btnH / 2 - i * (BOARD.btnH + BOARD.btnGap)
      const color = btn.color ?? C.btnIdle
      const localizedButtonLabel = localizeText(btn.label)

      const btnMesh = engine.addEntity()
      Transform.create(btnMesh, {
        parent: boardRoot,
        position: Vector3.create(0, btnCenterY, z + BOARD.btnDepth / 2),
        scale: Vector3.create(BOARD.btnW, BOARD.btnH, BOARD.btnDepth),
      })
      MeshRenderer.setBox(btnMesh)
      Material.setBasicMaterial(btnMesh, { diffuseColor: color })
      currentEntities.push(btnMesh)

      MeshCollider.setBox(btnMesh, ColliderLayer.CL_POINTER)
      pointerEventsSystem.onPointerDown(
        btnMesh,
        () => {
          console.log(`[BOARD] click: "${btn.label}"`)
          if (btn.action) btn.action()
          if (btn.goTo)   renderScreen(btn.goTo)
        },
        {
          button: InputAction.IA_POINTER,
          hoverText: localizedButtonLabel,
          showFeedback: true,
        }
      )

      const btnLabel = engine.addEntity()
      Transform.create(btnLabel, {
        parent: boardRoot,
        position: Vector3.create(0, btnCenterY, z + BOARD.btnDepth + 0.003),
        rotation: rot180,
      })
      TextShape.create(btnLabel, {
        text: localizedButtonLabel,
        fontSize: BOARD.fontSize.btn,
        textColor: C.textLight,
      })
      currentEntities.push(btnLabel)
    })
  }

  renderScreen('start')
  onLanguageChange(() => renderScreen(currentScreenId))
  return boardRoot
}
