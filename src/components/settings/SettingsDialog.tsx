import clsx from 'clsx'
import { useRef, useState, type ReactNode } from 'react'
import {
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconSettingsOutline16,
  IconThinkOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  importHistory,
} from '../../services/chat/backup.js'
import { useIsMobile } from '../../app/viewport.js'
import { useChatStore } from '../../services/chat/store.js'
import { regionCodes, getRegionName, provinces } from '../../services/location.js'
import {
  clearApiKey,
  isChineseBrowser,
  isDesktopApp,
  setCloseToTray,
  setLocale,
  setLocation,
  setAppearance,
  setNotifyOnComplete,
  setReadingWidth,
  setSendKey,
  setShowInputCount,
  setShowMascot,
  setThemePreference,
  setTtsSpeed,
  setTtsVoice,
  setZoomPreference,
  useSettings,
  type Appearance,
  type ReadingWidth,
  type SendKey,
  type ThemePreference,
  type TtsSpeed,
  type ZoomFactor,
} from '../../services/settings.js'
import {
  API_MODEL,
  API_ORIGIN,
  APP_VERSION,
  FEATURES,
} from '../../services/buildInfo.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { PresetsSection } from './PresetsSection.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import styles from './Settings.module.css'

/**
 * 设置弹窗：分「通用设置」（主题、语言、朗读音色、位置）与「数据管理」（API Key、导入、导出、删除）。
 * 桌面端为居中弹窗、左侧导航；移动端为底部弹层、导航横排在内容上方
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsContent /> : null
}

const sections: { value: SettingsSection; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'general',
    label: 'settingDialogAsideGeneralOptionLabel',
    icon: <IconSettingsOutline16 />,
  },
  { value: 'data', label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
  {
    value: 'presets',
    label: 'settingDialogAsidePresetsOptionLabel',
    icon: <IconThinkOutline16 />,
  },
]

const SettingsContent = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 打开时按调用方指定的分组选中，之后在弹窗内切换
  const [section, setSection] = useState(() => useSettingsDialog.getState().section)
  const [aboutOpen, setAboutOpen] = useState(false)
  // 切换分组不丢失正在输入的 API Key 与导入状态
  const apiKeyEditor = useApiKeyEditor()
  const clearKey = useClearKey()
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory
  return (
    <>
      <Modal
        title={t('settings')}
        closable
        className={styles.dialog}
        mainClassName={styles.dialogMain}
        footer={
          <div className={styles.aboutBar}>
            <span className={styles.aboutText}>
              {`DSChat v${APP_VERSION} · ${API_ORIGIN} · ${API_MODEL}`}
            </span>
            <button type="button" className={styles.aboutLink} onClick={() => setAboutOpen(true)}>
              {t('about')}
            </button>
          </div>
        }
        onClose={() => {
          if (!historyDelete.busy) {
            closeSettings()
          }
        }}
      >
        <div role="tablist" className={styles.navigation}>
          {sections.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={section === item.value}
              className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
              onClick={() => setSection(item.value)}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className={styles.content}>
          {section === 'presets' ? (
            <PresetsSection />
          ) : section === 'general' ? (
            <>
              <ThemeSetting />
              <LocaleSetting />
              <TtsVoiceSetting />
              <LocationSetting />
              <CloseToTraySetting />
              <NotificationSetting />
              <ZoomSetting />
              <AppearanceSetting />
              <MascotSetting />
              <InputCountSetting />
              <ReadingWidthSetting />
              <TtsSpeedSetting />
              <SendKeySetting />
            </>
          ) : (
            <>
              <ApiKeyField editor={apiKeyEditor} />
              {apiKeyEditor.apiKey ? (
                <SettingCell
                  label={t('apiKeyClear')}
                  status={null}
                  action={
                    <Button
                      variant="dangerOutlined"
                      size="m"
                      className={styles.cellButton}
                      disabled={historyBusy || clearKey.busy}
                      onClick={clearKey.open}
                    >
                      {t('apiKeyClear')}
                    </Button>
                  }
                />
              ) : null}
              <ImportHistory historyImport={historyImport} disabled={historyBusy} />
              <ExportHistory disabled={historyBusy} />
              <SettingCell
                label={t('deleteAllSessions')}
                status={null}
                action={
                  <Button
                    variant="dangerOutlined"
                    size="m"
                    className={styles.cellButton}
                    disabled={historyBusy}
                    onClick={historyDelete.open}
                  >
                    {t('delete')}
                  </Button>
                }
              />
              {isMobile ? <ApiKeyConfirm editor={apiKeyEditor} /> : null}
            </>
          )}
        </div>
      </Modal>
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
      {clearKey.opened ? <ClearKeyConfirm clearKey={clearKey} /> : null}
      {aboutOpen ? <AboutDialog onClose={() => setAboutOpen(false)} /> : null}
    </>
  )
}

/** 清除 API Key 的确认与执行；失败时保留现状并提示，不伪装成已清除。 */
const useClearKey = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const clearing = useRef(false)

  const confirm = async () => {
    if (clearing.current) {
      return
    }
    clearing.current = true
    setBusy(true)
    try {
      if (await clearApiKey()) {
        setOpened(false)
        showToast({ key: 'apiKeyCleared' })
      } else {
        showToast({ key: 'apiKeyClearFailed', type: 'error' })
      }
    } catch {
      showToast({ key: 'apiKeyClearFailed', type: 'error' })
    } finally {
      clearing.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!clearing.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

const ClearKeyConfirm = ({ clearKey }: { clearKey: ReturnType<typeof useClearKey> }) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('apiKeyClearTitle')}
      className={styles.deleteConfirm}
      onClose={clearKey.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={clearKey.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={clearKey.busy}
            onClick={clearKey.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={clearKey.busy}
            onClick={() => void clearKey.confirm()}
          >
            {t(clearKey.busy ? 'apiKeyClearing' : 'apiKeyClearConfirm')}
          </Button>
        </div>
      }
    >
      {t('apiKeyClearDescription')}
    </Modal>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined

  return (
    <SettingCell
      label={t('settingsLocation')}
      status={null}
      className={styles.locationCell}
      action={
        <div className={styles.locationSelectors}>
          {isChineseBrowser() ? (
            <>
              <Select
                ariaLabel={t('settingsLocationProvince')}
                className={styles.provinceSelect}
                value={province?.code ?? ''}
                placeholder={t('settingsLocationProvince')}
                options={provinces.map((item) => ({ value: item.code, label: item.name }))}
                onChange={(value) => {
                  if (value !== province?.code) {
                    setLocation({ region: 'CN', province: value })
                  }
                }}
              />
              <Select
                ariaLabel={t('settingsLocationCity')}
                className={styles.citySelect}
                value={province ? (location?.city ?? '') : ''}
                disabled={!province?.cities.length}
                placeholder={t('settingsLocationCity')}
                options={
                  province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []
                }
                onChange={(value) => {
                  if (province) {
                    setLocation({ region: 'CN', province: province.code, city: value })
                  }
                }}
              />
            </>
          ) : (
            <Select
              ariaLabel={t('settingsLocationRegion')}
              className={styles.regionSelect}
              value={location?.region ?? ''}
              placeholder={t('settingsLocationRegion')}
              options={regionCodes
                .map((code) => ({ value: code, label: getRegionName(code, locale) }))
                .sort((a, b) => a.label.localeCompare(b.label, locale))}
              onChange={(value) => setLocation({ region: value })}
            />
          )}
        </div>
      }
    />
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

/** 朗读音色：stella（海星，女声）/ tide（暗潮，男声） */
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

/** 覆盖导入的二次确认，叠在设置弹窗上 */
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button variant="dangerOutlined" size="m" onClick={() => void historyImport.confirm()}>
            {t('historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

const CloseToTraySetting = () => {
  const t = useTranslate()
  const closeToTray = useSettings((state) => state.closeToTray)
  const desktop = isDesktopApp()
  return (
    <SettingCell
      label={t('settingsCloseToTray')}
      description={desktop ? t('settingsCloseToTrayDescription') : t('settingsCloseToTrayDesktopOnly')}
      status={null}
      action={
        <button
          type="button"
          role="switch"
          aria-checked={closeToTray}
          aria-label={t('settingsCloseToTray')}
          className={clsx(styles.switch, closeToTray && styles.switchOn)}
          disabled={!desktop}
          onClick={() => setCloseToTray(!closeToTray)}
        >
          <span className={styles.switchThumb} />
        </button>
      }
    />
  )
}

const NotificationSetting = () => {
  const t = useTranslate()
  const notifyOnComplete = useSettings((state) => state.notifyOnComplete)
  const desktop = isDesktopApp()
  return (
    <SettingCell
      label={t('settingsNotifyOnComplete')}
      description={
        desktop
          ? t('settingsNotifyOnCompleteDescription')
          : t('settingsNotifyOnCompleteDesktopOnly')
      }
      status={null}
      action={
        <button
          type="button"
          role="switch"
          aria-checked={notifyOnComplete}
          aria-label={t('settingsNotifyOnComplete')}
          className={clsx(styles.switch, notifyOnComplete && styles.switchOn)}
          disabled={!desktop}
          onClick={() => setNotifyOnComplete(!notifyOnComplete)}
        >
          <span className={styles.switchThumb} />
        </button>
      }
    />
  )
}

const ZoomSetting = () => {
  const t = useTranslate()
  const zoomFactor = useSettings((state) => state.zoomFactor)
  return (
    <SettingCell
      label={t('settingsZoom')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsZoom')}
          value={String(zoomFactor)}
          options={[0.9, 1, 1.1, 1.25].map((factor) => ({
            value: String(factor),
            label: `${Math.round(factor * 100)}%`,
          }))}
          onChange={(value) => setZoomPreference(Number(value) as ZoomFactor)}
        />
      }
    />
  )
}

const AppearanceSetting = () => {
  const t = useTranslate()
  const appearance = useSettings((state) => state.appearance)
  return (
    <SettingCell
      label={t('settingsAppearance')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsAppearance')}
          value={appearance}
          options={[
            { value: 'original', label: t('appearanceOriginal') },
            { value: 'tui', label: t('appearanceTui') },
            { value: 'fish', label: t('appearanceFish') },
            { value: 'paper', label: t('appearancePaper') },
          ]}
          onChange={(value) => setAppearance(value as Appearance)}
        />
      }
    />
  )
}

const MascotSetting = () => {
  const t = useTranslate()
  const showMascot = useSettings((state) => state.showMascot)
  const appearance = useSettings((state) => state.appearance)
  return (
    <SettingCell
      label={t('settingsShowMascot')}
      description={t('settingsShowMascotDescription')}
      status={null}
      action={
        <button
          type="button"
          role="switch"
          aria-checked={showMascot}
          aria-label={t('settingsShowMascot')}
          className={clsx(styles.switch, showMascot && styles.switchOn)}
          disabled={appearance !== 'fish'}
          onClick={() => setShowMascot(!showMascot)}
        >
          <span className={styles.switchThumb} />
        </button>
      }
    />
  )
}

const InputCountSetting = () => {
  const t = useTranslate()
  const showInputCount = useSettings((state) => state.showInputCount)
  return (
    <SettingCell
      label={t('settingsInputCount')}
      status={null}
      action={
        <button
          type="button"
          role="switch"
          aria-checked={showInputCount}
          aria-label={t('settingsInputCount')}
          className={clsx(styles.switch, showInputCount && styles.switchOn)}
          onClick={() => setShowInputCount(!showInputCount)}
        >
          <span className={styles.switchThumb} />
        </button>
      }
    />
  )
}

const ReadingWidthSetting = () => {
  const t = useTranslate()
  const readingWidth = useSettings((state) => state.readingWidth)
  return (
    <SettingCell
      label={t('settingsReadingWidth')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsReadingWidth')}
          value={readingWidth}
          options={[
            { value: 'comfortable', label: t('readingComfortable') },
            { value: 'wide', label: t('readingWide') },
          ]}
          onChange={(value) => setReadingWidth(value as ReadingWidth)}
        />
      }
    />
  )
}

const TtsSpeedSetting = () => {
  const t = useTranslate()
  const ttsSpeed = useSettings((state) => state.ttsSpeed)
  return (
    <SettingCell
      label={t('settingsTtsSpeed')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsSpeed')}
          value={String(ttsSpeed)}
          options={[
            { value: '0.8', label: t('ttsSpeedSlow') },
            { value: '1', label: t('ttsSpeedNormal') },
            { value: '1.2', label: t('ttsSpeedFast') },
          ]}
          onChange={(value) => setTtsSpeed(Number(value) as TtsSpeed)}
        />
      }
    />
  )
}

const SendKeySetting = () => {
  const t = useTranslate()
  const sendKey = useSettings((state) => state.sendKey)
  return (
    <SettingCell
      label={t('settingsSendKey')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsSendKey')}
          value={sendKey}
          options={[
            { value: 'enter', label: t('sendKeyEnter') },
            { value: 'ctrlEnter', label: t('sendKeyCtrlEnter') },
          ]}
          onChange={(value) => setSendKey(value as SendKey)}
        />
      }
    />
  )
}

const AboutDialog = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const [exporting, setExporting] = useState(false)
  const bridge = window.desktop
  const featureLabels = [
    FEATURES.files ? t('aboutFeatureFiles') : null,
    FEATURES.speech ? t('aboutFeatureSpeech') : null,
    FEATURES.webTools ? t('aboutFeatureWebTools') : null,
  ].filter(Boolean)
  const disabledLabels = [
    !FEATURES.files ? t('aboutFeatureFiles') : null,
    !FEATURES.speech ? t('aboutFeatureSpeech') : null,
    !FEATURES.webTools ? t('aboutFeatureWebTools') : null,
  ].filter(Boolean)

  const exportLogs = async () => {
    if (!bridge?.exportDiagnostics) {
      showToast({ key: 'diagnosticsExportFailed', type: 'error' })
      return
    }
    setExporting(true)
    try {
      const ok = await bridge.exportDiagnostics({
        version: APP_VERSION,
        apiOrigin: API_ORIGIN,
        model: API_MODEL,
        features: FEATURES,
      })
      showToast(
        ok
          ? { key: 'diagnosticsExported' }
          : { key: 'diagnosticsExportFailed', type: 'error' }
      )
    } finally {
      setExporting(false)
    }
  }

  return (
    <Modal
      title={t('aboutTitle')}
      className={styles.aboutDialog}
      onClose={onClose}
      footer={
        <div className={styles.deleteActions}>
          <Button variant="outlined" onClick={onClose}>
            {t('close')}
          </Button>
          <Button
            variant="primary"
            disabled={exporting || !bridge?.exportDiagnostics}
            onClick={() => void exportLogs()}
          >
            {t(exporting ? 'diagnosticsExporting' : 'diagnosticsExport')}
          </Button>
        </div>
      }
    >
      <div className={styles.aboutRows}>
        <div className={styles.aboutRow}>
          <span className={styles.aboutLabel}>{t('aboutVersion')}</span>
          <span className={styles.aboutValue}>{APP_VERSION}</span>
        </div>
        <div className={styles.aboutRow}>
          <span className={styles.aboutLabel}>{t('aboutEndpoint')}</span>
          <span className={styles.aboutValue}>{API_ORIGIN}</span>
        </div>
        <div className={styles.aboutRow}>
          <span className={styles.aboutLabel}>{t('aboutModel')}</span>
          <span className={styles.aboutValue}>{API_MODEL}</span>
        </div>
        <div className={styles.aboutRow}>
          <span className={styles.aboutLabel}>{t('aboutFeatures')}</span>
          <span className={styles.aboutValue}>
            {featureLabels.length > 0 ? featureLabels.join(' / ') : t('aboutNone')}
          </span>
        </div>
      </div>
      {disabledLabels.length > 0 ? (
        <div className={styles.aboutWarning}>
          {t('aboutTestBuildWarning', { features: disabledLabels.join(' / ') })}
        </div>
      ) : null}
      <div className={styles.aboutDescription}>{t('diagnosticsDescription')}</div>
      <div className={styles.aboutDescription}>
        {t('thirdPartyLicenses')}: React, Zustand, KaTeX, Mermaid, Prism, idb, fflate, Twemoji (CC-BY 4.0) ·
        THIRD_PARTY_NOTICES.md
      </div>
    </Modal>
  )
}

const SettingCell = ({
  label,
  description,
  status,
  action,
  className,
}: {
  label: string
  description?: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status || description ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 选文件后先提示覆盖；确认后才检查文件并执行导入，任何错误都提示导入失败。 */
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)

  const confirm = async () => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    setFile(null)
    setBusy(true)
    setStatus(null)
    try {
      const count = await importHistory(file)
      setStatus({ key: count === 1 ? 'historyImportedOne' : 'historyImported', params: { count } })
    } catch {
      setStatus({ key: 'historyImportFailed', error: true })
    } finally {
      importing.current = false
      setBusy(false)
    }
  }

  return { file, busy, status, select: setFile, cancel: () => setFile(null), confirm }
}

/** 导入 = 覆盖：用选中文件替换本地全部会话与附件。 */
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={historyImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                historyImport.select(file)
              }
            }}
          />
        </>
      }
    />
  )
}

/** 将全部会话及图片导出为 ZIP 文件并下载 */
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const { name, blob } = await exportHistory()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}
