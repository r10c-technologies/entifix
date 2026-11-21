import { docsMetadata, DocsPage } from '@entifix/docs-engine/ui';

import { site } from '../../site';

interface Props {
  readonly params: Promise<{ slug: string[] }>;
}

export const dynamicParams = false;

export const generateStaticParams = () => site.params();

export async function generateMetadata({ params }: Props) {
  return docsMetadata(site, (await params).slug);
}

export default async function Page({ params }: Props) {
  return <DocsPage site={site} slugs={(await params).slug} />;
}
