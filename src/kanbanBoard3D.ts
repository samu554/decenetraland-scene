import { engine, Entity, Transform, MeshRenderer, MeshCollider, Material, TextShape} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'

// Tipi e dati iniziali

export type TaskStatus = 'backlog' | 'ongoing' | 'inprogress_done' | 'done'

export type Task = {
    title: string
    status: TaskStatus
}

// Serie di Task di esempio
const initialTasks: Task[] = [
    { title: 'Setup scene base', status: 'backlog' },
    { title: 'Import assets 3D', status: 'backlog' },
    { title: 'UI comfort logger', status: 'ongoing' },
    { title: '3D burndown chart', status: 'inprogress_done' },
    { title: 'Server data fetch', status: 'done' },
    { title: 'Refactor utils', status: 'done' }
]

// Helpers grafici

function createStickyNote(parent: Entity, text: string, position: Vector3) {
    // caratteristiche spaziali
    const note = engine.addEntity()
    Transform.create(note, {
        parent,
        position,
        rotation: Quaternion.Identity(),
        scale: Vector3.create(0.5, 0.5, 0.5)
    })

    // parte fisica (quadrato giallo)
    MeshRenderer.setPlane(note)
    MeshCollider.setPlane(note)
    Material.setPbrMaterial(note, {
        albedoColor: Color4.create(1, 0.95, 0.6, 1),
        roughness: 1,
        metallic: 0
    })

    // scritta
    const textEntity = engine.addEntity()
    Transform.create(textEntity, {
        parent: note,
        position: Vector3.create(0, 0, -0.01),
        scale: Vector3.create(0.5, 0.5, 0.5)
    })

    TextShape.create(textEntity, {
        text,
        fontSize: 2,
        textColor: Color4.Black(),
        outlineWidth: 0.05,
        outlineColor: Color4.Black()
    })

    return note
}

// Colonna singola standard (Backlog / Done)
function createSimpleColumn(
    parent: Entity,
    title: string,
    localPos: Vector3,
    color: Color4
) {
    // contenitore colonna
    const colRoot = engine.addEntity()
    Transform.create(colRoot, {
        parent,
        position: localPos,
        rotation: Quaternion.Identity(),
        scale: Vector3.One()
    })

    // pannello della colonna
    const panel = engine.addEntity()
    Transform.create(panel, {
        parent: colRoot,
        position: Vector3.create(0, 1, 0),
        scale: Vector3.create(1.2, 2, 0.05)
    })
    MeshRenderer.setBox(panel)
    MeshCollider.setBox(panel)
    Material.setPbrMaterial(panel, {
        albedoColor: color,
        roughness: 1,
        metallic: 0
    })

    // titolo colonna
    const headerText = engine.addEntity()
    Transform.create(headerText, {
        parent: colRoot,
        position: Vector3.create(0, 2.4, -0.06),
        scale: Vector3.create(0.5, 0.5, 0.5)
    })
    TextShape.create(headerText, {
        text: title,
        fontSize: 4,
        textColor: Color4.White(),
        outlineWidth: 0.05,
        outlineColor: Color4.Black(),
    })

    return colRoot
}

