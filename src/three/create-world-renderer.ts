import * as THREE from 'three'
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
}

export interface WorldRendererOptions {
  createRenderer?: (canvas: HTMLCanvasElement) => MinimalRenderer
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
}

export const DISTRICT_LABELS = ['ECS', 'CONTAINER', 'SPRING', 'MYBATIS', 'JDBC', 'AURORA'] as const
export type DistrictLabel = (typeof DISTRICT_LABELS)[number]

const statusColor = (state: SimulationState): number => {
  if (state.applicationResult === 'ABNORMAL') return 0xef4444
  if (state.applicationResult === 'WARNING') return 0xf59e0b
  if (state.applicationResult === 'NORMAL') return 0x22c55e
  if (state.applicationResult === 'PLATFORM_FAILURE') return 0xa855f7
  return 0x38bdf8
}

const DEFAULT_CAMERA_POSITION = new THREE.Vector3(14, 14, 30)
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 1.5, 0)

function createLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (context) {
    context.fillStyle = 'rgba(4, 10, 18, 0.72)'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.strokeStyle = 'rgba(56, 189, 248, 0.45)'
    context.lineWidth = 2
    context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2)
    context.font = 'bold 30px ui-monospace, monospace'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = '#bae6fd'
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 1)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(3.4, 0.85, 1)
  return sprite
}

interface District {
  label: DistrictLabel
  group: THREE.Group
  materials: THREE.MeshStandardMaterial[]
  center: THREE.Vector3
  topY: number
}

// 各地区を意味の分かる建築(複合プリミティブ)として組み立てる。
function buildDistrict(label: DistrictLabel, index: number, baseMaterial: THREE.MeshStandardMaterial): District {
  const group = new THREE.Group()
  const materials: THREE.MeshStandardMaterial[] = []
  const add = (geometry: THREE.BufferGeometry, y: number, x = 0, z = 0, rotation?: THREE.Euler): void => {
    const material = baseMaterial.clone()
    materials.push(material)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    if (rotation) mesh.rotation.copy(rotation)
    mesh.userData.district = label
    group.add(mesh)
  }

  let topY = 0
  switch (label) {
    case 'ECS':
      // control plane tower + アンテナ皿
      add(new THREE.BoxGeometry(1.9, 4.4, 1.9), 2.2)
      add(new THREE.ConeGeometry(1.1, 0.8, 4, 1, true), 4.8)
      topY = 5.2
      break
    case 'CONTAINER':
      // 積み上げたコンテナ
      add(new THREE.BoxGeometry(3.2, 1.5, 3.0), 0.75)
      add(new THREE.BoxGeometry(2.4, 1.3, 2.2), 2.15, 0.25, -0.15)
      topY = 2.8
      break
    case 'SPRING':
      // ApplicationContextのチェンバー
      add(new THREE.CylinderGeometry(1.65, 1.65, 2.9, 20), 1.45)
      add(new THREE.CylinderGeometry(0.9, 0.9, 0.6, 20), 3.2)
      topY = 3.5
      break
    case 'MYBATIS':
      // SQL mapping station + JDBCへ伸びるパイプ
      add(new THREE.BoxGeometry(3.1, 2.0, 2.5), 1.0)
      add(new THREE.CylinderGeometry(0.28, 0.28, 3.4, 12), 1.1, 2.1, 0, new THREE.Euler(0, 0, Math.PI / 2))
      topY = 2.0
      break
    case 'JDBC':
      // Wrapperのrouting ring
      add(new THREE.BoxGeometry(2.2, 1.1, 2.2), 0.55)
      add(new THREE.TorusGeometry(1.15, 0.3, 12, 32), 2.35, 0, 0, new THREE.Euler(Math.PI / 2.6, 0, 0))
      topY = 3.4
      break
    case 'AURORA':
      // storageドラム
      add(new THREE.CylinderGeometry(1.75, 1.75, 2.7, 24), 1.35)
      add(new THREE.CylinderGeometry(1.9, 1.9, 0.35, 24), 2.95)
      topY = 3.3
      break
  }

  group.position.set((index - 2.5) * 4.3, 0, Math.sin(index * 1.2) * 1.8)
  return {
    label,
    group,
    materials,
    center: new THREE.Vector3(group.position.x, 1.6, group.position.z),
    topY,
  }
}

