import { describe, expect, it } from 'vitest'

import { cropBottom } from '@/renderer/service.js'

describe('cropBottom', () => {
  function makePixels(
    width: number,
    height: number,
    fillColor: [number, number, number, number],
  ): Uint8Array {
    const arr = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      arr[i * 4 + 0] = fillColor[0]
      arr[i * 4 + 1] = fillColor[1]
      arr[i * 4 + 2] = fillColor[2]
      arr[i * 4 + 3] = fillColor[3]
    }
    return arr
  }

  it('returns full height when all rows have content', () => {
    const pixels = makePixels(10, 5, [0, 0, 0, 255]) // all black
    expect(cropBottom(pixels, 10, 5)).toBe(5)
  })

  it('trims trailing white rows', () => {
    // 3 rows of black content, then 2 rows of white
    const pixels = new Uint8Array(10 * 5 * 4).fill(255)
    // make rows 0..2 black
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 10; col++) {
        const i = (row * 10 + col) * 4
        pixels[i] = 0
        pixels[i + 1] = 0
        pixels[i + 2] = 0
        pixels[i + 3] = 255
      }
    }
    // with padding=0 → should return 3
    expect(cropBottom(pixels, 10, 5, 0)).toBe(3)
  })

  it('adds padding to crop height', () => {
    const pixels = new Uint8Array(10 * 5 * 4).fill(255)
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 10; col++) {
        const i = (row * 10 + col) * 4
        pixels[i] = 0
        pixels[i + 1] = 0
        pixels[i + 2] = 0
        pixels[i + 3] = 255
      }
    }
    // content on rows 0..1, padding=8 → min(2+8, 5) = 5
    expect(cropBottom(pixels, 10, 5, 8)).toBe(5)
  })

  it('returns 1 for all-white canvas', () => {
    const pixels = new Uint8Array(10 * 3 * 4).fill(255)
    expect(cropBottom(pixels, 10, 3, 0)).toBe(1)
  })
})
