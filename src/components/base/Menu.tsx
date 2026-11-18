import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from './anchored.js'
import styles from './Menu.module.css'

export type MenuOption = {
  key: string
  label: string
  icon: ReactNode
  danger?: boolean
  onSelect: () => void
}

/** 点击触发，向下展开；点外部或 Esc 关闭 */
export const Menu = ({
  options,
  children,
}: {
  options: MenuOption[]
  children: (props: { open: boolean; toggle: () => void }) => ReactNode
}) => {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  // 左侧对齐并再左移 5px，让菜单文字与触发元素图标对齐
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open,
    { align: 'start', alignOffset: -5, offset: 4 }
  )
  const close = () => setOpen(false)
  useDismiss(open, [anchorRef, floatingRef], close)

  useEffect(() => {
    if (!open) {
      return
    }
    const frame = requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  const focusItem = (index: number) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    if (items.length === 0) {
      return
    }
    const next = (index + items.length) % items.length
    items[next].focus({ preventScroll: true })
  }

  return (
    <>
      <span ref={anchorRef} className={styles.anchor}>
        {children({ open, toggle: () => setOpen((value) => !value) })}
      </span>
      {open
        ? createPortal(
            <div
              ref={(node) => {
                floatingRef.current = node
                menuRef.current = node
              }}
              className={styles.menu}
              style={position ?? undefined}
              role="menu"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  close()
                  return
                }
                if (event.key === 'Tab') {
                  setOpen(false)
                  return
                }
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                  return
                }
                event.preventDefault()
                const items = [
                  ...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
                ]
                const index = items.indexOf(document.activeElement as HTMLElement)
                if (event.key === 'Home') {
                  focusItem(0)
                } else if (event.key === 'End') {
                  focusItem(items.length - 1)
                } else if (event.key === 'ArrowDown') {
                  focusItem(index + 1)
                } else {
                  focusItem(index <= 0 ? items.length - 1 : index - 1)
                }
              }}
            >
              {options.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="menuitem"
                  className={clsx(styles.option, option.danger && styles.danger)}
                  onClick={() => {
                    setOpen(false)
                    option.onSelect()
                  }}
                >
                  <span className={styles.icon}>{option.icon}</span>
                  {option.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
