import { v4 as uuidv4 } from 'uuid'

export function uuid(): string {
  return uuidv4()
}

// 用于生成随机设备昵称
const adjectives = [
  '蓝色', '红色', '绿色', '金色', '银色', '紫色', '橙色', '青色',
  '快乐', '勇敢', '聪明', '灵动', '飞速', '安静', '明亮', '温暖'
]

const nouns = [
  '狐狸', '小猫', '熊猫', '老鹰', '海豚', '独角兽', '火箭', '星星',
  '月亮', '彩虹', '闪电', '雪花', '樱花', '钻石', '珊瑚', '水晶'
]

export function randomNickname(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
  const noun = nouns[Math.floor(Math.random() * nouns.length)]
  const suffix = Math.random().toString(36).slice(2, 4).toUpperCase()
  return `${adj}${noun}-${suffix}`
}
