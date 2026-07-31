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

function mountWorld() {
  const fakeRenderer = createFakeRenderer()
  const cancelFrame = vi.fn()
  const world = createWorldRenderer(document.createElement('canvas'), {
    createRenderer: () => fakeRenderer,
    requestFrame: () => 1,
    cancelFrame,
  })
  return { world, fakeRenderer, cancelFrame }
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
