/**
 * 生成 UUID v4。
 * 注意：crypto.randomUUID() 仅在安全上下文（HTTPS / localhost）可用，
 * 手机通过 http://局域网IP 访问时不是安全上下文，必须用此兼容实现。
 */
export function uuidv4(): string {
  // 优先用安全上下文的原生实现
  const c: Crypto | undefined = (globalThis as any).crypto
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID()
    } catch {
      // 落到下面的兼容实现
    }
  }

  // crypto.getRandomValues 在非安全上下文也可用
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    c.getRandomValues(bytes)
    // 设置版本号(4)与变体位
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'))
    return (
      hex.slice(0, 4).join('') +
      '-' + hex.slice(4, 6).join('') +
      '-' + hex.slice(6, 8).join('') +
      '-' + hex.slice(8, 10).join('') +
      '-' + hex.slice(10, 16).join('')
    )
  }

  // 最后兜底：Math.random（非加密强度，仅作极端兜底）
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
