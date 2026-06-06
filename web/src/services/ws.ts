import { ref } from 'vue'

export type WsMessage = {
  type: string
  payload?: any
}

type Listener = (msg: WsMessage) => void

export type ConnStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed'

// 全局响应式连接状态
export const connStatus = ref<ConnStatus>('connecting')

class WsClient {
  private ws?: WebSocket
  private listeners = new Set<Listener>()
  private reconnectDelay = 1000
  private alive = true
  private url = ''
  private pingTimer?: ReturnType<typeof setInterval>
  private everConnected = false

  connect(url: string) {
    this.url = url
    this.alive = true
    connStatus.value = 'connecting'
    this._connect()
  }

  private _connect() {
    if (!this.alive) return

    this.ws = new WebSocket(this.url)

    this.ws.onopen = () => {
      this.reconnectDelay = 1000
      this.everConnected = true
      connStatus.value = 'connected'
      this.pingTimer = setInterval(() => {
        this.send({ type: 'ping' })
      }, 15_000)
    }

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        this.listeners.forEach(l => l(msg))
      } catch {}
    }

    this.ws.onclose = () => {
      if (this.pingTimer) {
        clearInterval(this.pingTimer)
        this.pingTimer = undefined
      }
      if (!this.alive) {
        connStatus.value = 'closed'
        return
      }
      connStatus.value = this.everConnected ? 'reconnecting' : 'connecting'
      setTimeout(() => this._connect(), this.reconnectDelay)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10_000)
    }

    this.ws.onerror = () => {
      // onclose 会随后触发
    }
  }

  send(msg: WsMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close() {
    this.alive = false
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.ws?.close()
  }
}

// 单例
export const wsClient = new WsClient()
