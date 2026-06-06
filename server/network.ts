import { networkInterfaces } from 'os'

/**
 * 返回主机所有可用的局域网 IPv4 地址（排除回环、虚拟网卡）。
 */
export function listLanIPv4(): string[] {
  const result: string[] = []
  const ifaces = networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    // 排除常见虚拟网卡
    if (/(vEthernet|VMware|VirtualBox|docker|utun|llw|bridge|veth)/i.test(name)) continue
    for (const info of ifaces[name] ?? []) {
      if (info.family === 'IPv4' && !info.internal) {
        result.push(info.address)
      }
    }
  }
  // 按优先级排序
  result.sort((a, b) => priority(a) - priority(b))
  return result
}

function priority(ip: string): number {
  if (ip.startsWith('192.168.')) return 0
  if (ip.startsWith('10.')) return 1
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2
  return 99
}

/**
 * 返回最优先的局域网 IP。
 */
export function pickPrimaryLanIPv4(): string | null {
  const list = listLanIPv4()
  return list[0] ?? null
}
