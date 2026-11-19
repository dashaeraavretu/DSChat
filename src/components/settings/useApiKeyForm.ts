import { useState } from 'react'
import {
  ApiError,
  apiErrorFromBridge,
  prepareDesktopApi,
  verifyApiKey,
} from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import { isDesktopApp, refreshApiKeyStorage, setApiKey } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'

/** 输入 API Key 后先用 GET /models 校验，通过才保存 */
export const useApiKeyForm = (onSaved?: () => void) => {
  const t = useTranslate()
  const [value, setValue] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null)
  const cause = failure?.cause
  const error =
    failure === null
      ? null
      : classifyApiError(cause) === 'unauthorized'
        ? t('apiKeyInvalid')
        : classifyApiError(cause) === 'network'
          ? t('commonNetworkErrorToast')
          : t('apiKeyVerificationFailed', {
              message:
                cause instanceof ApiError && cause.localMessage
                  ? t(cause.localMessage.key, cause.localMessage.params)
                  : cause instanceof Error
                    ? cause.message
                    : String(cause),
            })

  const submit = async () => {
    const apiKey = value.trim()
    if (!apiKey || verifying) {
      return
    }
    setVerifying(true)
    setFailure(null)
    try {
      const bridge = isDesktopApp() ? window.desktop : undefined
      if (bridge?.verifyAndSaveApiKey) {
        // 先把官方/千机 provider 同步到主进程，再让主进程校验并保存
        await prepareDesktopApi()
        // 桌面端：Key 交给主进程校验并保存，成功后渲染层只保留 hasApiKey
        const result = await bridge.verifyAndSaveApiKey(apiKey)
        if (!result.ok) {
          throw apiErrorFromBridge(result.error)
        }
        setApiKey(apiKey, { persisted: true })
        await refreshApiKeyStorage()
      } else {
        await verifyApiKey(apiKey)
        setApiKey(apiKey)
      }
      setValue('')
      onSaved?.()
    } catch (e) {
      setFailure({ cause: e })
    } finally {
      setVerifying(false)
    }
  }

  return { value, setValue, verifying, error, submit }
}
