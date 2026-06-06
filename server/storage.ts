import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { config } from './config.js'
import { log } from './utils/logger.js'

export class StorageManager {
  private rootDir: string

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? config.storageDir
    fs.mkdirSync(this.rootDir, { recursive: true })
  }

  /**
   * 为传输任务准备目录。
   */
  prepare(transferId: string): void {
    fs.mkdirSync(path.join(this.rootDir, transferId, 'chunks'), { recursive: true })
    fs.mkdirSync(path.join(this.rootDir, transferId, 'files'), { recursive: true })
  }

  /**
   * 写入单个分块。
   */
  async writeChunk(transferId: string, fileId: string, chunkIndex: number, buf: Buffer): Promise<void> {
    const dir = path.join(this.rootDir, transferId, 'chunks', fileId)
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(path.join(dir, `${chunkIndex}.part`), buf)
  }

  /**
   * 检查已接收的分块索引。
   */
  async getReceivedChunks(transferId: string, fileId: string): Promise<number[]> {
    const dir = path.join(this.rootDir, transferId, 'chunks', fileId)
    try {
      const files = await fs.promises.readdir(dir)
      return files
        .filter(f => f.endsWith('.part'))
        .map(f => parseInt(f.replace('.part', ''), 10))
        .filter(n => !isNaN(n))
        .sort((a, b) => a - b)
    } catch {
      return []
    }
  }

  /**
   * 把所有分块顺序拼接为完整文件。
   */
  async assemble(transferId: string, fileId: string, totalChunks: number, fileName: string): Promise<string> {
    const chunkDir = path.join(this.rootDir, transferId, 'chunks', fileId)
    const outPath = path.join(this.rootDir, transferId, 'files', `${fileId}_${fileName}`)
    const out = fs.createWriteStream(outPath)

    for (let i = 0; i < totalChunks; i++) {
      const partPath = path.join(chunkDir, `${i}.part`)
      const input = fs.createReadStream(partPath)
      await pipeline(input, out, { end: false })
    }
    out.end()

    // 等待 finish
    await new Promise<void>((resolve, reject) => {
      out.on('finish', resolve)
      out.on('error', reject)
    })

    // 清理分块目录
    await fs.promises.rm(chunkDir, { recursive: true, force: true })
    log('info', '文件拼接完成', { transferId, fileId, fileName })
    return outPath
  }

  /**
   * 获取已拼接文件的路径。
   */
  resolveFile(transferId: string, fileId: string, fileName: string): string {
    return path.join(this.rootDir, transferId, 'files', `${fileId}_${fileName}`)
  }

  /**
   * 查找文件（可能不知道完整文件名）。
   */
  async findFile(transferId: string, fileId: string): Promise<string | null> {
    const filesDir = path.join(this.rootDir, transferId, 'files')
    try {
      const files = await fs.promises.readdir(filesDir)
      const match = files.find(f => f.startsWith(fileId))
      return match ? path.join(filesDir, match) : null
    } catch {
      return null
    }
  }

  /**
   * 清理传输任务的所有数据。
   */
  purge(transferId: string): void {
    const dir = path.join(this.rootDir, transferId)
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch (e) {
      log('warn', '清理失败', { transferId, error: String(e) })
    }
  }
}
