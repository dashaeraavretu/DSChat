import emptyUrl from '../../assets/decorations/empty.svg'
import errorUrl from '../../assets/decorations/error.svg'
import loadingUrl from '../../assets/decorations/loading.svg'
import styles from './PresetDecoration.module.css'

/** 非原版外观使用的开源装饰（Twemoji CC-BY 4.0），默认原版不渲染。 */
export const PresetDecoration = ({
  kind,
  size = 'small',
}: {
  kind: 'empty' | 'error' | 'loading'
  size?: 'small' | 'empty'
}) => {
  const src = kind === 'empty' ? emptyUrl : kind === 'error' ? errorUrl : loadingUrl
  return (
    <img
      className={size === 'empty' ? styles.empty : styles.small}
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}
