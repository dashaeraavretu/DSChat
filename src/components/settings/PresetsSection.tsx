import { useRef, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  CharacterCardError,
  parseCharacterCardJson,
  parseCharacterCardPng,
  type CharacterCardErrorCode,
} from '../../services/characterCard.js'
import {
  createPreset,
  deletePreset,
  parsePresetBundle,
  setDefaultPreset,
  updatePreset,
  usePresets,
  type Preset,
} from '../../services/presets.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { ORIGINAL_SYSTEM_PROMPT, renderPrompt } from '../../services/promptVariables.js'
import styles from './Settings.module.css'

type Draft = { id?: string; name: string; system: string; greeting: string }

const ERROR_KEYS: Record<CharacterCardErrorCode, TranslationKey> = {
  invalidFile: 'presetInvalidCard',
  unsupportedCard: 'presetUnsupportedCard',
  noCardData: 'presetNoCardData',
  invalidJson: 'presetInvalidCard',
  missingName: 'presetMissingName',
}

const describeImportError = (error: unknown) =>
  error instanceof CharacterCardError ? ERROR_KEYS[error.code] : 'presetInvalidCard'

/** 设置第三节：预设列表、编辑、默认标记与 V2/V3 角色卡导入 */
export const PresetsSection = () => {
  const t = useTranslate()
  const presets = usePresets((state) => state.presets)
  const defaultId = usePresets((state) => state.defaultId)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [deleting, setDeleting] = useState<Preset | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const bundleFileRef = useRef<HTMLInputElement>(null)

  const openNew = () => setDraft({ name: '', system: '', greeting: '' })
  const openEdit = (preset: Preset) =>
    setDraft({
      id: preset.id,
      name: preset.name,
      system: preset.system,
      greeting: preset.greeting,
    })

  const save = () => {
    if (!draft?.name.trim()) {
      showToast({ key: 'presetNameRequired', type: 'error' })
      return
    }
    if (draft.id) {
      updatePreset(draft.id, {
        name: draft.name.trim(),
        system: draft.system,
        greeting: draft.greeting,
      })
    } else {
      createPreset({
        name: draft.name.trim(),
        system: draft.system,
        greeting: draft.greeting,
        source: 'manual',
      })
    }
    setDraft(null)
  }

  const importFile = async (file: File) => {
    try {
      const parsed = file.name.toLowerCase().endsWith('.png')
        ? parseCharacterCardPng(await file.arrayBuffer())
        : parseCharacterCardJson(JSON.parse(await file.text()))
      const preset = createPreset({
        name: parsed.name,
        system: parsed.system,
        greeting: parsed.greeting,
        description: parsed.description,
        tags: parsed.tags,
        creator: parsed.creator,
        characterVersion: parsed.characterVersion,
        source: parsed.source,
      })
      // 默认策略由 createPreset 统一处理：仅首个预设自动成为默认，导入不抢占已有默认
      showToast({ key: 'presetImported', params: { name: preset.name } })
    } catch (error) {
      showToast({
        key: 'presetImportFailed',
        type: 'error',
        params: { message: t(describeImportError(error)) },
      })
    }
  }

  const downloadJson = async (name: string, content: string): Promise<boolean> => {
    const bridge = window.desktop
    if (bridge?.saveTextFile) {
      return bridge.saveTextFile({ content, defaultName: name })
    }
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  }

  const exportPresets = async () => {
    if (presets.length === 0) {
      return
    }
    const bundle = {
      format: 'dschat-presets',
      version: 1,
      exportedAt: new Date().toISOString(),
      presets,
    }
    const date = new Date().toISOString().slice(0, 10)
    try {
      const ok = await downloadJson(
        `dschat-presets-${date}.json`,
        `${JSON.stringify(bundle, null, 2)}\n`
      )
      showToast(ok ? { key: 'presetBundleExported' } : { key: 'presetExportFailed', type: 'error' })
    } catch {
      showToast({ key: 'presetExportFailed', type: 'error' })
    }
  }

  const importBundle = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      showToast({ key: 'presetBundleTooLarge', type: 'error' })
      return
    }
    try {
      const parsed = JSON.parse(await file.text()) as unknown
      const items = parsePresetBundle(parsed)
      if (!items) {
        showToast({ key: 'presetBundleInvalid', type: 'error' })
        return
      }
      const existing = new Set(presets.map((preset) => `${preset.name}\u0000${preset.system}`))
      let count = 0
      for (const item of items) {
        const key = `${item.name}\u0000${item.system}`
        if (existing.has(key)) {
          continue
        }
        existing.add(key)
        createPreset({ ...item, source: 'manual' })
        count += 1
      }
      if (count === 0) {
        showToast({ key: 'presetBundleEmpty', type: 'error' })
        return
      }
      showToast({ key: 'presetBundleImported', params: { count } })
    } catch {
      showToast({ key: 'presetBundleInvalid', type: 'error' })
    }
  }

  return (
    <div className={styles.presets}>
      <div className={styles.presetToolbar}>
        <Button variant="outlined" size="m" onClick={openNew}>
          {t('presetNew')}
        </Button>
        <Button variant="outlined" size="m" onClick={() => fileRef.current?.click()}>
          {t('presetImport')}
        </Button>
        <Button variant="outlined" size="m" onClick={() => bundleFileRef.current?.click()}>
          {t('presetImportBundle')}
        </Button>
        <Button
          variant="outlined"
          size="m"
          disabled={presets.length === 0}
          onClick={() => void exportPresets()}
        >
          {t('presetExport')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.png,application/json,image/png"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) {
              void importFile(file)
            }
          }}
        />
        <input
          ref={bundleFileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) {
              void importBundle(file)
            }
          }}
        />
      </div>
      {presets.length === 0 ? <div className={styles.presetEmpty}>{t('presetEmpty')}</div> : null}
      <div className={styles.presetList}>
        {presets.map((preset) => (
          <div key={preset.id} className={styles.presetRow}>
            <div className={styles.presetInfo}>
              <div className={styles.presetName}>
                {preset.name}
                {preset.id === defaultId ? (
                  <span className={styles.presetBadge}>{t('presetDefault')}</span>
                ) : null}
              </div>
              {preset.description ? (
                <div className={styles.presetMeta}>{preset.description}</div>
              ) : null}
            </div>
            <div className={styles.presetActions}>
              {preset.id !== defaultId ? (
                <Button variant="outlined" size="s" onClick={() => setDefaultPreset(preset.id)}>
                  {t('presetSetDefault')}
                </Button>
              ) : null}
              <Button variant="outlined" size="s" onClick={() => openEdit(preset)}>
                {t('presetEdit')}
              </Button>
              <Button variant="dangerOutlined" size="s" onClick={() => setDeleting(preset)}>
                {t('presetDelete')}
              </Button>
            </div>
          </div>
        ))}
      </div>
      {deleting ? (
        <Modal
          title={t('presetDeleteTitle')}
          onClose={() => setDeleting(null)}
          footer={
            <div className={styles.deleteActions}>
              <Button variant="outlined" onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  deletePreset(deleting.id)
                  setDeleting(null)
                }}
              >
                {t('presetDelete')}
              </Button>
            </div>
          }
        >
          {t('presetDeleteDescription', { name: deleting.name })}
        </Modal>
      ) : null}
      {draft ? (
        <Modal
          title={draft.id ? t('presetEdit') : t('presetNew')}
          className={styles.presetEditor}
          mainClassName={styles.presetEditorMain}
          onClose={() => setDraft(null)}
          footer={
            <div className={styles.deleteActions}>
              <Button variant="outlined" onClick={() => setDraft(null)}>
                {t('cancel')}
              </Button>
              <Button variant="primary" onClick={save}>
                {t('presetSave')}
              </Button>
            </div>
          }
        >
          <div className={styles.presetForm}>
            <label className={styles.presetField}>
              <span className={styles.presetFieldLabel}>{t('presetName')}</span>
              <input
                className={styles.presetInput}
                maxLength={100}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label className={styles.presetField}>
              <span className={styles.presetFieldLabel}>{t('presetSystem')}</span>
              <textarea
                className={styles.presetTextarea}
                rows={6}
                value={draft.system}
                onChange={(event) => setDraft({ ...draft, system: event.target.value })}
              />
            </label>
            <label className={styles.presetField}>
              <span className={styles.presetFieldLabel}>{t('presetGreeting')}</span>
              <textarea
                className={styles.presetTextarea}
                rows={3}
                value={draft.greeting}
                onChange={(event) => setDraft({ ...draft, greeting: event.target.value })}
              />
            </label>
            <div className={styles.presetVariables}>{t('presetVariablesHint')}</div>
            <div className={styles.presetPreview}>
              <div className={styles.presetFieldLabel}>{t('presetPreview')}</div>
              {draft.system.trim() ? (
                <pre>
                  {renderPrompt(draft.system, {
                    char: draft.name || 'Assistant',
                    original: ORIGINAL_SYSTEM_PROMPT,
                  })}
                </pre>
              ) : null}
              {draft.greeting.trim() ? (
                <pre>{renderPrompt(draft.greeting, { char: draft.name || 'Assistant' })}</pre>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
