import { describe, it, expect } from 'vitest'
import { isOwner, isPrivileged, canEditContent } from './roles'

describe('isOwner', () => {
  it('es true solo para owner', () => {
    expect(isOwner('owner')).toBe(true)
    expect(isOwner('admin')).toBe(false)
    expect(isOwner(null)).toBe(false)
  })
})

describe('isPrivileged', () => {
  it('es true para owner y admin', () => {
    expect(isPrivileged('owner')).toBe(true)
    expect(isPrivileged('admin')).toBe(true)
  })

  it('es false para editor y viewer', () => {
    expect(isPrivileged('editor')).toBe(false)
    expect(isPrivileged('viewer')).toBe(false)
  })
})

describe('canEditContent', () => {
  it('es false solo para viewer', () => {
    expect(canEditContent('viewer')).toBe(false)
    expect(canEditContent('editor')).toBe(true)
    expect(canEditContent('admin')).toBe(true)
    expect(canEditContent('owner')).toBe(true)
  })
})
