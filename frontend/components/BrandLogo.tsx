import Image from 'next/image'

type BrandLogoProps = {
  className?: string
  priority?: boolean
  width?: number
  height?: number
}

/** Navy wordmark for light UI; white wordmark for dark UI (PNG has transparent matte).
 *  Both images are always in the DOM — CSS dark:hidden/dark:block toggles instantly
 *  without waiting for a new image load, eliminating the theme-switch flash. */
export default function BrandLogo({
  className,
  priority,
  width = 104,
  height = 36,
}: BrandLogoProps) {
  const sharedStyle = { width: 'auto', height, minWidth: 72, flexShrink: 0 }

  return (
    <span className="inline-flex flex-none bg-transparent">
      <Image
        src="/logo-for-light-bg.png"
        alt="Qwiva"
        width={width}
        height={height}
        className={`block object-contain dark:hidden ${className ?? ''}`}
        style={sharedStyle}
        priority={priority}
      />
      <Image
        src="/logo-for-dark-bg.png"
        alt=""
        aria-hidden
        width={width}
        height={height}
        className={`hidden object-contain dark:block ${className ?? ''}`}
        style={sharedStyle}
        priority={priority}
      />
    </span>
  )
}
