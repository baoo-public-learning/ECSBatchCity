import * as THREE from 'three'
import type { SimulationState } from '../sim/types'

interface WorldRenderer {
  update(snapshot: SimulationState): void
  dispose(): void
}

const statusColor = (state: SimulationState): number => {
  if (state.applicationResult === 'ABNORMAL') return 0xef4444
  if (state.applicationResult === 'WARNING') return 0xf59e0b
  if (state.applicationResult === 'NORMAL') return 0x22c55e
  if (state.applicationResult === 'PLATFORM_FAILURE') return 0xa855f7
  return 0x38bdf8
}

export function createWorldRenderer(canvas: HTMLCanvasElement): WorldRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x07111f, 0.025)
  const camera = new THREE.PerspectiveCamera(42, canvas.clientWidth / canvas.clientHeight, 0.1, 200)
  camera.position.set(15, 15, 25)
  camera.lookAt(0, 1.5, 0)

  scene.add(new THREE.HemisphereLight(0x9edaff, 0x07111f, 2.2))
  const key = new THREE.DirectionalLight(0xffffff, 3)
  key.position.set(8, 16, 10)
  scene.add(key)

  const grid = new THREE.GridHelper(38, 38, 0x244968, 0x13283d)
  scene.add(grid)

  const group = new THREE.Group()
  scene.add(group)

  const labels = ['ECS', 'CONTAINER', 'SPRING', 'MYBATIS', 'JDBC', 'AURORA']
  const boxes: THREE.Mesh[] = []
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x15324a, roughness: 0.55, metalness: 0.25 })
  labels.forEach((_, index) => {
    const height = 2.4 + (index % 2) * 1.2
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(3.5, height, 3.5), baseMaterial.clone())
    mesh.position.set((index - 2.5) * 4.3, height / 2, Math.sin(index * 1.2) * 1.8)
    group.add(mesh)
    boxes.push(mesh)
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 16, 10),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
    )
    beacon.position.set(mesh.position.x, height + 0.45, mesh.position.z)
    group.add(beacon)
  })

  const flowMaterial = new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
  const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 10), flowMaterial)
  pulse.visible = false
  group.add(pulse)

  let latest: SimulationState | null = null
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
    frame = requestAnimationFrame(render)
    resize()
    const elapsed = clock.getElapsedTime()
    group.rotation.y = Math.sin(elapsed * 0.12) * 0.04
    if (latest) {
      const color = statusColor(latest)
      flowMaterial.color.setHex(color)
      const activeIndex = Math.min(boxes.length - 1, Math.max(0,
        latest.phase === 'PROVISION_ENI' || latest.phase === 'WAIT_CAPACITY' || latest.phase === 'PULL_IMAGE' ? 0
          : latest.phase === 'START_JVM' ? 1
            : latest.phase === 'START_SPRING' || latest.phase === 'START_JOB' ? 2
              : latest.phase === 'RUN_TASKLET' || latest.phase === 'FLUSH_BATCH' ? 3
                : latest.phase === 'COMMIT' || latest.phase === 'ROLLBACK' ? 5
                  : 4,
      ))
      boxes.forEach((box, index) => {
        const material = box.material as THREE.MeshStandardMaterial
        material.emissive.setHex(index === activeIndex ? color : 0x000000)
        material.emissiveIntensity = index === activeIndex ? 1.5 : 0
      })
      const from = boxes[activeIndex]?.position
      const to = boxes[Math.min(activeIndex + 1, boxes.length - 1)]?.position
      if (from && to && latest.phase !== 'DONE' && latest.phase !== 'IDLE') {
        pulse.visible = true
        pulse.position.lerpVectors(from, to, latest.progress)
        pulse.position.y += 2.8
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
    dispose() {
      cancelAnimationFrame(frame)
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => material.dispose())
      })
      renderer.dispose()
    },
  }
}
