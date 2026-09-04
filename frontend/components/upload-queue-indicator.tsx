'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Loader2, AlertCircle, CheckCircle2, Clock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import * as uploadManager from '@/lib/upload-manager';
import { getPendingUploads } from '@/lib/upload-queue';
import type { DrainState, QueuedRecord } from '@/lib/upload-manager';

function StatusIcon({ status }: { status: QueuedRecord['status'] }) {
  if (status === 'failed') return <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />;
  if (status === 'uploading') return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />;
  return <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

export function UploadQueueIndicator() {
  const queryClient = useQueryClient();
  const t = useTranslations('wardrobe.uploadQueue');
  const [state, setState] = useState<DrainState | null>(null);
  const [open, setOpen] = useState(false);
  // True only for records that already existed before this component
  // mounted (a real resume, e.g. the tab was closed mid-import) - lets the
  // copy say "resuming an earlier import" instead of implying this is a
  // brand new upload, which is what the reporter's own scenario needed to
  // not look stalled on return.
  const resumedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    uploadManager.init(queryClient);
    getPendingUploads().then((records) => {
      if (cancelled) return;
      resumedRef.current = records.length > 0;
      void uploadManager.startDrain();
    });

    const unsubscribe = uploadManager.subscribe(setState);
    uploadManager.getState().then((s) => {
      if (!cancelled) setState(s);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [queryClient]);

  const records = state?.records ?? [];
  const failedCount = state?.terminalRecords.length ?? 0;
  const remaining = state?.remaining ?? 0;

  // Keep the dialog mounted while it is open even after the queue empties, so
  // the last row finishing doesn't yank the sheet out from under a thumb.
  if (!state || (remaining === 0 && failedCount === 0 && !open)) {
    return null;
  }

  const statusLabel = (record: QueuedRecord) => {
    if (record.status === 'failed') return t('statusFailed');
    if (record.status === 'uploading') return t('statusUploading');
    if (record.attempts > 0) return t('statusRetrying', { attempt: record.attempts + 1 });
    return t('statusQueued');
  };

  return (
    <>
      <div className="fixed bottom-20 right-4 lg:bottom-4 z-50 w-full max-w-xs">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-lg border bg-card p-3 text-left shadow-lg space-y-2 hover:bg-accent/50"
        >
          {/* spans, not divs/ps: a <button>'s content model is phrasing only */}
          {remaining > 0 && (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
              <span className="text-sm">
                {resumedRef.current ? t('resuming', { count: remaining }) : t('remaining', { count: remaining })}
              </span>
            </span>
          )}
          {failedCount > 0 && (
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
              <span className="text-sm">{t('failedCount', { count: failedCount })}</span>
            </span>
          )}
          <span className="block text-xs text-muted-foreground">
            {remaining > 0 ? t('keepTabOpen') : t('reviewHint')}
          </span>
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* Centered modal from sm up, bottom drawer on phones - one element,
            no viewport-measuring hook and no second component to keep in sync. */}
        <DialogContent className="max-sm:top-auto max-sm:bottom-0 max-sm:translate-y-0 max-sm:rounded-t-xl max-sm:max-w-none">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>
              {remaining > 0 ? t('keepTabOpen') : t('reviewHint')}
            </DialogDescription>
          </DialogHeader>

          {records.length === 0 ? (
            <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
              {t('empty')}
            </p>
          ) : (
            <ul className="max-h-[50vh] divide-y overflow-y-auto">
              {records.map((record) => (
                <li key={record.id} className="flex items-center gap-3 py-2">
                  <StatusIcon status={record.status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{record.filename}</p>
                    <p className="truncate text-xs text-muted-foreground" title={record.lastError ?? undefined}>
                      {statusLabel(record)}
                      {record.lastError ? ` - ${record.lastError}` : ''}
                    </p>
                  </div>
                  {record.status === 'failed' && (
                    <Button size="sm" variant="ghost" onClick={() => uploadManager.retry(record.id)}>
                      {t('retry')}
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    aria-label={record.status === 'failed' ? t('dismiss') : t('cancel')}
                    title={record.status === 'failed' ? t('dismiss') : t('cancel')}
                    onClick={() => uploadManager.dismiss(record.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {state.storagePersisted === false && remaining > 0 && (
            <p className="text-xs text-yellow-600">{t('storageNotPersisted')}</p>
          )}

          <DialogFooter className="gap-2">
            {failedCount > 0 && (
              <Button size="sm" variant="outline" onClick={() => uploadManager.retryAll()}>
                {t('retryAll')}
              </Button>
            )}
            {records.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => uploadManager.cancelAll()}>
                {t('cancelAll')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
