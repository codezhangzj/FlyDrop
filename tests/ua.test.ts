import { describe, it, expect } from 'vitest'
import { detectDeviceType, detectOS, detectBrowser } from '../server/utils/ua.js'

describe('detectDeviceType', () => {
  it('识别 iPhone 为 mobile', () => {
    expect(detectDeviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari')).toBe('mobile')
  })
  it('识别 iPad 为 tablet', () => {
    expect(detectDeviceType('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari')).toBe('tablet')
  })
  it('识别 Android 手机为 mobile', () => {
    expect(detectDeviceType('Mozilla/5.0 (Linux; Android 13; Pixel 7) Mobile Safari')).toBe('mobile')
  })
  it('识别 Android 平板为 tablet', () => {
    expect(detectDeviceType('Mozilla/5.0 (Linux; Android 13; SM-X200) Safari')).toBe('tablet')
  })
  it('桌面 UA 为 desktop', () => {
    expect(detectDeviceType('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome')).toBe('desktop')
  })
  it('空 UA 为 unknown', () => {
    expect(detectDeviceType('')).toBe('unknown')
  })
})

describe('detectOS / detectBrowser', () => {
  it('识别操作系统', () => {
    expect(detectOS('... Windows NT 10 ...')).toBe('Windows')
    expect(detectOS('... Macintosh ...')).toBe('macOS')
    expect(detectOS('... Android 13 ...')).toBe('Android')
  })
  it('识别浏览器', () => {
    expect(detectBrowser('... Edg/120 ...')).toBe('Edge')
    expect(detectBrowser('... Chrome/120 ...')).toBe('Chrome')
    expect(detectBrowser('... Firefox/120 ...')).toBe('Firefox')
  })
})
