import { docsMetadata, DocsPage } from '@entifix/docs-engine/ui';

import { site } from '../site';

/** The home is the guides' index. */
const HOME = ['guides'];

export const generateMetadata = () => docsMetadata(site, HOME);

export default function Home() {
  return <DocsPage site={site} slugs={HOME} />;
}
