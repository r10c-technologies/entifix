import type { ReactNode } from 'react';

import { ExampleChrome } from '../../chrome';

export default function ExampleLayout({ children }: { children: ReactNode }) {
  return <ExampleChrome>{children}</ExampleChrome>;
}