export function createWorldRenderer(canvas: HTMLCanvasElement, options: WorldRendererOptions = {}): WorldRenderer {
  const createRenderer = options.createRenderer
    ?? ((target: HTMLCanvasElement): MinimalRenderer => new THREE.WebGLRenderer({ canvas: target, antialias: true, alpha: true }))
  const requestFrame = options.requestFrame ?? ((callback: FrameRequestCallback) => requestAnimationFrame(callback))
  const cancelFrame = options.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle))

  const renderer = createRenderer(canvas)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x07111f, 0.022)
  const camera = new THREE.PerspectiveCamera(42, canvas.clientWidth / Math.max(canvas.clientHeight, 1), 0.1, 200)
  camera.position.copy(DEFAULT_CAMERA_POSITION)
  const cameraGoal = DEFAULT_CAMERA_POSITION.clone()
  const targetGoal = DEFAULT_CAMERA_TARGET.clone()
  const currentTarget = DEFAULT_CAMERA_TARGET.clone()
  camera.lookAt(currentTarget)

  scene.add(new THREE.HemisphereLight(0x9edaff, 0x07111f, 2.2))
  const key = new THREE.DirectionalLight(0xffffff, 3)
  key.position.set(8, 16, 10)
  scene.add(key)

  const grid = new THREE.GridHelper(38, 38, 0x244968, 0x13283d)
  scene.add(grid)

  const group = new THREE.Group()
  scene.add(group)

  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x15324a, roughness: 0.55, metalness: 0.25 })
  const districts: District[] = DISTRICT_LABELS.map((label, index) => {
    const district = buildDistrict(label, index, baseMaterial)
    group.add(district.group)
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 16, 10),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
    )
    beacon.position.set(district.group.position.x, district.topY + 0.45, district.group.position.z)
    group.add(beacon)
    const sprite = createLabelSprite(label)
    sprite.position.set(district.group.position.x, district.topY + 1.3, district.group.position.z)
    group.add(sprite)
    return district
  })

  const flowMaterial = new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
  const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 10), flowMaterial)
  pulse.visible = false
  group.add(pulse)

  const raycaster = new THREE.Raycaster()

  let latest: SimulationState | null = null
  let reducedMotion = false
  let selected: string | null = null
  let frame = 0
  const clock = new THREE.Clock()

  const resize = (): void => {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (canvas.width === Math.floor(width * renderer.getPixelRatio()) && canvas.height === Math.floor(height * renderer.getPixelRatio())) return
    renderer.setSize(width, height, false)
    camera.aspect = width / Math.max(height, 1)
    camera.updateProjectionMatrix()
  }

  const render = (): void => {
    frame = requestFrame(render)
    resize()
    const elapsed = clock.getElapsedTime()
    // 揺れとpulse移動は装飾なのでreduced motionでは止める。状態由来の
    // 色・emissive切替、camera focus、simulation進行はそのまま。
    group.rotation.y = reducedMotion ? 0 : Math.sin(elapsed * 0.12) * 0.04
    const ease = reducedMotion ? 1 : 0.08
    camera.position.lerp(cameraGoal, ease)
    currentTarget.lerp(targetGoal, ease)
    camera.lookAt(currentTarget)
    if (latest) {
      const color = statusColor(latest)
      flowMaterial.color.setHex(color)
      const activeIndex = Math.min(districts.length - 1, Math.max(0,
        latest.phase === 'PROVISION_ENI' || latest.phase === 'WAIT_CAPACITY' || latest.phase === 'PULL_IMAGE' ? 0
          : latest.phase === 'START_JVM' ? 1
            : latest.phase === 'START_SPRING' || latest.phase === 'START_JOB' ? 2
              : latest.phase === 'RUN_TASKLET' || latest.phase === 'FLUSH_BATCH' ? 3
                : latest.phase === 'COMMIT' || latest.phase === 'ROLLBACK' ? 5
                  : 4,
      ))
      districts.forEach((district, index) => {
        const isActive = index === activeIndex
        const isSelected = district.label === selected
        district.materials.forEach((material) => {
          material.emissive.setHex(isActive ? color : isSelected ? 0x38bdf8 : 0x000000)
          material.emissiveIntensity = isActive ? 1.5 : isSelected ? 0.6 : 0
        })
      })
      const flow = flowForPhase(latest.phase, latest.executorType)
      const from = flow ? districts[flow.from]?.center : undefined
      const to = flow ? districts[flow.to]?.center : undefined
      if (!reducedMotion && from && to) {
        pulse.visible = true
        pulse.position.lerpVectors(from, to, latest.progress)
        pulse.position.y += 3
      } else {
        pulse.visible = false
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
        cameraGoal.set(found.center.x + 4.5, found.topY + 4.5, found.center.z + 9)
        targetGoal.copy(found.center)
      } else {
        cameraGoal.copy(DEFAULT_CAMERA_POSITION)
        targetGoal.copy(DEFAULT_CAMERA_TARGET)
      }
    },
    pickAt(ndcX, ndcY) {
      // renderer.render()を経由しない経路(テストや初回クリック)でも
      // 正しい行列でraycastできるよう明示的に更新する。
      camera.updateMatrixWorld()
      scene.updateMatrixWorld(true)
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
      const hits = raycaster.intersectObjects(districts.map((district) => district.group), true)
      const hit = hits.find((candidate) => typeof candidate.object.userData.district === 'string')
      return hit ? (hit.object.userData.district as string) : null
    },
    dispose() {
      cancelFrame(frame)
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
