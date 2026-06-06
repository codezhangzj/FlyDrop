import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface Device {
  deviceId: string
  displayName: string
  deviceType: 'mobile' | 'tablet' | 'desktop' | 'unknown'
  os?: string
  browser?: string
  ip: string
  isHost: boolean
  connectedAt: number
}

export const useDevicesStore = defineStore('devices', () => {
  const devices = ref<Device[]>([])
  const myDevice = ref<{ deviceId: string; displayName: string } | null>(null)

  function setMyDevice(payload: { deviceId: string; displayName: string }) {
    myDevice.value = payload
  }

  function setDevices(list: Device[]) {
    devices.value = list
  }

  // 其他在线设备（排除自己）
  const otherDevices = computed(() => {
    if (!myDevice.value) return devices.value
    return devices.value.filter(d => d.deviceId !== myDevice.value!.deviceId)
  })

  // 我自己的完整设备信息
  const myFullDevice = computed(() => {
    if (!myDevice.value) return null
    return devices.value.find(d => d.deviceId === myDevice.value!.deviceId) ?? null
  })

  return {
    devices,
    myDevice,
    otherDevices,
    myFullDevice,
    setMyDevice,
    setDevices,
  }
})
