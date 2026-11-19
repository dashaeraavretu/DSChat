import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconChevronDownOutline14,
  IconPanelLeftOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
  IconThinkOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { searchSessions, type SessionSearchResult } from '../../services/chat/search.js'
import {
  newChat,
  removeSession,
  selectSession,
  useChatStore,
} from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { useSearchFocus } from './searchFocusState.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(() => groupSessions(sessions, now, t), [sessions, now, t])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SessionSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const focusToken = useSearchFocus((state) => state.token)

  useEffect(() => {
    if (focusToken > 0) {
      searchRef.current?.focus()
    }
  }, [focusToken])

  // 150ms 节流后再查 IndexedDB，避免每个按键都读取全部会话
  useEffect(() => {
    const needle = query.trim()
    if (!needle) {
      setResults([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      void searchSessions(needle)
        .then((found) => {
          if (!cancelled) {
            setResults(found)
            setSearching(false)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResults([])
            setSearching(false)
          }
        })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}>{t('appName')}</div>
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
      </div>
      <div className={styles.newChatRow}>
        <button
          type="button"
          className={clsx(styles.newChat, 'ds-new-chat')}
          onClick={() => {
            newChat()
            closeMobileSider()
          }}
        >
          <span className={styles.newChatIcon}>
            <NewChatIcon />
          </span>
          {t('newChat')}
        </button>
        <Menu
          options={[
            {
              key: 'ephemeral',
              label: t('ephemeralChat'),
              icon: <IconThinkOutline16 />,
              onSelect: () => {
                newChat(true)
                closeMobileSider()
              },
            },
          ]}
        >
          {({ toggle }) => (
            <IconButton
              size="m"
              icon={<IconChevronDownOutline14 />}
              tooltip={t('newChatMenu')}
              onClick={toggle}
            />
          )}
        </Menu>
      </div>
      <div className={styles.searchWrap}>
        <div className={clsx(styles.searchField, 'ds-search-field')}>
          <span className={styles.searchIcon} aria-hidden="true">
            <IconSearchOutline16 />
          </span>
          <input
            ref={searchRef}
            type="search"
            className={clsx(styles.searchInput, 'ds-search-input')}
            placeholder={t('searchSessionsPlaceholder')}
            aria-label={t('searchSessionsPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setQuery('')
                event.currentTarget.blur()
              }
            }}
          />
          <kbd className={styles.searchKbd} aria-hidden="true">
            Ctrl K
          </kbd>
        </div>
      </div>
      <div className={styles.listWrap}>
        {query.trim() ? (
          <div className={styles.searchResults}>
            {searching ? (
              <div className={styles.searchEmpty}>{t('searchSearching')}</div>
            ) : results.length > 0 ? (
              <>
                <div className={styles.searchCount}>
                  {t('searchResultCount', { count: results.length })}
                </div>
                {results.map((result) => (
                  <button
                    key={result.session.id}
                    type="button"
                    className={styles.searchResult}
                    onClick={() => {
                      selectSession(result.session.id)
                      closeMobileSider()
                    }}
                  >
                    <span className={styles.searchResultTitle}>
                      {result.session.title || t('newChat')}
                    </span>
                    <span className={styles.searchResultSnippet}>{result.snippet}</span>
                  </button>
                ))}
              </>
            ) : (
              <div className={styles.searchEmpty}>{t('searchNoResults')}</div>
            )}
          </div>
        ) : (
          <div className={styles.list}>
            {groups.map((group) => (
              <div key={group.key} className={styles.section}>
                <div className={styles.sectionHeader}>{group.label}</div>
                {group.sessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    active={session.id === activeId}
                    onDelete={() => setDeleting(session)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={styles.bottom}>
        <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
          <span className={styles.settingsIcon}>
            <IconSettingsOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer}>
        <Sider mobile />
      </div>
    </>
  )
}
