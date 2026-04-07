/**
 * Makes near-black pixels transparent (removes matte from exported logos).
 * Run: node scripts/make-logos-transparent.mjs
 */
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, '..', 'public')
const THRESH = 28

async function processFile(name) {
  const inputPath = path.join(publicDir, name)
  if (!fs.existsSync(inputPath)) {
    console.warn('skip missing:', name)
    return
  }
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    if (r <= THRESH && g <= THRESH && b <= THRESH) {
      data[i + 3] = 0
    }
  }

  const outPath = inputPath + '.tmp.png'
  await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png()
    .toFile(outPath)
  fs.renameSync(outPath, inputPath)
  console.log('processed:', name)
}

await Promise.all(
  ['logo-for-light-bg.png', 'logo-for-dark-bg.png'].map((f) => processFile(f)),
)
