'use client';

import { BackOfficeShell } from '@entifix/next-shell';
import { useT } from '@entifix/react-controls';
import type { ReactNode } from 'react';

export default function AppLayout({ children }: { children: ReactNode }) {
  const t = useT('app');
  return (
    <BackOfficeShell
      nav={[
        { type: 'master', items: [{ label: t('nav.books'), href: '/books' }] },
      ]}
      brand={t('brand')}
      breadcrumbLabels={{ books: t('nav.books') }}
    >
      {children}
    </BackOfficeShell>
  );
}
