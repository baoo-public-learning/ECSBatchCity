import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { SimulationState } from '../sim/types'
import { flowForPhase } from './flows'

interface WorldRenderer {
  update(snapshot: SimulationState): void
  setReducedMotion(value: boolean): void
  setSelected(district: string | null): void
  focusDistrict(district: string | null): void
  pickAt(ndcX: number, ndcY: number): string | null
  dispose(): void
}

// WebGLコンテキストを持たないテスト環境でも組み立て・picking・disposeを
// 検証できるよう、WebGLRendererとframe loopは注入可能にする。
export interface MinimalRenderer {
  setPixelRatio(value: number): void
  setSize(width: number, height: number, updateStyle?: boolean): void
  getPixelRatio(): number
  render(scene: THREE.Scene, camera: THREE.Camera): void
  dispose(): void
  outputColorSpace: string
  domElement?: HTMLElement
}

export interface WorldRendererOptions {
  createRenderer?: (canvas: HTMLCanvasElement) => MinimalRenderer
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
  enableControls?: boolean
}

export const DISTRICT_LABELS = ['ECS', 'CONTAINER', 'SPRING', 'MYBATIS', 'JDBC', 'AURORA'] as const
export type DistrictLabel = (typeof DISTRICT_LABELS)[number]

// 色は意味で固定する: SQL=空色、flush(未確定)=琥珀、commit=緑、rollback/失敗=赤、platform=紫。
const SEMANTIC = {
  sky: 0x0284c7,
  amber: 0xd97706,
  green: 0x16a34a,
  red: 0xdc2626,
  purple: 0x9333ea,
} as const

const ZONE_COLORS: Record<DistrictLabel, number> = {
  ECS: 0x2563eb,
  CONTAINER: 0x475569,
  SPRING: 0x16a34a,
  MYBATIS: 0xd97706,
  JDBC: 0x0891b2,
  AURORA: 0x7c3aed,
}

const statusColor = (state: SimulationState): number => {
  if (state.applicationResult === 'ABNORMAL') return SEMANTIC.red
  if (state.applicationResult === 'WARNING') return SEMANTIC.amber
  if (state.applicationResult === 'NORMAL') return SEMANTIC.green
  if (state.applicationResult === 'PLATFORM_FAILURE') return SEMANTIC.purple
  return SEMANTIC.sky
}

const flowColorForPhase = (state: SimulationState): number => {
  switch (state.phase) {
    case 'FLUSH_BATCH': return SEMANTIC.amber
    case 'COMMIT': return SEMANTIC.green
    case 'ROLLBACK': return SEMANTIC.red
    case 'FAILOVER_DETECT':
    case 'TOPOLOGY_REFRESH':
    case 'RECONNECT':
    case 'FORCE_KILL': return SEMANTIC.red
    case 'CLOSE_SPRING':
    case 'STOP_CONTAINER':
    case 'RELEASE_ENI': return statusColor(state)
    default: return SEMANTIC.sky
  }
}

const CAMERA_FOV_DEG = 46
const CITY_HALF_WIDTH = 15
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 0.5, 0)

function defaultCameraPositionForAspect(aspect: number): THREE.Vector3 {
  // 左右のHUDパネルに隠れないよう、街全体が中央帯に収まる距離まで引く。
  const halfFovTan = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV_DEG / 2)) * Math.max(aspect, 0.3)
  const distance = Math.max(34, (CITY_HALF_WIDTH * 2.45) / halfFovTan)
  return new THREE.Vector3(0, distance * 0.72, distance * 0.82)
}

function createLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (context) {
    context.fillStyle = 'rgba(255, 255, 255, 0.88)'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.strokeStyle = 'rgba(15, 42, 63, 0.55)'
    context.lineWidth = 3
    context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2)
    context.font = 'bold 30px ui-monospace, monospace'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = '#0f2a3f'
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 1)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(3, 0.75, 1)
  sprite.renderOrder = 10
  return sprite
}

interface District {
  label: DistrictLabel
  group: THREE.Group
  materials: THREE.MeshStandardMaterial[]
  center: THREE.Vector3
  topY: number
}

