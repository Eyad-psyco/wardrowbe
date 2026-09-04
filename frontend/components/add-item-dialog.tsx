'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, Loader2, CheckCircle2, AlertCircle, Image as ImageIcon, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateItem, useBulkCreateItems, useAddItemImages, useItemTags, BulkUploadResponse } from '@/lib/hooks/use-items';
import { useFeatures } from '@/lib/hooks/use-features';
import { useClothingTypes, useClothingColors } from '@/lib/hooks/use-translated-constants';
import { TagInput } from '@/components/tag-input';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Item } from '@/lib/types';
import { useTranslations } from 'next-intl';

interface AddItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FileWithPreview {
  file: File;
  preview: string;
  id: string;
}

// The single-tab inputs that map to a column the tagging worker writes. Keys are
// the backend field names, because they travel to it verbatim as ai_excluded_fields.
type AiField = 'type' | 'name' | 'brand' | 'primary_color' | 'user_tags';
const AI_FIELDS: AiField[] = ['type', 'name', 'brand', 'primary_color', 'user_tags'];

/** Marks whether AI will fill a field. Lit = it will; dimmed = hands off. */
function AiFieldToggle({
  on,
  onToggle,
  title,
}: {
  on: boolean;
  onToggle: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={title}
      aria-label={title}
      aria-pressed={on}
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors',
        on ? 'text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground'
      )}
    >
      <Sparkles className="h-3.5 w-3.5" />
    </button>
  );
}

