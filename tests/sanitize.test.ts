import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { sanitizeFileName } from '../server/utils/sanitize.js'

describe('sanitizeFileName', () => {
  it('移除路径分隔符', () => {
    expect(sanitizeFileName('a/b/c.txt')).not.toContain('/')
    expect(sanitizeFileName('a\\b\\c.txt')).not.toContain('\\')
  })

  it('阻断目录穿越', () => {
    const r = sanitizeFileName('../../etc/passwd')
    expect(r).not.toContain('..')
    expect(r).not.toContain('/')
  })

  it('空或非法名给默认值/安全名', () => {
    expect(sanitizeFileName('')).toBe('unnamed_file')
    expect(sanitizeFileName('.')).toBe('unnamed_file')
    // '..' 中的 .. 被替换为安全字符，结果不含穿越序列
    const dotdot = sanitizeFileName('..')
    expect(dotdot).not.toContain('..')
    expect(dotdot.length).toBeGreaterThan(0)
  })

  it('保留正常文件名', () => {
    expect(sanitizeFileName('视频 2024.mp4')).toBe('视频 2024.mp4')
  })

  // 属性测试：任意输入，结果都不含路径穿越字符，且长度 <= 255
  it('属性：输出永不含路径分隔符/.. 且长度受限', () => {
    fc.assert(fc.property(fc.string(), (name) => {
      const r = sanitizeFileName(name)
      expect(r.includes('/')).toBe(false)
      expect(r.includes('\\')).toBe(false)
      expect(r.includes('..')).toBe(false)
      expect(r.length).toBeLessThanOrEqual(255)
      expect(r.length).toBeGreaterThan(0)
    }))
  })
})