const DISTRICT_SPACING = 5.2
const districtX = (index: number): number => (index - 2.5) * DISTRICT_SPACING
const districtZ = (index: number): number => (index % 2 === 0 ? -1.1 : 1.1)

function buildDistrict(label: DistrictLabel, index: number): District {
  const group = new THREE.Group()
  const materials: THREE.MeshStandardMaterial[] = []
  const bodyColor = 0x51606e
  const make = (color: number): THREE.MeshStandardMaterial => {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.12 })
    materials.push(material)
    return material
  }
  const add = (geometry: THREE.BufferGeometry, y: number, x = 0, z = 0, rotation?: THREE.Euler, color = bodyColor): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, make(color))
    mesh.position.set(x, y, z)
    if (rotation) mesh.rotation.copy(rotation)
    mesh.userData.district = label
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    return mesh
  }

  // 地区ゾーンプレート(意味色)
  const zone = new THREE.Mesh(
    new THREE.BoxGeometry(4.6, 0.12, 4.6),
    new THREE.MeshStandardMaterial({ color: ZONE_COLORS[label], roughness: 0.9, transparent: true, opacity: 0.42 }),
  )
  zone.position.y = 0.06
  zone.userData.district = label
  zone.receiveShadow = true
  materials.push(zone.material as THREE.MeshStandardMaterial)
  group.add(zone)

  let topY = 0
  switch (label) {
    case 'ECS':
      add(new THREE.BoxGeometry(1.3, 3.6, 1.3), 1.9)
      add(new THREE.ConeGeometry(0.75, 0.6, 4, 1, true), 4.0)
      add(new THREE.BoxGeometry(0.9, 0.5, 0.9), 0.35, -1.5, 1.2)
      add(new THREE.BoxGeometry(0.9, 0.5, 0.9), 0.35, -1.5, -0.1)
      add(new THREE.BoxGeometry(0.9, 0.5, 0.9), 0.35, -1.5, -1.4)
      topY = 4.3
      break
    case 'CONTAINER': {
      const tones = [0x5f7080, 0x54626f, 0x6a7a89]
      for (let stack = 0; stack < 3; stack++) {
        const count = 3 - (stack % 2)
        for (let level = 0; level < count; level++) {
          add(new THREE.BoxGeometry(1.5, 0.62, 0.95), 0.31 + level * 0.66, -1.2 + stack * 1.35, (stack % 2) * 0.9 - 0.4, undefined, tones[(stack + level) % 3])
        }
      }
      add(new THREE.BoxGeometry(0.16, 2.9, 0.16), 1.45, 1.7, -1.4)
      add(new THREE.BoxGeometry(2.4, 0.14, 0.14), 2.85, 0.7, -1.4)
      topY = 3.0
      break
    }
    case 'SPRING':
      add(new THREE.CylinderGeometry(1.25, 1.25, 2.5, 20), 1.25)
      add(new THREE.CylinderGeometry(0.7, 0.7, 0.5, 20), 2.75)
      add(new THREE.BoxGeometry(2.6, 0.5, 1.0), 0.3, 0.2, 1.6)
      add(new THREE.BoxGeometry(0.5, 0.9, 0.5), 0.45, -1.6, -1.2)
      topY = 3.1
      break
    case 'MYBATIS':
      add(new THREE.BoxGeometry(2.4, 1.6, 1.9), 0.85)
      add(new THREE.CylinderGeometry(0.2, 0.2, 2.6, 10), 0.95, 1.9, 0, new THREE.Euler(0, 0, Math.PI / 2))
      topY = 1.8
      break
    case 'JDBC':
      add(new THREE.BoxGeometry(1.7, 0.9, 1.7), 0.5)
      add(new THREE.TorusGeometry(0.95, 0.22, 12, 32), 1.95, 0, 0, new THREE.Euler(Math.PI / 2.4, 0, 0))
      for (let pillar = 0; pillar < 4; pillar++) {
        add(new THREE.BoxGeometry(0.3, 1.1, 0.3), 0.55, -1.7 + pillar * 0.55, 1.5)
      }
      topY = 2.7
      break
    case 'AURORA':
      add(new THREE.CylinderGeometry(1.25, 1.25, 2.0, 22), 1.05)
      add(new THREE.CylinderGeometry(1.35, 1.35, 0.3, 22), 2.3)
      add(new THREE.CylinderGeometry(0.85, 0.85, 1.3, 18), 0.7, 2.0, -1.1)
      for (let disk = 0; disk < 3; disk++) {
        add(new THREE.CylinderGeometry(0.62, 0.62, 0.22, 14), 0.16 + disk * 0.3, -1.9, 1.3)
      }
      topY = 2.6
      break
  }

  group.position.set(districtX(index), 0, districtZ(index))
  return {
    label,
    group,
    materials,
    center: new THREE.Vector3(districtX(index), 1.2, districtZ(index)),
    topY,
  }
}