export function AddItemDialog({ open, onOpenChange }: AddItemDialogProps) {
  const t = useTranslations('wardrobe.addItem');
  const tc = useTranslations('common');
  const clothingTypes = useClothingTypes();
  const clothingColors = useClothingColors();
  // Single upload state - files[0] becomes the item's primary image, the rest are
  // uploaded to POST /items/{id}/images right after creation.
  const [files, setFiles] = useState<FileWithPreview[]>([]);
  const [type, setType] = useState('');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  // On = let the AI fill it. Typing flips a field off automatically; the toggle is
  // how you turn it back on, or mute a field you want left blank.
  const [aiFields, setAiFields] = useState<Record<AiField, boolean>>({
    type: true,
    name: true,
    brand: true,
    primary_color: true,
    user_tags: true,
  });
  const [duplicate, setDuplicate] = useState<{ item: Item; distance: number } | null>(null);

  // Bulk upload state
  const [bulkFiles, setBulkFiles] = useState<FileWithPreview[]>([]);
  const [bulkResult, setBulkResult] = useState<BulkUploadResponse | null>(null);
  const [skipAi, setSkipAi] = useState(false);
  const [activeTab, setActiveTab] = useState('single');
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // Track blob URLs for cleanup on unmount
  const blobUrlsRef = useRef<Set<string>>(new Set());

  const createItem = useCreateItem();
  const bulkCreateItems = useBulkCreateItems();
  const addImages = useAddItemImages();
  const { data: features } = useFeatures();
  const { data: tagDistribution } = useItemTags();
  const maxItemImages = features?.max_item_images ?? 20;

  // Cleanup blob URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      blobUrlsRef.current.clear();
    };
  }, []);

  const withPreviews = useCallback((acceptedFiles: File[]): FileWithPreview[] =>
    acceptedFiles.map((file) => {
      const preview = URL.createObjectURL(file);
      blobUrlsRef.current.add(preview);
      return {
        file,
        preview,
        id: `${file.name}-${Date.now()}-${Math.random()}`,
      };
    }), []);

  const revoke = useCallback((f: FileWithPreview) => {
    URL.revokeObjectURL(f.preview);
    blobUrlsRef.current.delete(f.preview);
  }, []);

  // Single file drop handler
  const onDropSingle = useCallback((acceptedFiles: File[]) => {
    setFiles((prev) => [...prev, ...withPreviews(acceptedFiles)]);
  }, [withPreviews]);

  // Bulk file drop handler
  const onDropBulk = useCallback((acceptedFiles: File[]) => {
    setBulkFiles((prev) => [...prev, ...withPreviews(acceptedFiles)]);
  }, [withPreviews]);

  const { getRootProps: getSingleRootProps, getInputProps: getSingleInputProps, isDragActive: isSingleDragActive } = useDropzone({
    onDrop: onDropSingle,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp', '.heic', '.heif'],
    },
    multiple: true,
  });

  const { getRootProps: getBulkRootProps, getInputProps: getBulkInputProps, isDragActive: isBulkDragActive } = useDropzone({
    onDrop: onDropBulk,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp', '.heic', '.heif'],
    },
    multiple: true,
  });

  const setAiField = (field: AiField, on: boolean) =>
    setAiFields((prev) => (prev[field] === on ? prev : { ...prev, [field]: on }));

  // Rebuilt per attempt rather than mutated, so the "add anyway" retry can't
  // accumulate a second `force` entry on the same FormData.
  const buildSingleFormData = (force: boolean) => {
    const formData = new FormData();
    formData.append('image', files[0].file);
    // Type is optional - AI will detect if not provided
    if (type) formData.append('type', type);
    if (name) formData.append('name', name);
    if (brand) formData.append('brand', brand);
    if (primaryColor) formData.append('primary_color', primaryColor);
    if (notes) formData.append('notes', notes);
    if (tags.length) formData.append('user_tags', tags.join(','));
    const muted = AI_FIELDS.filter((f) => !aiFields[f]);
    if (muted.length) formData.append('ai_excluded_fields', muted.join(','));
    if (force) formData.append('force', 'true');
    return formData;
  };

  const submitSingle = async (force: boolean) => {
    if (files.length === 0) return;

    let created: { id: string };
    try {
      created = await createItem.mutateAsync(buildSingleFormData(force));
    } catch (error) {
      // A near-identical photo is a warning, not a wall: show what it matched and
      // let the user decide, instead of leaving them with a toast and no way past.
      const detail =
        error instanceof ApiError && error.status === 409
          ? (error.data as { detail?: { code?: string; item?: Item; distance?: number } })?.detail
          : undefined;
      if (detail?.code === 'duplicate_item' && detail.item) {
        setDuplicate({ item: detail.item, distance: detail.distance ?? 0 });
        return;
      }
      console.error('Failed to create item:', error);
      return;
    }
    setDuplicate(null);

    // The item exists from here on, so a failed gallery upload must not read as
    // "nothing was created" - warn and close either way.
    const rest = files.slice(1).map((f) => f.file);
    if (rest.length > 0) {
      try {
        const result = await addImages.mutateAsync({ itemId: created.id, files: rest });
        if (result.errors?.length) {
          toast.warning(t('extraImagesFailed', { count: result.errors.length }));
        }
      } catch (error) {
        console.error('Failed to upload additional images:', error);
        toast.warning(t('extraImagesFailed', { count: rest.length }));
      }
    }

    handleClose();
  };

  const handleSingleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitSingle(false);
  };

  const handleBulkSubmit = async () => {
    if (bulkFiles.length === 0) return;

    try {
      const result = await bulkCreateItems.mutateAsync({
        files: bulkFiles.map((f) => f.file),
        skipAi,
      });

      if (result.staged > 0) {
        toast.success(t('bulk.queued', { count: result.staged }));
      }

      if (result.unprotected) {
        // These files couldn't be durably staged and went through today's
        // direct upload path instead - it already has a real result to show,
        // same results screen as before.
        const { successful, failed } = result.unprotected;
        if (failed === 0) {
          toast.success(t('bulk.allSuccess', { count: successful }));
        } else if (successful === 0) {
          toast.error(t('bulk.allFailed', { count: failed }));
        } else {
          toast.warning(t('bulk.partial', { success: successful, failed }));
        }
        setBulkResult(result.unprotected);
      } else {
        // Everything was staged - nothing to review synchronously, the
        // dashboard-wide upload indicator now owns reporting progress.
        handleClose();
      }
    } catch (error) {
      console.error('Failed to bulk upload:', error);
      toast.error(t('bulk.uploadError'));
    }
  };

  // Check if there are unsaved files that would be lost on close
  const hasUnsavedFiles = files.length > 0 || (bulkFiles.length > 0 && !bulkResult);

  const handleCloseRequest = () => {
    // Show confirmation if there are unsaved files and not currently uploading
    if (hasUnsavedFiles && !createItem.isPending && !addImages.isPending && !bulkCreateItems.isPending) {
      setShowCloseConfirm(true);
    } else {
      handleClose();
    }
  };

  const handleClose = () => {
    // Single upload cleanup
    files.forEach(revoke);
    setFiles([]);
    setType('');
    setName('');
    setBrand('');
    setPrimaryColor('');
    setNotes('');
    setTags([]);
    setAiFields({ type: true, name: true, brand: true, primary_color: true, user_tags: true });
    setDuplicate(null);

    // Bulk upload cleanup - also clean up from the ref
    bulkFiles.forEach(revoke);
    setBulkFiles([]);
    setBulkResult(null);
    setSkipAi(false);
    setActiveTab('single');
    setShowCloseConfirm(false);

    onOpenChange(false);
  };

  const removeSingleFile = (id: string) => {
    setFiles((prev) => {
      const fileToRemove = prev.find((f) => f.id === id);
      if (fileToRemove) revoke(fileToRemove);
      return prev.filter((f) => f.id !== id);
    });
  };

  const removeBulkFile = (id: string) => {
    setBulkFiles((prev) => {
      const fileToRemove = prev.find((f) => f.id === id);
      if (fileToRemove) revoke(fileToRemove);
      return prev.filter((f) => f.id !== id);
    });
  };

  const clearBulkFiles = () => {
    bulkFiles.forEach(revoke);
    setBulkFiles([]);
    setBulkResult(null);
    setSkipAi(false);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={handleCloseRequest}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t('subtitle')}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="single">{t('singleItem')}</TabsTrigger>
            <TabsTrigger value="bulk">{t('bulkUpload')}</TabsTrigger>
          </TabsList>

          {/* Single Item Upload */}
          <TabsContent value="single" className="space-y-4">
            <form onSubmit={handleSingleSubmit} className="space-y-4">
              {/* files[0] is the primary image, the rest become the item's gallery */}
              {files.length > 0 && (
                <div className="relative">
                  <img
                    src={files[0].preview}
                    alt={t('previewAlt')}
                    className="w-full h-48 object-cover rounded-lg"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2 h-8 w-8"
                    onClick={() => removeSingleFile(files[0].id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {files.length > 1 && (
                <div className="grid grid-cols-4 gap-2">
                  {files.slice(1).map((f) => (
                    <div key={f.id} className="relative group">
                      <img
                        src={f.preview}
                        alt={f.file.name}
                        className="w-full aspect-square object-cover rounded-md"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => removeSingleFile(f.id)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {files.length < 1 + maxItemImages && (
                <div
                  {...getSingleRootProps()}
                  className={`border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors ${
                    files.length > 0 ? 'p-4' : 'p-8'
                  } ${
                    isSingleDragActive
                      ? 'border-primary bg-primary/5'
                      : 'border-muted-foreground/25 hover:border-primary/50'
                  }`}
                >
                  <input {...getSingleInputProps()} />
                  <Upload
                    className={`mx-auto text-muted-foreground ${files.length > 0 ? 'h-8 w-8' : 'h-12 w-12'}`}
                  />
                  <p className="mt-2 text-sm text-muted-foreground">
                    {isSingleDragActive
                      ? t('dropzoneActive')
                      : t('dropzone')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {files.length > 0
                      ? t('imageCountHint', { count: files.length, max: 1 + maxItemImages })
                      : t('formatHint')}
                  </p>
                </div>
              )}

              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="type">{t('typeLabel')}</Label>
                    <AiFieldToggle
                      on={aiFields.type}
                      onToggle={() => setAiField('type', !aiFields.type)}
                      title={t(aiFields.type ? 'aiField.on' : 'aiField.off')}
                    />
                  </div>
                  <Select
                    value={type}
                    onValueChange={(v) => {
                      setType(v);
                      setAiField('type', false);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('letAiDetect')} />
                    </SelectTrigger>
                    <SelectContent>
                      {clothingTypes.map((ct) => (
                        <SelectItem key={ct.value} value={ct.value}>
                          {ct.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="name">{t('namePlaceholder')}</Label>
                    <AiFieldToggle
                      on={aiFields.name}
                      onToggle={() => setAiField('name', !aiFields.name)}
                      title={t(aiFields.name ? 'aiField.on' : 'aiField.off')}
                    />
                  </div>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setAiField('name', false);
                    }}
                    placeholder={t('nameInputPlaceholder')}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="brand">{t('brandPlaceholder')}</Label>
                      <AiFieldToggle
                        on={aiFields.brand}
                        onToggle={() => setAiField('brand', !aiFields.brand)}
                        title={t(aiFields.brand ? 'aiField.on' : 'aiField.off')}
                      />
                    </div>
                    <Input
                      id="brand"
                      value={brand}
                      onChange={(e) => {
                        setBrand(e.target.value);
                        setAiField('brand', false);
                      }}
                      placeholder={t('brandInputPlaceholder')}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="color">{t('primaryColor')}</Label>
                      <AiFieldToggle
                        on={aiFields.primary_color}
                        onToggle={() => setAiField('primary_color', !aiFields.primary_color)}
                        title={t(aiFields.primary_color ? 'aiField.on' : 'aiField.off')}
                      />
                    </div>
                    <Select
                      value={primaryColor}
                      onValueChange={(v) => {
                        setPrimaryColor(v);
                        setAiField('primary_color', false);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('selectPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {clothingColors.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            <div className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-full border"
                                style={{ backgroundColor: c.hex }}
                              />
                              {c.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">{t('aiField.hint')}</p>

                <div className="space-y-2">
                  <Label htmlFor="notes">{t('notesPlaceholder')}</Label>
                  <Input
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t('notesInputPlaceholder')}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label>{t('tagsLabel')}</Label>
                    <AiFieldToggle
                      on={aiFields.user_tags}
                      onToggle={() => setAiField('user_tags', !aiFields.user_tags)}
                      title={t(aiFields.user_tags ? 'aiField.onTags' : 'aiField.off')}
                    />
                  </div>
                  <TagInput
                    value={tags}
                    onChange={(next) => {
                      setTags(next);
                      setAiField('user_tags', false);
                    }}
                    suggestions={tagDistribution || []}
                    placeholder={t('tagsInputPlaceholder')}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={handleCloseRequest}>
                  {tc('cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={files.length === 0 || createItem.isPending || addImages.isPending}
                >
                  {createItem.isPending || addImages.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('uploading')}
                    </>
                  ) : (
                    t('submit')
                  )}
                </Button>
              </div>
            </form>
          </TabsContent>

          {/* Bulk Upload */}
          <TabsContent value="bulk" className="space-y-4">
            {!bulkResult ? (
              <>
                <div
                  {...getBulkRootProps()}
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                    isBulkDragActive
                      ? 'border-primary bg-primary/5'
                      : 'border-muted-foreground/25 hover:border-primary/50'
                  }`}
                >
                  <input {...getBulkInputProps()} />
                  <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    {isBulkDragActive
                      ? t('dropzoneActive')
                      : t('dropzone')}
                  </p>
                </div>

                {bulkFiles.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">
                        {t('bulk.imageCount', { count: bulkFiles.length })}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={clearBulkFiles}
                      >
                        {t('bulk.clearAll')}
                      </Button>
                    </div>

                    <ScrollArea className="h-[200px] rounded-md border p-2">
                      <div className="grid grid-cols-4 gap-2">
                        {bulkFiles.map((f) => (
                          <div key={f.id} className="relative group">
                            <img
                              src={f.preview}
                              alt={f.file.name}
                              className="w-full aspect-square object-cover rounded-md"
                            />
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon"
                              className="absolute top-1 right-1 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => removeBulkFile(f.id)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                            <p className="text-[10px] text-muted-foreground truncate mt-1 px-1">
                              {f.file.name}
                            </p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>

                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="skip-ai"
                        checked={skipAi}
                        onCheckedChange={(checked) => setSkipAi(checked === true)}
                      />
                      <Label htmlFor="skip-ai" className="text-xs font-normal text-muted-foreground">
                        {t('bulk.skipAi')}
                      </Label>
                    </div>
                    {!skipAi && (
                      <p className="text-xs text-muted-foreground">
                        {t('bulk.hint')}
                      </p>
                    )}
                  </div>
                )}

                {bulkCreateItems.isPending && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">{t('bulk.uploadingCount', { count: bulkFiles.length })}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">{bulkCreateItems.uploadProgress}%</span>
                    </div>
                    <Progress value={bulkCreateItems.uploadProgress} className="h-2" />
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={handleCloseRequest}>
                    {tc('cancel')}
                  </Button>
                  <Button
                    onClick={handleBulkSubmit}
                    disabled={bulkFiles.length === 0 || bulkCreateItems.isPending}
                  >
                    {bulkCreateItems.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t('uploading')}
                      </>
                    ) : (
                      <>
                        <Upload className="mr-2 h-4 w-4" />
                        {t('bulk.uploadButton', { count: bulkFiles.length })}
                      </>
                    )}
                  </Button>
                </div>
              </>
            ) : (
              /* Bulk Upload Results */
              <div className="space-y-4">
                <div className="flex items-center justify-center gap-3 py-4">
                  {bulkResult.failed === 0 ? (
                    <CheckCircle2 className="h-12 w-12 text-green-500" />
                  ) : bulkResult.successful === 0 ? (
                    <AlertCircle className="h-12 w-12 text-destructive" />
                  ) : (
                    <AlertCircle className="h-12 w-12 text-yellow-500" />
                  )}
                </div>

                <div className="text-center">
                  <p className="text-lg font-medium">
                    {t('bulk.resultSuccess', { success: bulkResult.successful, total: bulkResult.total })}
                  </p>
                  {bulkResult.failed > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t('bulk.resultFailed', { count: bulkResult.failed })}
                    </p>
                  )}
                </div>

                <ScrollArea className="h-[200px] rounded-md border">
                  <div className="p-3 space-y-2">
                    {bulkResult.results.map((result, index) => (
                      <div
                        key={index}
                        className={`flex items-center gap-3 p-2 rounded-md ${
                          result.success ? 'bg-green-500/10' : 'bg-destructive/10'
                        }`}
                      >
                        {result.success ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{result.filename}</p>
                          {result.error && (
                            <p className="text-xs text-destructive">{result.error}</p>
                          )}
                        </div>
                        {result.item && (
                          <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={clearBulkFiles}>
                    {t('bulk.uploadMore')}
                  </Button>
                  <Button onClick={handleClose}>
                    {tc('done')}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>

    <AlertDialog open={duplicate !== null} onOpenChange={(open) => !open && setDuplicate(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('duplicate.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {duplicate?.distance === 0 ? t('duplicate.exact') : t('duplicate.similar')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {duplicate && (
          <div className="flex items-center gap-3 rounded-lg border p-3">
            {duplicate.item.thumbnail_url && (
              <img
                src={duplicate.item.thumbnail_url}
                alt={duplicate.item.name || duplicate.item.type}
                className="h-16 w-16 rounded-md object-cover"
              />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {duplicate.item.name || duplicate.item.type}
              </p>
              {duplicate.item.brand && (
                <p className="truncate text-xs text-muted-foreground">{duplicate.item.brand}</p>
              )}
            </div>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('duplicate.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Radix closes the dialog on action click; the state reset in
              // submitSingle's success path would otherwise fight the retry.
              e.preventDefault();
              void submitSingle(true);
            }}
            disabled={createItem.isPending}
          >
            {t('duplicate.addAnyway')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('bulk.discardConfirm.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {activeTab === 'single'
              ? files.length === 1
                ? t('bulk.discardConfirm.singleImage')
                : t('bulk.discardConfirm.imageCount', { count: files.length })
              : t('bulk.discardConfirm.imageCount', { count: bulkFiles.length })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('bulk.discardConfirm.keepEditing')}</AlertDialogCancel>
          <AlertDialogAction onClick={handleClose}>{t('bulk.discardConfirm.discard')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
