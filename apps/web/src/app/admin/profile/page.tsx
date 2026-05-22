'use client';

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { updateMe, purgeAllFiles, uploadMyAvatar, deleteMyAvatar } from '@/lib/api';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

function initials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function AdminProfilePage() {
  const { user, accessToken, setAccessToken, setUser } = useAuth();

  // Форма «Личные данные» (имя + email).
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [savingInfo, setSavingInfo] = useState(false);

  // Форма «Смена пароля».
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Обслуживание: удаление всех загруженных файлов (сброс тестовых данных).
  const [purging, setPurging] = useState(false);

  // Аватар.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);

  if (!user) return null;

  const infoChanged =
    name.trim() !== user.name || email.trim().toLowerCase() !== user.email.toLowerCase();

  async function handleInfoSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken || !user) return;

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      toast.error('Имя не может быть пустым');
      return;
    }
    if (!trimmedEmail) {
      toast.error('Email не может быть пустым');
      return;
    }

    setSavingInfo(true);
    try {
      const result = await updateMe(accessToken, {
        name: trimmedName,
        email: trimmedEmail,
      });
      // Обновляем кэш пользователя в auth-context, чтобы UI (сайдбар и т.д.)
      // показывал актуальные имя и email сразу.
      setUser({ ...user, name: result.user.name, email: result.user.email });
      setName(result.user.name);
      setEmail(result.user.email);
      toast.success('Данные сохранены');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSavingInfo(false);
    }
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken || !user) return;

    if (!currentPassword) {
      toast.error('Введите текущий пароль');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('Новый пароль должен быть не менее 6 символов');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Пароли не совпадают');
      return;
    }

    setSavingPassword(true);
    try {
      const result = await updateMe(accessToken, {
        currentPassword,
        newPassword,
      });
      // Сервер выдаёт новый access-токен после смены пароля — заменяем текущий,
      // чтобы сессия продолжила работать (старые refresh-токены инвалидированы).
      if (result.accessToken) setAccessToken(result.accessToken);
      setUser({ ...user, mustChangePassword: false });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Пароль изменён');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка смены пароля');
    } finally {
      setSavingPassword(false);
    }
  }

  async function handlePurgeFiles() {
    if (!accessToken) return;
    setPurging(true);
    try {
      const r = await purgeAllFiles(accessToken);
      toast.success(`Удалено файлов: ${r.deletedFiles}. Ссылки очищены.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка удаления файлов');
    } finally {
      setPurging(false);
    }
  }

  async function handleAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Сбрасываем значение, чтобы повторный выбор того же файла снова срабатывал.
    e.target.value = '';
    if (!file || !accessToken || !user) return;

    setUploadingAvatar(true);
    try {
      const { avatarUrl } = await uploadMyAvatar(accessToken, file);
      setUser({ ...user, avatarUrl });
      toast.success('Аватар обновлён');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки аватара');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleAvatarRemove() {
    if (!accessToken || !user) return;
    setRemovingAvatar(true);
    try {
      await deleteMyAvatar(accessToken);
      setUser({ ...user, avatarUrl: null });
      toast.success('Аватар удалён');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка удаления аватара');
    } finally {
      setRemovingAvatar(false);
    }
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Профиль</h1>
          <p className="text-sm text-muted-foreground">
            Управление личными данными и паролем
          </p>
        </div>
      </div>

      <div className="mt-4 flex max-w-xl flex-col gap-6">
        {/* Аватар */}
        <Card>
          <CardHeader>
            <CardTitle>Аватар</CardTitle>
            <CardDescription>
              Фото профиля отображается в шапке и боковом меню
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Avatar size="lg">
                {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.name} /> : null}
                <AvatarFallback>{initials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleAvatarChange}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploadingAvatar || removingAvatar}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadingAvatar && <Loader2 className="animate-spin" />}
                  {uploadingAvatar ? 'Загрузка...' : 'Загрузить фото'}
                </Button>
                {user.avatarUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={uploadingAvatar || removingAvatar}
                    onClick={handleAvatarRemove}
                  >
                    {removingAvatar && <Loader2 className="animate-spin" />}
                    {removingAvatar ? 'Удаление...' : 'Удалить'}
                  </Button>
                ) : null}
              </div>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Форматы: PNG, JPEG, WebP.
            </p>
          </CardContent>
        </Card>

        {/* Личные данные */}
        <Card>
          <CardHeader>
            <CardTitle>Личные данные</CardTitle>
            <CardDescription>Ваше имя и email для входа</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleInfoSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Имя</Label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Иван Иванов"
                  autoComplete="name"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  autoComplete="email"
                />
              </div>
              <div>
                <Button type="submit" disabled={savingInfo || !infoChanged}>
                  {savingInfo && <Loader2 className="animate-spin" />}
                  {savingInfo ? 'Сохранение...' : 'Сохранить'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Смена пароля */}
        <Card>
          <CardHeader>
            <CardTitle>Смена пароля</CardTitle>
            <CardDescription>
              Для смены пароля подтвердите текущий пароль
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="currentPassword">Текущий пароль</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="newPassword">Новый пароль</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={6}
                  autoComplete="new-password"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirmPassword">Повторите новый пароль</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={6}
                  autoComplete="new-password"
                  aria-invalid={confirmPassword !== '' && confirmPassword !== newPassword}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                После смены пароля сессии на других устройствах завершатся.
              </p>
              <div>
                <Button
                  type="submit"
                  disabled={
                    savingPassword || !currentPassword || !newPassword || !confirmPassword
                  }
                >
                  {savingPassword && <Loader2 className="animate-spin" />}
                  {savingPassword ? 'Сохранение...' : 'Сменить пароль'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Обслуживание */}
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Обслуживание</CardTitle>
            <CardDescription>
              Удалить все загруженные файлы (видео уроков, материалы, вложения и
              сдачи). Полезно для сброса тестовых данных. Действие необратимо.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={purging}>
                  {purging && <Loader2 className="animate-spin" />}
                  {purging ? 'Удаление...' : 'Удалить все файлы'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Удалить все загруженные файлы?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Будут безвозвратно удалены все файлы и очищены ссылки на них в
                    уроках, заданиях, сдачах и чатах. Это нельзя отменить.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                  <AlertDialogAction onClick={handlePurgeFiles}>
                    Удалить всё
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
