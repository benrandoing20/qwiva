'use client'

import Image from 'next/image'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

type BrandLogoProps = {
  className?: string
  priority?: boolean
  width?: number
  height?: number
}

/** Navy wordmark for light UI; white wordmark for dark UI (PNG has transparent matte). */
export default function BrandLogo({
  className,
  priority,
  width = 104,
  height = 36,
}: BrandLogoProps) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const lightUi = mounted && resolvedTheme === 'light'
  const src = lightUi ? '/logo-for-light-bg.png' : '/logo-for-dark-bg.png'

  return (
    <span className="inline-flex bg-transparent">
      <Image
        src={src}
        alt="Qwiva"
        width={width}
        height={height}
        className={className}
        priority={priority}
      />
    </span>
  )
}
