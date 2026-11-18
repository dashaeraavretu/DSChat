import { create } from 'zustand'

/** 原生菜单 Ctrl+K 请求聚焦搜索框；token 递增让已挂载/刚挂载的侧栏都能响应 */
export const useSearchFocus = create<{ token: number }>(() => ({ token: 0 }))

export const requestSearchFocus = () => {
  useSearchFocus.setState((state) => ({ token: state.token + 1 }))
}
