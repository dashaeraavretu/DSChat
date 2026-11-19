import clsx from 'clsx'
import { memo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconDownloadOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconPinOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import { exportSessionMarkdown } from '../../services/chat/exportMarkdown.js'
import { downloadSessionImage } from '../../services/chat/exportImage.js'
import {
  renameSession,
  selectSession,
  toggleSessionPin,
} from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { showToast } from '../base/toastState.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './SessionItem.module.css'

export const SessionItem = memo(function SessionItem({
  session,
  active,
  onDelete,
}: {
  session: SessionSummary
  active: boolean
  onDelete: () => void
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const displayTitle = session.title || t('untitledChat')

  if (editing) {
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <div
      className={clsx(styles.item, active && styles.active)}
      role="button"
      tabIndex={0}
      aria-current={active ? 'true' : undefined}
      onClick={() => {
        selectSession(session.id)
        closeMobileSider()
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          selectSession(session.id)
          closeMobileSider()
        }
      }}
    >
      <div className={styles.titleRow}>
        {session.pinned ? (
          <span className={styles.pin} aria-label={t('pinnedSession')}>
            <IconPinOutline16 />
          </span>
        ) : null}
        <div className={styles.title}>{displayTitle}</div>
        {session.ephemeral ? <span className={styles.badge}>{t('ephemeralBadge')}</span> : null}
      </div>
      <div className={styles.action} onClick={(event) => event.stopPropagation()}>
        <Menu
          options={[
            {
              key: 'pin',
              label: t(session.pinned ? 'unpinSession' : 'pinSession'),
              icon: <IconPinOutline16 />,
              onSelect: () => toggleSessionPin(session.id),
            },
            {
              key: 'rename',
              label: t('sessionItemMenuRenameOption'),
              icon: <IconEditOutline16 />,
              onSelect: () => setEditing(true),
            },
            ...(session.ephemeral
              ? []
              : [
                  {
                    key: 'export-image',
                    label: t('exportImage'),
                    icon: <IconDownloadOutline16 />,
                    onSelect: () => {
                      void downloadSessionImage(session.id)
                        .then(() => showToast({ key: 'exportImageDone' }))
                        .catch(() => showToast({ key: 'exportImageFailed', type: 'error' }))
                    },
                  },
                  {
                    key: 'export-markdown',
                    label: t('exportMarkdown'),
                    icon: <IconDownloadOutline16 />,
                    onSelect: () => {
                      void exportSessionMarkdown(session.id)
                        .then((ok) =>
                          showToast(
                            ok
                              ? { key: 'exportMarkdownDone' }
                              : { key: 'exportMarkdownFailed', type: 'error' }
                          )
                        )
                        .catch(() =>
                          showToast({ key: 'exportMarkdownFailed', type: 'error' })
                        )
                    },
                  },
                ]),
            {
              key: 'delete',
              label: t('delete'),
              icon: <IconTrashOutline16 />,
              danger: true,
              onSelect: onDelete,
            },
          ]}
        >
          {({ toggle }) => (
            <IconButton icon={<IconEllipsisOutline16 />} aria-label={t('more')} onClick={toggle} />
          )}
        </Menu>
      </div>
    </div>
  )
})
