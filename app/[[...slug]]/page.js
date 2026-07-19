'use client';

import dynamic from 'next/dynamic';

const SpaRoot = dynamic(() => import('@/components/SpaRoot'), { ssr: false });

export default function CatchAll() {
  return <SpaRoot />;
}
