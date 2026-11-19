import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { useChatStore } from '../../services/chat/store.js'
import { usePresets } from '../../services/presets.js'
import { useSettings } from '../../services/settings.js'
import { renderPrompt } from '../../services/promptVariables.js'
import { FatFishMascot } from './FatFishMascot.js'
import { PresetDecoration } from './PresetDecoration.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 新对话：问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const ephemeral = useChatStore((state) => state.ephemeralNewChat)
  const appearance = useSettings((state) => state.appearance)
  const showMascot = useSettings((state) => state.showMascot)
  const preset = usePresets((state) =>
    state.presets.find((item) => item.id === state.defaultId)
  )
  return (
    <div className={styles.container}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        {appearance === 'fish' && showMascot ? <FatFishMascot /> : null}
        {appearance === 'tui' || appearance === 'paper' ? (
          <PresetDecoration kind="empty" size="empty" />
        ) : null}
        {ephemeral ? <div className={styles.ephemeralBadge}>{t('ephemeralBadge')}</div> : null}
        <div className={styles.greeting}>{t('welcomeMessageChat250808')}</div>
        {preset?.greeting ? (
          <div className={styles.presetGreeting}>
            {renderPrompt(preset.greeting, { char: preset.name })}
          </div>
        ) : null}
        <ChatInput sessionId={null} />
        {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
