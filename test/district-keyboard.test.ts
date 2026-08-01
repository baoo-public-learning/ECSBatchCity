import { describe, expect, it } from 'vitest'
import { nextDistrictForKey } from '../src/three/district-keyboard'

describe('keyboard district selection', () => {
  it('moves right and left through the districts', () => {
    expect(nextDistrictForKey(null, 'ArrowRight')).toBe('ECS')
    expect(nextDistrictForKey('ECS', 'ArrowRight')).toBe('CONTAINER')
    expect(nextDistrictForKey('AURORA', 'ArrowRight')).toBe('AURORA')
    expect(nextDistrictForKey('CONTAINER', 'ArrowLeft')).toBe('ECS')
    expect(nextDistrictForKey('ECS', 'ArrowLeft')).toBe('ECS')
    expect(nextDistrictForKey(null, 'ArrowLeft')).toBe('AURORA')
  })

  it('clears the selection with Escape', () => {
    expect(nextDistrictForKey('SPRING', 'Escape')).toBeNull()
  })

  it('ignores unrelated keys', () => {
    expect(nextDistrictForKey('SPRING', 'a')).toBe('SPRING')
    expect(nextDistrictForKey(null, 'Enter')).toBeNull()
  })
})
