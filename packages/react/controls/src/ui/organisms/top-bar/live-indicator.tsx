'use client';

import { useEffect, useRef, useState } from 'react';

import { useT } from '../../../i18n/index.js';
import { TONE_SURFACE } from '../../atoms/alert/tone.js';
import { Button } from '../../atoms/button/index.js';
import { cn } from '../../utils/cn.js';
import type { LiveConnection } from '../../utils/live-updates.js';

/**
 * One polite region that is always there, so what changes in it is heard:
 * "paused — reconnecting" on the drop, "resumed" on the recovery, and nothing
 * while updates simply flow.
 */
export function LiveIndicator({
  connection,
  onReconnect,
}: {
  connection: LiveConnection;
  onReconnect?: () => void;
}) {
  const t = useT();
  const previous = useRef(connection);
  const [resumed, setResumed] = useState(false);
  useEffect(() => {
    if (previous.current === connection) return;
    setResumed(connection === 'open');
    previous.current = connection;
  }, [connection]);

  return (
    <div role="status" className="flex items-center">
      {connection === 'open' ? (
        resumed && <span className="sr-only">{t('live.resumed')}</span>
      ) : (
        <span
          data-testid="live-updates-paused"
          className={cn(
            'flex items-center gap-2xs rounded-md border px-xs py-3xs text-step-sm',
            TONE_SURFACE.warning,
          )}
        >
          {t(connection === 'closed' ? 'live.stopped' : 'live.reconnecting')}
          {onReconnect !== undefined && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onReconnect}
            >
              {t('live.reconnect')}
            </Button>
          )}
        </span>
      )}
    </div>
  );
}
