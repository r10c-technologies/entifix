'use client';

import { usePathLocale } from '@entifix/next-shell';
import {
  Cluster,
  type Density,
  Stack,
  Text,
  ThemeSwitcher,
  useT,
  useTheme,
} from '@entifix/react-controls';

const DENSITIES: readonly Density[] = ['compact', 'comfortable'];

/**
 * Theme, density and language.
 *
 * Theme is the framework's own switcher. Density is the theme context's too —
 * the provider writes `data-density` and remembers the choice beside the
 * theme — but which densities an application offers, and how it asks, is the
 * application's call, so the control is this example's. Language is a link to
 * the other prefix.
 */
export function Preferences() {
  const t = useT('app');
  const locale = usePathLocale();
  const { density, setDensity } = useTheme();

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
