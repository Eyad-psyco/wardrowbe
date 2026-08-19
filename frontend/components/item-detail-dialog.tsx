'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import {
  Heart,
  Pencil,
  Trash2,
  X,
  Loader2,
  Calendar,
  Tag,
  Palette,
  Shirt,
  Sparkles,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Eraser,
  Undo2,
  ImagePlus,
  Layers,
  Droplets,
  ChevronDown,
  Plus,
  Star,
  Lock,
  Users,
  GripVertical,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { useDropzone } from 'react-dropzone';
import { useUpdateItem, useDeleteItem, useReanalyzeItem, useRotateImage, useRemoveBackground, useRestoreOriginal, useReplaceItemImage, useLogWash, useWashHistory, useItemWearStats, useItemWearHistory, useAddItemImages, useDeleteItemImage, useSetPrimaryImage, useReorderItemImages, useItemTags } from '@/lib/hooks/use-items';
import { Item } from '@/lib/types';
import { useClothingTypes, useClothingColors } from '@/lib/hooks/use-translated-constants';
import { ColorEyedropper } from '@/components/color-eyedropper';
import { ColorPicker } from '@/components/color-picker';
import { TagInput } from '@/components/tag-input';
import { ImageCarousel } from '@/components/image-carousel';
import { GeneratePairingsDialog } from '@/components/generate-pairings-dialog';
import { useFeatures } from '@/lib/hooks/use-features';
import { useTranslations } from 'next-intl';

interface ItemDetailDialogProps {
  item: Item | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Another family member's item: view only, no edit, no mutations, no owner-scoped queries
  readOnly?: boolean;
}

// Images now use signed URLs from backend (item.image_url, item.thumbnail_url)

