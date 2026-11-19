import styles from './FatFishMascot.module.css'

/** 原创简易胖鱼：青绿身体 + 珊瑚鳍，不使用官方鲸鱼轮廓/品牌蓝。 */
export const FatFishMascot = () => (
  <svg
    className={styles.mascot}
    viewBox="0 0 160 120"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="132" cy="18" r="5" fill="var(--dsw-alias-brand-primary)" opacity="0.25" />
    <circle cx="146" cy="34" r="3" fill="var(--dsw-alias-brand-primary)" opacity="0.18" />
    <circle cx="124" cy="42" r="2.5" fill="var(--dsw-alias-brand-primary)" opacity="0.22" />
    <path
      d="M32 62c0-24 18-42 44-42 25 0 42 14 47 34 4 14-1 25-11 21-4 15-18 25-36 25-26 0-44-16-44-38Z"
      fill="#0a6f89"
    />
    <path d="M30 62c-10-8-18-6-22 2 7 2 12 8 14 15 5-4 8-10 8-17Z" fill="#c2510c" />
    <path d="M78 27c5-12 16-16 25-13-4 7-6 15-6 23-7-5-14-8-19-10Z" fill="#c2510c" />
    <circle cx="99" cy="51" r="6" fill="#fff" />
    <circle cx="101" cy="52" r="3" fill="#073b46" />
    <path d="M111 71c6 2 10 6 11 11" stroke="#073b46" strokeWidth="3" strokeLinecap="round" />
    <path d="M54 80c10 6 24 7 35 2" stroke="#7ee0f4" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
  </svg>
)
