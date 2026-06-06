const CHUNK_SIZE = 4 * 1024 * 1024 // 4MB
const MAX_CONCURRENCY = 3

export interface UploadOptions {
  file: File
  transferId: string
  fileId: string
  onProgress?: (uploaded: number, total: number) => void
  signal?: AbortSignal
}

/**
 * 分块上传单个文件。
 */
export async function uploadFile(opts: UploadOptions): Promise<void> {
  const totalChunks = Math.ceil(opts.file.size / CHUNK_SIZE) || 1
  let uploaded = 0

  // 先查询已上传分块（断点续传）
  let receivedSet = new Set<number>()
  try {
    const res = await fetch(`/api/upload/status?transferId=${opts.transferId}&fileId=${opts.fileId}`)
    if (res.ok) {
      const data = await res.json()
      receivedSet = new Set(data.receivedChunks || [])
    }
  } catch {}

  // 过滤出需要上传的分块
  const queue: number[] = []
  for (let i = 0; i < totalChunks; i++) {
    if (!receivedSet.has(i)) {
      queue.push(i)
    } else {
      // 已上传的计入进度
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, opts.file.size)
      uploaded += end - start
    }
  }

  opts.onProgress?.(uploaded, opts.file.size)

  // 并发上传
  let queueIdx = 0

  async function worker() {
    while (queueIdx < queue.length) {
      if (opts.signal?.aborted) throw new Error('aborted')
      const idx = queue[queueIdx++]
      const start = idx * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, opts.file.size)
      const blob = opts.file.slice(start, end)

      const fd = new FormData()
      fd.append('transferId', opts.transferId)
      fd.append('fileId', opts.fileId)
      fd.append('chunkIndex', String(idx))
      fd.append('chunk', blob)

      await retry(() => fetch('/api/upload', {
        method: 'POST',
        body: fd,
        signal: opts.signal
      }), 3)

      uploaded += blob.size
      opts.onProgress?.(uploaded, opts.file.size)
    }
  }

  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, queue.length) }, () => worker())
  await Promise.all(workers)
}

async function retry<T>(fn: () => Promise<T>, times: number): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < times; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      await sleep(500 * (i + 1))
    }
  }
  throw lastErr
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 计算文件的分块信息。
 */
export function calcChunks(file: File) {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE) || 1
  return { totalChunks, chunkSize: CHUNK_SIZE }
}