export function ItemDetailDialog({ item, open, onOpenChange, readOnly = false }: ItemDetailDialogProps) {
  const t = useTranslations('wardrobe.itemDetail');
  const tc = useTranslations('common');
  const tw = useTranslations('wardrobe');
  const clothingTypes = useClothingTypes();
  const clothingColors = useClothingColors();
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPairingsDialog, setShowPairingsDialog] = useState(false);
  const [imageKey, setImageKey] = useState(0);
  const [editForm, setEditForm] = useState({
    name: '',
    type: '',
    subtype: '',
    brand: '',
    primary_color: '',
    notes: '',
    favorite: false,
    wash_interval: undefined as number | undefined,
    secondary_colors: [] as string[],
    user_tags: [] as string[],
    is_public: false,
  });
  const [showWashHistory, setShowWashHistory] = useState(false);
  const [showWearHistory, setShowWearHistory] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const updateItem = useUpdateItem();
  const deleteItem = useDeleteItem();
  const reanalyzeItem = useReanalyzeItem();
  const rotateImage = useRotateImage();
  const removeBackground = useRemoveBackground();
  const restoreOriginal = useRestoreOriginal();
  const replaceImage = useReplaceItemImage();
  const replaceImageInputRef = useRef<HTMLInputElement>(null);
  const { data: features } = useFeatures();
  const logWash = useLogWash();
  // Owner-scoped endpoints 404 for other family members, so they're not asked for.
  const ownedId = readOnly ? '' : item?.id || '';
  const { data: washHistory } = useWashHistory(ownedId);
  const { data: wearStats } = useItemWearStats(ownedId);
  const { data: wearHistory } = useItemWearHistory(ownedId, 20);
  const { data: tagDistribution } = useItemTags();
  const addImages = useAddItemImages();
  const deleteImage = useDeleteItemImage();
  const setPrimary = useSetPrimaryImage();
  const reorderImages = useReorderItemImages();
  const maxItemImages = features?.max_item_images ?? 20;

  useEffect(() => {
    if (item) {
      setEditForm({
        name: item.name || '',
        type: item.type,
        subtype: item.subtype || '',
        brand: item.brand || '',
        primary_color: item.primary_color || '',
        notes: item.notes || '',
        favorite: item.favorite,
        wash_interval: item.wash_interval ?? undefined,
        secondary_colors: (item.colors || []).filter((c) => c !== item.primary_color),
        user_tags: item.user_tags || [],
        is_public: item.is_public,
      });
      setIsEditing(false);
      setActiveImageIndex(0);
    }
  }, [item?.id]);

  const additionalImages = item?.additional_images || [];

  const handleAddImages = async (files: File[]) => {
    if (!item || files.length === 0) return;
    const room = maxItemImages - additionalImages.length;
    if (room <= 0) return;
    try {
      const result = await addImages.mutateAsync({ itemId: item.id, files: files.slice(0, room) });
      result.errors.forEach((message) => toast.error(message));
    } catch (error) {
      console.error('Failed to add images:', error);
      toast.error(t('actions.addImagesError'));
    }
  };

  // Declared above the `!item` bail-out because hooks must run in the same order
  // on every render.
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleAddImages,
    accept: { 'image/*': [] },
    noClick: true,
    disabled: !isEditing || additionalImages.length >= maxItemImages,
  });

  if (!item) return null;

  const handleSave = async () => {
    try {
      await updateItem.mutateAsync({
        id: item.id,
        data: {
          name: editForm.name || undefined,
          type: editForm.type,
          subtype: editForm.subtype || undefined,
          brand: editForm.brand || undefined,
          primary_color: editForm.primary_color || undefined,
          notes: editForm.notes || undefined,
          favorite: editForm.favorite,
          wash_interval: editForm.wash_interval,
          user_tags: editForm.user_tags,
          is_public: editForm.is_public,
          // `colors` only, never `tags`: ItemService.update mirrors tags -> columns
          // and the two would fight. tags.colors staying stale matches what
          // primary_color already does today.
          colors: Array.from(
            new Set([editForm.primary_color, ...editForm.secondary_colors].filter(Boolean))
          ) as string[],
        },
      });
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update item:', error);
    }
  };

  const handleMarkWashed = async () => {
    try {
      await logWash.mutateAsync({ id: item.id });
      toast.success(t('actions.washed'));
    } catch (error) {
      console.error('Failed to log wash:', error);
      toast.error(t('actions.washError'));
    }
  };

  const handleDelete = async () => {
    try {
      await deleteItem.mutateAsync(item.id);
      setShowDeleteConfirm(false);
      onOpenChange(false);
      toast.success(t('actions.deleted'), {
        description: item.name ? t('actions.deletedWithName', { name: item.name }) : t('actions.deletedFallback'),
      });
    } catch (error) {
      console.error('Failed to delete item:', error);
      toast.error(t('actions.deleteError'), {
        description: t('actions.deleteErrorDescription'),
      });
    }
  };

  const handleToggleFavorite = async () => {
    try {
      await updateItem.mutateAsync({
        id: item.id,
        data: { favorite: !item.favorite },
      });
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  };

  const handleReanalyze = async () => {
    try {
      const result = await reanalyzeItem.mutateAsync(item.id);
      if (result.status === 'cooldown' && result.retry_after_seconds) {
        toast.info(tw('ai.retryCooldown', { seconds: result.retry_after_seconds }));
      }
      // Otherwise status will update to 'processing' and UI will reflect it
    } catch (error) {
      console.error('Failed to trigger re-analysis:', error);
    }
  };

  const handleRotate = async (direction: 'cw' | 'ccw') => {
    try {
      await rotateImage.mutateAsync({ id: item.id, direction });
      setImageKey((k) => k + 1);
      toast.success(t('actions.imageRotated'));
    } catch (error) {
      console.error('Failed to rotate image:', error);
      toast.error(t('actions.imageRotateError'));
    }
  };

  const handleRemoveBackground = async () => {
    try {
      await removeBackground.mutateAsync({ id: item.id });
      setImageKey((k) => k + 1);
      toast.success(t('actions.backgroundRemoved'));
    } catch (error) {
      console.error('Failed to remove background:', error);
      toast.error(t('actions.backgroundRemoveError'));
    }
  };

  const handleRestoreOriginal = async () => {
    try {
      await restoreOriginal.mutateAsync(item.id);
      setImageKey((k) => k + 1);
      toast.success(t('actions.originalRestored'));
    } catch (error) {
      console.error('Failed to restore original image:', error);
      toast.error(t('actions.originalRestoreError'));
    }
  };

  const handleReplaceImage = async (file: File) => {
    try {
      await replaceImage.mutateAsync({ itemId: item.id, file });
      setImageKey((k) => k + 1);
      setActiveImageIndex(0);
      toast.success(t('actions.imageReplaced'));
    } catch (error) {
      console.error('Failed to replace image:', error);
      toast.error(t('actions.imageReplaceError'));
    }
  };

  // Index 0 is the primary image, which lives on clothing_items rather than in
  // item_images - dropping onto it has to swap the primary, not reorder a list.
  const handleDropOn = (to: number) => {
    const from = dragFrom;
    setDragFrom(null);
    if (from === null || from === to || from === 0) return;
    const dragged = additionalImages[from - 1];
    if (!dragged) return;

    if (to === 0) {
      setPrimary.mutate({ itemId: item.id, imageId: dragged.id });
      setActiveImageIndex(0);
      return;
    }

    const next = additionalImages.filter((_, i) => i !== from - 1);
    next.splice(to - 1, 0, dragged);
    setActiveImageIndex(to);
    reorderImages.mutate({ itemId: item.id, imageIds: next.map((img) => img.id) });
  };

  const isAnalyzing = reanalyzeItem.isPending || item.status === 'processing';

  // Use signed URL from backend for better quality in detail view
  const imageUrl = item.image_url || item.image_path;
  const itemColors = (item.colors?.length ? item.colors : [item.primary_color])
    .filter(Boolean)
    .map((c) => clothingColors.find((cc) => cc.value === c))
    .filter((c): c is (typeof clothingColors)[number] => !!c);
  const typeInfo = clothingTypes.find((type) => type.value === item.type);

  // AI-generated tags
  const tags = item.tags || {};
  const hasAiTags = !!(tags.colors?.length || tags.pattern || tags.material ||
                   tags.style?.length || tags.season?.length || tags.formality || tags.fit ||
                   tags.occasion?.length || tags.condition || tags.features?.length);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden [&>button]:hidden">
          {/* Header - sticky */}
          <DialogHeader className="flex flex-row items-center justify-between space-y-0 p-4 border-b flex-shrink-0">
            <DialogTitle className="text-xl min-w-0 truncate">
              {item.name || (typeInfo ? typeInfo.label : item.type)}
            </DialogTitle>
            <div className="flex items-center gap-1">
              {!readOnly && (
                <>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleToggleFavorite}
                disabled={updateItem.isPending}
                title={t('titles.toggleFavorite')}
              >
                <Heart
                  className={`h-5 w-5 ${
                    item.favorite ? 'fill-red-500 text-red-500' : 'text-muted-foreground'
                  }`}
                />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowPairingsDialog(true)}
                disabled={item.status !== 'ready'}
                title={t('titles.findMatchingOutfits')}
              >
                <Layers className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleReanalyze}
                disabled={isAnalyzing}
                title={isAnalyzing ? t('titles.analysisInProgress') : t('titles.reanalyzeWithAI')}
              >
                <RefreshCw
                  className={`h-5 w-5 ${isAnalyzing ? 'animate-spin text-primary' : ''}`}
                />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleRotate('ccw')}
                disabled={rotateImage.isPending}
                title={t('titles.rotateLeft')}
              >
                {rotateImage.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <RotateCcw className="h-5 w-5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleRotate('cw')}
                disabled={rotateImage.isPending}
                title={t('titles.rotateRight')}
              >
                {rotateImage.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <RotateCw className="h-5 w-5" />
                )}
              </Button>
              {features?.background_removal && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleRemoveBackground}
                  disabled={removeBackground.isPending || !item.image_url}
                  title={t('titles.removeBackground')}
                >
                  {removeBackground.isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Eraser className="h-5 w-5" />
                  )}
                </Button>
              )}
              {item.original_image_path && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleRestoreOriginal}
                  disabled={restoreOriginal.isPending}
                  title={t('titles.undoBackgroundRemoval')}
                >
                  {restoreOriginal.isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Undo2 className="h-5 w-5" />
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => replaceImageInputRef.current?.click()}
                disabled={replaceImage.isPending}
                title={t('titles.replaceImage')}
              >
                {replaceImage.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <ImagePlus className="h-5 w-5" />
                )}
              </Button>
              <input
                ref={replaceImageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleReplaceImage(file);
                  }
                  e.target.value = '';
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsEditing(!isEditing)}
                title={isEditing ? t('actions.cancelEditing') : t('actions.editItem')}
              >
                {isEditing ? (
                  <X className="h-5 w-5" />
                ) : (
                  <Pencil className="h-5 w-5" />
                )}
              </Button>
                </>
              )}
              <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} className="rounded-full" title={tc('close')}>
                <X className="h-5 w-5" />
              </Button>
            </div>
          </DialogHeader>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto overscroll-contain p-6 pt-4">
            <div className="grid gap-6 sm:grid-cols-2 [&>*]:min-w-0">
            {/* Image Gallery */}
            <div className="space-y-2">
              <div className="relative aspect-square bg-muted rounded-lg overflow-hidden">
                <ImageCarousel
                  images={[
                    { url: `${imageUrl}&v=${imageKey}`, id: `primary-${imageKey}` },
                    ...additionalImages.map((img) => ({ url: img.image_url, id: img.id })),
                  ]}
                  alt={item.name || item.type}
                  sizes="(max-width: 640px) 100vw, 50vw"
                  index={activeImageIndex}
                  onIndexChange={setActiveImageIndex}
                />
                {isAnalyzing && (
                  <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
                    <Loader2 className="h-8 w-8 text-white animate-spin" />
                    <span className="text-white text-sm font-medium">{t('view.aiAnalyzing')}</span>
                  </div>
                )}
              </div>
              {/* Thumbnail strip - doubles as a dropzone while editing */}
              {(additionalImages.length > 0 || isEditing) && (
                <div
                  {...getRootProps({
                    className: `flex gap-1.5 overflow-x-auto rounded ${
                      isDragActive ? 'ring-2 ring-primary' : ''
                    }`,
                  })}
                >
                  <input {...getInputProps()} />
                  <button
                    className={`relative w-12 h-12 rounded border-2 overflow-hidden flex-shrink-0 ${activeImageIndex === 0 ? 'border-primary' : 'border-transparent'}`}
                    onClick={() => setActiveImageIndex(0)}
                    onDragOver={(e) => isEditing && e.preventDefault()}
                    onDrop={() => handleDropOn(0)}
                    title={t('view.primaryImage')}
                  >
                    <Image src={imageUrl} alt={t('view.primaryImage')} fill className="object-cover" sizes="48px" />
                  </button>
                  {additionalImages.map((img, idx) => (
                    <div
                      key={img.id}
                      className="relative flex-shrink-0"
                      draggable={isEditing}
                      onDragStart={() => setDragFrom(idx + 1)}
                      onDragOver={(e) => isEditing && e.preventDefault()}
                      onDrop={() => handleDropOn(idx + 1)}
                    >
                      <button
                        className={`relative w-12 h-12 rounded border-2 overflow-hidden ${activeImageIndex === idx + 1 ? 'border-primary' : 'border-transparent'}`}
                        onClick={() => setActiveImageIndex(idx + 1)}
                      >
                        <Image src={img.thumbnail_url || img.image_url} alt="" fill className="object-cover" sizes="48px" />
                      </button>
                      {isEditing && (
                        <>
                          <GripVertical className="absolute bottom-0 left-0 h-3 w-3 text-white drop-shadow" />
                          <div className="absolute -top-1 -right-1 flex gap-0.5">
                            <button
                              className="bg-primary text-primary-foreground rounded-full p-0.5 hover:bg-primary/90"
                              title={t('titles.setAsPrimary')}
                              onClick={() => {
                                setPrimary.mutate({ itemId: item.id, imageId: img.id });
                                setActiveImageIndex(0);
                              }}
                            >
                              <Star className="h-2.5 w-2.5" />
                            </button>
                            <button
                              className="bg-destructive text-destructive-foreground rounded-full p-0.5 hover:bg-destructive/90"
                              title={t('titles.deleteImage')}
                              onClick={() => {
                                deleteImage.mutate({ itemId: item.id, imageId: img.id });
                                if (activeImageIndex > idx) setActiveImageIndex((i) => i - 1);
                              }}
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {isEditing && additionalImages.length < maxItemImages && (
                    <label
                      className="w-12 h-12 rounded border-2 border-dashed border-muted-foreground/30 flex items-center justify-center cursor-pointer hover:border-primary/50 flex-shrink-0"
                      title={t('titles.addImages')}
                    >
                      {addImages.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <Plus className="h-4 w-4 text-muted-foreground" />
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          handleAddImages(Array.from(e.target.files || []));
                          e.target.value = '';
                        }}
                      />
                    </label>
                  )}
                </div>
              )}
            </div>

            {/* Details */}
            <div className="space-y-4">
              {isEditing ? (
                // Edit form
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>{t('name')}</Label>
                    <Input
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      placeholder={t('placeholders.itemName')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('type')}</Label>
                    <Select
                      value={editForm.type}
                      onValueChange={(v) => setEditForm({ ...editForm, type: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
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
                    <Label>{t('brand')}</Label>
                    <Input
                      value={editForm.brand}
                      onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })}
                      placeholder={t('placeholders.brandName')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('primaryColor')}</Label>
                    <div className="flex gap-2">
                      <Select
                        value={editForm.primary_color}
                        onValueChange={(v) => setEditForm({ ...editForm, primary_color: v })}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder={t('placeholders.selectColor')} />
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
                      <ColorEyedropper
                        imageUrl={imageUrl}
                        onColorSelect={(color) => setEditForm({ ...editForm, primary_color: color })}
                      />
                    </div>
                  </div>
                  <ColorPicker
                    label={t('secondaryColors')}
                    selected={editForm.secondary_colors}
                    onChange={(colors) =>
                      setEditForm({
                        ...editForm,
                        secondary_colors: colors.filter((c) => c !== editForm.primary_color),
                      })
                    }
                  />
                  <div className="space-y-2">
                    <Label>{t('tags')}</Label>
                    <TagInput
                      value={editForm.user_tags}
                      onChange={(user_tags) => setEditForm({ ...editForm, user_tags })}
                      suggestions={(tagDistribution || []).map((t) => t.tag)}
                      placeholder={t('placeholders.addTag')}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <Label className="flex items-center gap-1.5">
                        {editForm.is_public ? <Users className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                        {t('visibility.label')}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {editForm.is_public ? t('visibility.publicHint') : t('visibility.privateHint')}
                      </p>
                    </div>
                    <Switch
                      checked={editForm.is_public}
                      onCheckedChange={(is_public) => setEditForm({ ...editForm, is_public })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('notes')}</Label>
                    <Textarea
                      value={editForm.notes}
                      onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                      placeholder={t('placeholders.additionalNotes')}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('washInterval')} ({t('view.wears')})</Label>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={editForm.wash_interval ?? ''}
                      onChange={(e) => setEditForm({ ...editForm, wash_interval: e.target.value ? parseInt(e.target.value) : undefined })}
                      placeholder={t('placeholders.washIntervalDefault', { count: item.effective_wash_interval })}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('view.washIntervalHint')}
                    </p>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setIsEditing(false)}
                    >
                      {tc('cancel')}
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={handleSave}
                      disabled={updateItem.isPending}
                    >
                      {updateItem.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : null}
                      {tc('save')}
                    </Button>
                  </div>
                </div>
              ) : (
                // View mode
                <div className="space-y-4">
                  {/* Basic info */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Shirt className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{typeInfo ? typeInfo.label : item.type}</span>
                      {item.subtype && (
                        <span className="text-muted-foreground">• {item.subtype}</span>
                      )}
                    </div>
                    {item.brand && (
                      <div className="flex items-center gap-2 text-sm">
                        <Tag className="h-4 w-4 text-muted-foreground" />
                        <span>{item.brand}</span>
                      </div>
                    )}
                    {itemColors.length > 0 && (
                      <div className="flex items-center gap-2 text-sm flex-wrap">
                        <Palette className="h-4 w-4 text-muted-foreground shrink-0" />
                        {itemColors.map((c) => (
                          <span key={c.value} className="flex items-center gap-1.5">
                            <div
                              className="w-4 h-4 rounded-full border"
                              style={{ backgroundColor: c.hex }}
                            />
                            <span>{c.name}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {item.user_tags?.length > 0 && (
                      <div className="flex items-center gap-2 text-sm flex-wrap">
                        <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
                        {item.user_tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {!readOnly && (
                      <div className="flex items-center gap-2 text-sm">
                        {item.is_public ? (
                          <Users className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Lock className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-muted-foreground">
                          {item.is_public ? t('visibility.public') : t('visibility.private')}
                        </span>
                        <Switch
                          className="ml-auto"
                          checked={item.is_public}
                          disabled={updateItem.isPending}
                          onCheckedChange={(is_public) =>
                            updateItem.mutate({ id: item.id, data: { is_public } })
                          }
                        />
                      </div>
                    )}
                    {item.wear_count > 0 && (
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span>
                          {t('view.wornCount', { count: item.wear_count })}
                          {item.last_worn_at && (
                            <span className="text-muted-foreground">
                              {' '}{t('view.lastWornDate', { date: new Date(item.last_worn_at).toLocaleDateString() })}
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Wash Status */}
                  <div className="space-y-2 pt-2 border-t">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Droplets className={`h-4 w-4 ${item.needs_wash ? 'text-amber-500' : 'text-muted-foreground'}`} />
                        {t('view.washStatus')}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className={`h-7 text-xs ${readOnly ? 'hidden' : ''}`}
                        onClick={handleMarkWashed}
                        disabled={logWash.isPending}
                      >
                        {logWash.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Droplets className="h-3 w-3 mr-1" />
                        )}
                        {t('actions.markWashed')}
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{t('view.wearsSinceWash', { current: item.wears_since_wash, max: item.effective_wash_interval })}</span>
                        {item.needs_wash && (
                          <span className="text-amber-500 font-medium">{t('view.needsWashing')}</span>
                        )}
                      </div>
                      <Progress
                        value={Math.min((item.wears_since_wash / item.effective_wash_interval) * 100, 100)}
                        className={`h-2 ${item.needs_wash ? '[&>div]:bg-amber-500' : ''}`}
                      />
                      {item.last_washed_at && (
                        <p className="text-xs text-muted-foreground">
                          {t('view.lastWashed', { date: new Date(item.last_washed_at).toLocaleDateString() })}
                        </p>
                      )}
                    </div>

                    {/* Wash History */}
                    {washHistory && washHistory.length > 0 && (
                      <Collapsible open={showWashHistory} onOpenChange={setShowWashHistory}>
                        <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                          <ChevronDown className={`h-3 w-3 transition-transform ${showWashHistory ? 'rotate-180' : ''}`} />
                          {t('view.washHistory', { count: washHistory.length })}
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-1.5 space-y-1">
                          {washHistory.map((wash) => (
                            <div key={wash.id} className="text-xs text-muted-foreground flex items-center gap-2">
                              <span>{new Date(wash.washed_at).toLocaleDateString()}</span>
                              {wash.method && <Badge variant="outline" className="text-[10px] h-4">{wash.method}</Badge>}
                              {wash.notes && <span className="truncate">{wash.notes}</span>}
                            </div>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>

                  {/* Wear History */}
                  {item.wear_count > 0 && wearStats && (
                    <div className="space-y-2 pt-2 border-t">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        {t('view.wearHistory')}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-muted/50 rounded-md p-2">
                          <p className="text-muted-foreground">{t('view.totalWears')}</p>
                          <p className="font-medium text-sm">{wearStats.total_wears}</p>
                        </div>
                        <div className="bg-muted/50 rounded-md p-2">
                          <p className="text-muted-foreground">{t('view.lastWorn')}</p>
                          <p className="font-medium text-sm">
                            {wearStats.days_since_last_worn === null
                              ? t('view.never')
                              : wearStats.days_since_last_worn === 0
                              ? t('view.today')
                              : t('view.daysAgo', { count: wearStats.days_since_last_worn })}
                          </p>
                        </div>
                        <div className="bg-muted/50 rounded-md p-2">
                          <p className="text-muted-foreground">{t('view.avgPerMonth')}</p>
                          <p className="font-medium text-sm">{wearStats.average_wears_per_month}</p>
                        </div>
                        {wearStats.most_common_occasion && (
                          <div className="bg-muted/50 rounded-md p-2">
                            <p className="text-muted-foreground">{t('view.usualOccasion')}</p>
                            <p className="font-medium text-sm capitalize">{wearStats.most_common_occasion}</p>
                          </div>
                        )}
                      </div>

                      {/* Mini bar chart - wear by month */}
                      {Object.keys(wearStats.wear_by_month).length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">{t('view.last6Months')}</p>
                          <div className="flex items-end gap-1 h-12">
                            {Object.entries(wearStats.wear_by_month).map(([month, count]) => {
                              const maxCount = Math.max(...Object.values(wearStats.wear_by_month), 1);
                              const height = (count / maxCount) * 100;
                              return (
                                <div key={month} className="flex-1 flex flex-col items-center gap-0.5" title={t('view.monthWears', { month, count })}>
                                  <div
                                    className="w-full bg-primary/70 rounded-t-sm min-h-[2px]"
                                    style={{ height: `${Math.max(height, 4)}%` }}
                                  />
                                  <span className="text-[9px] text-muted-foreground">{month.split('-')[1]}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Wear timeline */}
                      {wearHistory && wearHistory.length > 0 && (
                        <Collapsible open={showWearHistory} onOpenChange={setShowWearHistory}>
                          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                            <ChevronDown className={`h-3 w-3 transition-transform ${showWearHistory ? 'rotate-180' : ''}`} />
                            {t('view.timeline', { count: wearHistory.length })}
                          </CollapsibleTrigger>
                          <CollapsibleContent className="mt-1.5 space-y-1.5">
                            {wearHistory.map((entry) => (
                              <div key={entry.id} className="text-xs flex items-start gap-2">
                                <span className="text-muted-foreground whitespace-nowrap">
                                  {new Date(entry.worn_at).toLocaleDateString()}
                                </span>
                                {entry.occasion && (
                                  <Badge variant="outline" className="text-[10px] h-4">{entry.occasion}</Badge>
                                )}
                                {entry.outfit && (
                                  <div className="flex -space-x-1">
                                    {entry.outfit.items.slice(0, 3).map((oi) => (
                                      <div
                                        key={oi.id}
                                        className="w-5 h-5 rounded-full bg-muted border-2 border-background overflow-hidden"
                                        title={oi.name || oi.type}
                                      >
                                        {oi.thumbnail_url && (
                                          <Image
                                            src={oi.thumbnail_url}
                                            alt={oi.name || oi.type}
                                            width={20}
                                            height={20}
                                            className="object-cover w-full h-full"
                                          />
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </div>
                  )}

                  {/* AI Analysis */}
                  {(hasAiTags || item.ai_description) && item.status === 'ready' && (
                    <div className="space-y-2 pt-2 border-t">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Sparkles className="h-4 w-4 text-primary" />
                        {t('view.aiAnalysis')}
                        {item.ai_confidence !== undefined && item.ai_confidence > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {t('view.complete', { percent: Math.round(item.ai_confidence * 100) })}
                          </Badge>
                        )}
                        {item.tags?.logprobs_confidence != null && (
                          <Badge variant="outline" className="text-xs">
                            {t('view.confident', { percent: Math.round(item.tags.logprobs_confidence * 100) })}
                          </Badge>
                        )}
                      </div>
                      {item.ai_description && (
                        <p className="text-sm text-muted-foreground italic">
                          &ldquo;{item.ai_description}&rdquo;
                        </p>
                      )}
                      {hasAiTags && <div className="flex flex-wrap gap-1.5">
                        {tags.colors?.map((color) => (
                          <Badge key={color} variant="outline" className="text-xs">
                            {color}
                          </Badge>
                        ))}
                        {tags.pattern && (
                          <Badge variant="outline" className="text-xs">
                            {tags.pattern}
                          </Badge>
                        )}
                        {tags.material && (
                          <Badge variant="outline" className="text-xs">
                            {tags.material}
                          </Badge>
                        )}
                        {tags.style?.map((s) => (
                          <Badge key={s} variant="outline" className="text-xs">
                            {s}
                          </Badge>
                        ))}
                        {tags.season?.map((s) => (
                          <Badge key={s} variant="outline" className="text-xs">
                            {s}
                          </Badge>
                        ))}
                        {tags.formality && (
                          <Badge variant="outline" className="text-xs">
                            {tags.formality}
                          </Badge>
                        )}
                        {tags.fit && (
                          <Badge variant="outline" className="text-xs">
                            {tags.fit ? t('view.fitBadge', { fit: tags.fit }) : null}
                          </Badge>
                        )}
                        {tags.occasion?.map((o: string) => (
                          <Badge key={o} variant="outline" className="text-xs">
                            {o}
                          </Badge>
                        ))}
                        {tags.condition && (
                          <Badge variant="outline" className="text-xs">
                            {tags.condition}
                          </Badge>
                        )}
                        {tags.features?.map((f: string) => (
                          <Badge key={f} variant="outline" className="text-xs">
                            {f}
                          </Badge>
                        ))}
                      </div>}
                    </div>
                  )}

                  {/* Notes */}
                  {item.notes && (
                    <div className="space-y-1 pt-2 border-t">
                      <p className="text-sm font-medium">{t('notes')}</p>
                      <p className="text-sm text-muted-foreground">{item.notes}</p>
                    </div>
                  )}

                  {/* Metadata */}
                  <div className="text-xs text-muted-foreground pt-2 border-t">
                    {t('view.addedDate', { date: new Date(item.created_at).toLocaleDateString() })}
                  </div>
                </div>
              )}
            </div>
            </div>

            {/* Delete button - separated from other actions for safety */}
            {!isEditing && !readOnly && (
              <div className="pt-4 border-t mt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t('actions.deleteItem')}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('actions.deleteConfirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('actions.deleteDescription', { name: item.name || item.type })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteItem.isPending}
            >
              {deleteItem.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {tc('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Generate Pairings Dialog */}
      <GeneratePairingsDialog
        item={item}
        open={showPairingsDialog}
        onOpenChange={setShowPairingsDialog}
      />
    </>
  );
}
