'use client';

import { usePathLocale } from '@entifix/next-shell';
import {
  Cluster,
  Stack,
  Text,
  ThemeSwitcher,
  useT,
} from '@entifix/react-controls';
import { useEffect, useState } from 'react';

const DENSITIES = ['compact', 'comfortable'] as const;
type Density = (typeof DENSITIES)[number];

/**
 * Theme, density and language.
 *
 * Theme is the framework's own switcher. Density has no control in the
 * framework on purpose — it is a document attribute `fixed-scale.css` reads, and
 * which density an application offers is the application's call — so this
 * example flips `data-density` itself. Language is a link to the other prefix.
 */
export function Preferences() {
  const t = useT('app');
  const locale = usePathLocale();
  const [density, setDensity] = useState<Density>('compact');

  useEffect(() => {
    document.documentElement.dataset['density'] = density;
  }, [density]);

  return (
    <Stack>
      <ThemeSwitcher />
      <Cluster role="radiogroup" aria-label={t('preferences.density')}>
        <Text>{t('preferences.density')}</Text>
        {DENSITIES.map(option => (
          <label key={option} className="flex items-center gap-3xs">
            <input
              type="radio"
              name="density"
              value={option}
              checked={density === option}
              onChange={() => setDensity(option)}
            />
            {t(`preferences.${option}`)}
          </label>
        ))}
      </Cluster>
      <Cluster aria-label={t('preferences.locale')}>
        <Text>{t('preferences.locale')}</Text>
        <a href="/es" aria-current={locale === 'es' ? 'true' : undefined}>
          {t('preferences.es')}
        </a>
        <a href="/en" aria-current={locale === 'en' ? 'true' : undefined}>
          {t('preferences.en')}
        </a>
      </Cluster>
    </Stack>
  );
}
