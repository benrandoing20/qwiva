import React from 'react';
import Svg, { Rect } from 'react-native-svg';

interface Props {
  size?: number;
}

export function QwivaLogo({ size = 40 }: Props) {
  const w = size;
  const h = size * 1.1;
  const r = size * 0.1;
  const gap = size * 0.055;
  const half = (size - gap) / 2;

  return (
    <Svg width={w} height={h} viewBox="0 0 40 44" fill="none">
      <Rect x={0} y={0} width={18} height={20} rx={4} fill="#002E5D" />
      <Rect x={22} y={0} width={18} height={20} rx={4} fill="#6F5091" />
      <Rect x={0} y={24} width={18} height={20} rx={4} fill="#B288B9" />
      <Rect x={22} y={24} width={18} height={20} rx={4} fill="#D988BA" />
    </Svg>
  );
}
