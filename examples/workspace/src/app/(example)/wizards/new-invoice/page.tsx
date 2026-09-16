'use client';

import { useLocaleHref } from '@entifix/next-shell';
import { useRouter } from 'next/navigation';

import { NewInvoiceWizard } from '../../../../wizard/new-invoice-wizard';

export default function NewInvoiceWizardPage() {
  const router = useRouter();
  const withLocale = useLocaleHref();
  return (
    <NewInvoiceWizard
      onCreated={id => router.push(withLocale(`/invoices/${id}`))}
    />
  );
}
