export const ORIGINAL_SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

export type PromptVariableValues = {
  user?: string
  char?: string
  /** 原始内置 system 提示词，供 {{original}} 使用 */
  original?: string
  now?: Date
}

const pad = (value: number) => String(value).padStart(2, '0')

/** 最小变量替换；未知变量保持原样，不执行任何代码。 */
export const renderPrompt = (text: string, values: PromptVariableValues = {}): string => {
  const now = values.now ?? new Date()
  const map: Record<string, string> = {
    user: values.user?.trim() || 'User',
    char: values.char?.trim() || 'Assistant',
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    original: values.original ?? '',
  }
  return text.replace(/\{\{\s*(user|char|date|time|original)\s*\}\}/gi, (_, key: string) => {
    return map[key.toLowerCase()] ?? ''
  })
}