function createInProgressColumn(
    parent: Entity,
    localPos: Vector3
) {
    const inProgRoot = engine.addEntity()
    Transform.create(inProgRoot, {
        parent,
        position: localPos,
        rotation: Quaternion.Identity(),
        scale: Vector3.One()
    })

    // titolo globale "In Progress"
    const bigTitle = engine.addEntity()
    Transform.create(bigTitle, {
        parent: inProgRoot,
        position: Vector3.create(0, 2.4, -0.06),
        scale: Vector3.create(0.5, 0.5, 0.5)
    })
    TextShape.create(bigTitle, {
        text: 'In Progress',
        fontSize: 4,
        textColor: Color4.White(),
        outlineWidth: 0.05,
        outlineColor: Color4.Black()
    })

    // pannello grande dietro le due sotto-colonne
    const bgPanel = engine.addEntity()
    Transform.create(bgPanel, {
        parent: inProgRoot,
        position: Vector3.create(0, 1, 0),
        scale: Vector3.create(2.4, 2, 0.05)
    })
    MeshRenderer.setBox(bgPanel)
    MeshCollider.setBox(bgPanel)
    Material.setPbrMaterial(bgPanel, {
        albedoColor: Color4.fromHexString('#3DDC84'),
        roughness: 1,
        metallic: 0
    })

    // linea verticale separatrice tra ongoing e done (mezza trasparenza chiara)
    const divider = engine.addEntity()
    Transform.create(divider, {
        parent: inProgRoot,
        position: Vector3.create(0, 1, -0.06),
        scale: Vector3.create(0.02, 1.8, 0.01)
    })
    MeshRenderer.setBox(divider)
    Material.setPbrMaterial(divider, {
        albedoColor: Color4.fromHexString('#FF9F1C'),
        roughness: 1,
        metallic: 0
    })

    // sotto-colonna ONGOING
    const ongoingRoot = engine.addEntity()
    Transform.create(ongoingRoot, {
        parent: inProgRoot,
        position: Vector3.create(-0.6, 1, 0.06),
        rotation: Quaternion.Identity(),
        scale: Vector3.One()
    })

    // titolo "Ongoing"
    const ongoingTitle = engine.addEntity()
    Transform.create(ongoingTitle, {
        parent: ongoingRoot,
        position: Vector3.create(0, 1.1, -0.06),
        scale: Vector3.create(0.4, 0.4, 0.4)
    })
    TextShape.create(ongoingTitle, {
        text: 'Ongoing',
        fontSize: 3,
        textColor: Color4.White(),
        outlineWidth: 0.05,
        outlineColor: Color4.Black()
    })

    // sotto-colonna DONE (cioè inprogress_done)
    const inProgDoneRoot = engine.addEntity()
    Transform.create(inProgDoneRoot, {
        parent: inProgRoot,
        position: Vector3.create(0.6, 1, 0.06),
        rotation: Quaternion.Identity(),
        scale: Vector3.One()
    })

    // titolo "Done"
    const inProgDoneTitle = engine.addEntity()
    Transform.create(inProgDoneTitle, {
        parent: inProgDoneRoot,
        position: Vector3.create(0, 1.1, -0.06),
        scale: Vector3.create(0.4, 0.4, 0.4)
    })
    TextShape.create(inProgDoneTitle, {
        text: 'Done',
        fontSize: 3,
        textColor: Color4.White(),
        outlineWidth: 0.05,
        outlineColor: Color4.Black()
    })

    // ritorniamo i due contenitori separati (ongoing / inprogress_done)
    return {
        root: inProgRoot,
        ongoingRoot,
        inProgDoneRoot
    }
}

// Board principale

export function spawnKanbanBoard(
    basePosition: Vector3,
    tasks: Task[] = initialTasks,
    rotationYDeg: number = 0
) {
    // root generale della board
    const boardRoot = engine.addEntity()
    Transform.create(boardRoot, {
        position: basePosition,
        rotation: Quaternion.fromEulerDegrees(0, rotationYDeg, 0),
        scale: Vector3.create(0.7, 0.7, 0.7)
    })

    // sfondo nero grande dietro tutto
    const boardBg = engine.addEntity()
    Transform.create(boardBg, {
        parent: boardRoot,
        position: Vector3.create(0, 1.5, 0.1),
        scale: Vector3.create(6, 3.2, 0.05)
    })
    MeshRenderer.setBox(boardBg)
    MeshCollider.setBox(boardBg)
    Material.setPbrMaterial(boardBg, {
        albedoColor: Color4.create(0.1, 0.1, 0.1, 1),
        roughness: 1,
        metallic: 0
    })

    // si creano le colonne

    const backlogCol = createSimpleColumn(
        boardRoot,
        'Backlog',
        Vector3.create(-2, 0.5, 0.06),
        Color4.fromHexString('#2E6BFF')
    )

    const { ongoingRoot, inProgDoneRoot } = createInProgressColumn(
        boardRoot,
        Vector3.create(0, 0.5, 0.06)
    )

    const doneCol = createSimpleColumn(
        boardRoot,
        'Done',
        Vector3.create(2, 0.5, 0.06),
        Color4.fromHexString('#ca5de5ff')
    )

    // si posizionano i post-it

    const columnHeights: Record<TaskStatus, number> = {
        backlog: 1.6,          // dentro Backlog
        ongoing: 0.6,          // parte sinistra di In Progress
        inprogress_done: 0.6,  // parte destra di In Progress
        done: 1.6              // colonna Done finale
    }

    const columnEntities: Record<TaskStatus, Entity> = {
        backlog: backlogCol,
        ongoing: ongoingRoot,
        inprogress_done: inProgDoneRoot,
        done: doneCol
    }

    const verticalStep = 0.52 // distanza tra le varie note

    for (const task of tasks) {
        const targetParent = columnEntities[task.status]
        const y = columnHeights[task.status]

        createStickyNote(
        targetParent,
        task.title,
        Vector3.create(0, y, -0.1)
        )

        columnHeights[task.status] = y - verticalStep
    }

    return boardRoot
}
