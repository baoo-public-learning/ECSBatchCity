// @vitest-environment happy-dom
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../src/sim/model'
import { createWorldRenderer } from '../src/three/create-world-renderer'

function createFakeRenderer() {
  return {
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    getPixelRatio: vi.fn(() => 1),
    render: vi.fn(),
    dispose: vi.fn(),
    outputColorSpace: '',
  }
}

function mountWorld(width = 800, height = 500) {
  const fakeRenderer = createFakeRenderer()
  const cancelFrame = vi.fn()
  const canvas = document.createElement('canvas')
  Object.defineProperty(canvas, 'clientWidth', { value: width })
  Object.defineProperty(canvas, 'clientHeight', { value: height })
  const world = createWorldRenderer(canvas, {
    createRenderer: () => fakeRenderer,
    requestFrame: () => 1,
    cancelFrame,
  })
  return { world, fakeRenderer, cancelFrame }
}

function pickableDistricts(world: ReturnType<typeof mountWorld>['world']): Set<string> {
  // 端ぎりぎりではなく、画面内側(|x|<=0.85)で建物に届くこと=見切れて
  // いないことを判定する。
  const picked = new Set<string>()
  for (let x = -0.85; x <= 0.85; x += 0.04) {
    for (let y = -0.9; y <= 0.9; y += 0.06) {
      const district = world.pickAt(x, y)
      if (district) picked.add(district)
    }
  }
  return picked
}

describe('world renderer resources', () => {
  it('disposes geometries, materials, textures, renderer, and the frame loop', () => {
    const geometrySpy = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
    const materialSpy = vi.spyOn(THREE.Material.prototype, 'dispose')
    const textureSpy = vi.spyOn(THREE.Texture.prototype, 'dispose')
    const { world, fakeRenderer, cancelFrame } = mountWorld()
    world.update(createInitialState())
    world.dispose()
    expect(fakeRenderer.dispose).toHaveBeenCalledTimes(1)
    expect(cancelFrame).toHaveBeenCalledTimes(1)
    expect(geometrySpy.mock.calls.length).toBeGreaterThanOrEqual(13)
    expect(materialSpy.mock.calls.length).toBeGreaterThanOrEqual(14)
    // 6地区ラベルのCanvasTextureもdisposeされること
    expect(textureSpy.mock.calls.length).toBeGreaterThanOrEqual(6)
    geometrySpy.mockRestore()
    materialSpy.mockRestore()
    textureSpy.mockRestore()
  })

  it('exposes a reduced-motion switch', () => {
    const { world } = mountWorld()
    expect(() => world.setReducedMotion(true)).not.toThrow()
    expect(() => world.setReducedMotion(false)).not.toThrow()
    world.dispose()
  })
})

describe('district picking and camera', () => {
  it('can pick every district somewhere in the default view', () => {
    const { world } = mountWorld()
    const picked = pickableDistricts(world)
    for (const label of ['ECS', 'CONTAINER', 'SPRING', 'MYBATIS', 'JDBC', 'AURORA']) {
      expect(picked.has(label), `expected ${label} to be pickable`).toBe(true)
    }
    world.dispose()
  })

  it('fits every district into a narrow (portrait-ish) canvas too', () => {
    // 3カラムレイアウトの中央canvasはaspect比が1未満になる。
    const { world } = mountWorld(707, 790)
    const picked = pickableDistricts(world)
    for (const label of ['ECS', 'CONTAINER', 'SPRING', 'MYBATIS', 'JDBC', 'AURORA']) {
      expect(picked.has(label), `expected ${label} to be pickable at narrow aspect`).toBe(true)
    }
    world.dispose()
  })

  it('fits every district on a mobile portrait canvas', () => {
    const { world } = mountWorld(390, 700)
    const picked = pickableDistricts(world)
    for (const label of ['ECS', 'CONTAINER', 'SPRING', 'MYBATIS', 'JDBC', 'AURORA']) {
      expect(picked.has(label), `expected ${label} to be pickable on mobile portrait`).toBe(true)
    }
    world.dispose()
  })

  it('returns null when picking empty sky', () => {
    const { world } = mountWorld()
    expect(world.pickAt(0, 0.98)).toBeNull()
    world.dispose()
  })

  it('exposes selection highlight and camera focus without throwing', () => {
    const { world } = mountWorld()
    expect(() => world.setSelected('AURORA')).not.toThrow()
    expect(() => world.focusDistrict('AURORA')).not.toThrow()
    expect(() => world.setSelected(null)).not.toThrow()
    expect(() => world.focusDistrict(null)).not.toThrow()
    world.dispose()
  })
})
