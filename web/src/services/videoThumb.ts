// 在接收端浏览器本地抓取视频首帧作为缩略图（无需服务端 ffmpeg）
// 通过流式端点加载视频元数据 -> 跳到首帧 -> 绘制到 canvas -> 导出 JPEG dataURL
export function captureVideoThumbnail(
  url: string,
  opts: { maxSize?: number; timeoutMs?: number } = {}
): Promise<string | null> {
  const maxSize = opts.maxSize ?? 320
  const timeoutMs = opts.timeoutMs ?? 8000

  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    ;(video as any).playsInline = true
    video.preload = 'metadata'
    video.src = url

    let done = false
    const finish = (result: string | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { video.removeAttribute('src'); video.load() } catch {}
      resolve(result)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)

    const draw = () => {
      try {
        const vw = video.videoWidth
        const vh = video.videoHeight
        if (!vw || !vh) return finish(null)
        const scale = Math.min(1, maxSize / Math.max(vw, vh))
        const w = Math.round(vw * scale)
        const h = Math.round(vh * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return finish(null)
        ctx.drawImage(video, 0, 0, w, h)
        finish(canvas.toDataURL('image/jpeg', 0.7))
      } catch {
        finish(null)
      }
    }

    video.addEventListener('loadeddata', () => {
      const t = Math.min(0.5, (video.duration || 1) * 0.1)
      if (isFinite(t) && t > 0) {
        try { video.currentTime = t } catch { draw() }
      } else {
        draw()
      }
    })
    video.addEventListener('seeked', draw)
    video.addEventListener('error', () => finish(null))
  })
}