export function createWorldRenderer(canvas: HTMLCanvasElement, options: WorldRendererOptions = {}): WorldRenderer {
  const createRenderer = options.createRenderer
    ?? ((target: HTMLCanvasElement): MinimalRenderer => {
      const webgl = new THREE.WebGLRenderer({ canvas: target, antialias: true, alpha: false })
      webgl.shadowMap.enabled = true
      webgl.shadowMap.type = THREE.PCFSoftShadowMap
      return webgl
    })
  const requestFrame = options.requestFrame ?? ((callback: FrameRequestCallback) => requestAnimationFrame(callback))
  const cancelFrame = options.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle))

  const renderer = createRenderer(canvas)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xbdd2e2)
  const fog = new THREE.Fog(0xbdd2e2, 40, 130)
  scene.fog = fog

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, canvas.clientWidth / Math.max(canvas.clientHeight, 1), 0.1, 300)
  let focusedDistrict: string | null = null
  const defaultPosition = defaultCameraPositionForAspect(camera.aspect)
  camera.position.copy(defaultPosition)
  const cameraGoal = defaultPosition.clone()
  const targetGoal = DEFAULT_CAMERA_TARGET.clone()
  const currentTarget = DEFAULT_CAMERA_TARGET.clone()
  camera.lookAt(currentTarget)

  scene.add(new THREE.HemisphereLight(0xdbeafe, 0x8a99a5, 1.6))
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.4)
  sun.position.set(18, 30, 14)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -22
  sun.shadow.camera.right = 22
  sun.shadow.camera.top = 22
  sun.shadow.camera.bottom = -22
  scene.add(sun)

  // 街のプレートとグリッド
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(24, 25, 1.2, 64),
    new THREE.MeshStandardMaterial({ color: 0x9fb2bf, roughness: 0.95 }),
  )
  plate.position.y = -0.62
  plate.receiveShadow = true
  scene.add(plate)
  const grid = new THREE.GridHelper(46, 46, 0x7d93a3, 0x8fa4b3)
  ;(grid.material as THREE.Material).transparent = true
  ;(grid.material as THREE.Material).opacity = 0.35
  grid.position.y = 0.005
  scene.add(grid)

  const group = new THREE.Group()
  scene.add(group)

  const districts: District[] = DISTRICT_LABELS.map((label, index) => {
    const district = buildDistrict(label, index)
    group.add(district.group)
    const sprite = createLabelSprite(label)
    sprite.position.set(district.center.x, district.topY + 1.15, district.center.z)
    group.add(sprite)
    return district
  })

  // 道路: 隣接地区を結ぶ帯
  const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x54626d, roughness: 0.92 })
  for (let index = 0; index < districts.length - 1; index++) {
    const from = districts[index].center
    const to = districts[index + 1].center
    const length = Math.hypot(to.x - from.x, to.z - from.z)
    const road = new THREE.Mesh(new THREE.BoxGeometry(length, 0.06, 0.9), roadMaterial)
    road.position.set((from.x + to.x) / 2, 0.03, (from.z + to.z) / 2)
    road.rotation.y = -Math.atan2(to.z - from.z, to.x - from.x)
    road.receiveShadow = true
    scene.add(road)
  }

  // pending batchの箱の山(MYBATIS)とflush済みの山(AURORA)
  const crateGeometry = new THREE.BoxGeometry(0.34, 0.34, 0.34)
  const makeCrates = (district: District, color: number, offsetX: number, offsetZ: number): THREE.Mesh[] =>
    Array.from({ length: 10 }, (_, index) => {
      const crate = new THREE.Mesh(crateGeometry, new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0.25 }))
      crate.position.set(
        district.center.x + offsetX + (index % 5) * 0.42,
        0.29 + Math.floor(index / 5) * 0.4,
        district.center.z + offsetZ,
      )
      crate.castShadow = true
      crate.visible = false
      scene.add(crate)
      return crate
    })
  const pendingCrates = makeCrates(districts[3], SEMANTIC.amber, -1.15, 1.55)
  const flushedCrates = makeCrates(districts[5], SEMANTIC.sky, -1.0, -1.9)

  // トラフィック粒子(フローに沿って複数流れる)
  const TRAFFIC_COUNT = 7
  const trafficMaterial = new THREE.MeshBasicMaterial({ color: SEMANTIC.sky })
  const traffic: THREE.Mesh[] = Array.from({ length: TRAFFIC_COUNT }, () => {
    const particle = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), trafficMaterial)
    particle.visible = false
    scene.add(particle)
    return particle
  })
  const flowCurveFrom = new THREE.Vector3()
  const flowCurveMid = new THREE.Vector3()
  const flowCurveTo = new THREE.Vector3()

  let latest: SimulationState | null = null
  let reducedMotion = false
  let selected: string | null = null
  let frame = 0
  const clock = new THREE.Clock()
  const raycaster = new THREE.Raycaster()

  const controls = options.enableControls === false || !renderer.domElement
    ? null
    : new OrbitControls(camera, canvas)
  if (controls) {
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.49
    controls.minDistance = 8
    controls.maxDistance = 90
    controls.target.copy(currentTarget)
  }

  const resize = (): void => {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (canvas.width === Math.floor(width * renderer.getPixelRatio()) && canvas.height === Math.floor(height * renderer.getPixelRatio())) return
    renderer.setSize(width, height, false)
    camera.aspect = width / Math.max(height, 1)
    camera.updateProjectionMatrix()
    defaultPosition.copy(defaultCameraPositionForAspect(camera.aspect))
    if (!focusedDistrict && !controls) cameraGoal.copy(defaultPosition)
  }

  const render = (): void => {
    frame = requestFrame(render)
    resize()
    const elapsed = clock.getElapsedTime()
    if (controls) {
      controls.update()
    } else {
      const ease = reducedMotion ? 1 : 0.08
      camera.position.lerp(cameraGoal, ease)
      currentTarget.lerp(targetGoal, ease)
      camera.lookAt(currentTarget)
    }
    if (latest) {
      const color = statusColor(latest)
      const activeIndex = latest.phase === 'IDLE' || latest.phase === 'DONE' ? -1
        : Math.min(districts.length - 1, Math.max(0,
          latest.phase === 'PROVISION_ENI' || latest.phase === 'WAIT_CAPACITY' || latest.phase === 'PULL_IMAGE' ? 0
            : latest.phase === 'START_JVM' ? 1
              : latest.phase === 'START_SPRING' || latest.phase === 'START_JOB' ? 2
                : latest.phase === 'RUN_TASKLET' || latest.phase === 'FLUSH_BATCH' ? 3
                  : latest.phase === 'COMMIT' || latest.phase === 'ROLLBACK' ? 5
                    : 4,
        ))
      const activityPulse = reducedMotion ? 0.9 : 0.75 + Math.sin(elapsed * 5) * 0.35
      districts.forEach((district, index) => {
        const isActive = index === activeIndex
        const isSelected = district.label === selected
        district.materials.forEach((material) => {
          material.emissive.setHex(isActive ? color : isSelected ? SEMANTIC.sky : 0x000000)
          material.emissiveIntensity = isActive ? activityPulse : isSelected ? 0.45 : 0
        })
      })

      // データ駆動ディテール
      const pendingVisible = Math.min(10, latest.pendingStatements)
      pendingCrates.forEach((crate, index) => { crate.visible = index < pendingVisible })
      const flushedVisible = Math.min(10, Math.round((latest.flushedStatements / Math.max(latest.config.statementCount, 1)) * 10))
      flushedCrates.forEach((crate, index) => { crate.visible = index < flushedVisible })

      const flow = flowForPhase(latest.phase, latest.executorType)
      trafficMaterial.color.setHex(flowColorForPhase(latest))
      if (!reducedMotion && flow) {
        const from = districts[flow.from].center
        const to = districts[flow.to].center
        flowCurveFrom.set(from.x, from.y + 1.6, from.z)
        flowCurveTo.set(to.x, to.y + 1.6, to.z)
        flowCurveMid.copy(flowCurveFrom).add(flowCurveTo).multiplyScalar(0.5)
        flowCurveMid.y += flow.from === flow.to ? 1.4 : 2.4
        traffic.forEach((particle, index) => {
          const t = (latest!.progress + index / TRAFFIC_COUNT) % 1
          const inv = 1 - t
          particle.visible = true
          particle.position.set(
            inv * inv * flowCurveFrom.x + 2 * inv * t * flowCurveMid.x + t * t * flowCurveTo.x,
            inv * inv * flowCurveFrom.y + 2 * inv * t * flowCurveMid.y + t * t * flowCurveTo.y,
            inv * inv * flowCurveFrom.z + 2 * inv * t * flowCurveMid.z + t * t * flowCurveTo.z,
          )
          particle.scale.setScalar(0.7 + 0.5 * Math.sin(t * Math.PI))
        })
      } else {
        traffic.forEach((particle) => { particle.visible = false })
      }

      // failover: writer-2(AURORAの小ドラム)が点灯し、writer-1が沈む
      const aurora = districts[5]
      const writer1 = aurora.materials[1]
      const writer2 = aurora.materials[3]
      if (writer1 && writer2 && latest.failoverState !== 'NONE') {
        writer1.emissive.setHex(SEMANTIC.red)
        writer1.emissiveIntensity = 0.5
        if (latest.failoverState === 'RECONNECTED') {
          writer2.emissive.setHex(SEMANTIC.green)
          writer2.emissiveIntensity = 0.8
        }
      }
    }
    renderer.render(scene, camera)
  }
  render()

  return {
    update(snapshot) {
      latest = snapshot
    },
    setReducedMotion(value) {
      reducedMotion = value
    },
    setSelected(district) {
      selected = district
    },
    focusDistrict(district) {
      const found = districts.find((candidate) => candidate.label === district)
      if (found) {
        focusedDistrict = found.label
        cameraGoal.set(found.center.x + 3.5, found.topY + 4, found.center.z + 8)
        targetGoal.copy(found.center)
        if (controls) {
          controls.target.copy(found.center)
          camera.position.copy(cameraGoal)
        }
      } else {
        focusedDistrict = null
        cameraGoal.copy(defaultPosition)
        targetGoal.copy(DEFAULT_CAMERA_TARGET)
        if (controls) {
          controls.target.copy(DEFAULT_CAMERA_TARGET)
          camera.position.copy(defaultPosition)
        }
      }
    },
    pickAt(ndcX, ndcY) {
      camera.updateMatrixWorld()
      scene.updateMatrixWorld(true)
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
      const hits = raycaster.intersectObjects(districts.map((district) => district.group), true)
      const hit = hits.find((candidate) => typeof candidate.object.userData.district === 'string')
      return hit ? (hit.object.userData.district as string) : null
    },
    dispose() {
      cancelFrame(frame)
      controls?.dispose()
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach((material) => material.dispose())
          return
        }
        if (object instanceof THREE.Sprite) {
          // Spriteのgeometryはthree内部で共有されるためdisposeしない。
          object.material.map?.dispose()
          object.material.dispose()
        }
      })
      renderer.dispose()
    },
  }
}
