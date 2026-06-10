// Восстановление пароля. Почтовый сброс отключён: с VPS заблокированы исходящие
// SMTP-порты (письма физически не уходят), поэтому вместо формы со «сбросом на
// email» — честная инструкция. Пароль выдаёт администратор из админки
// (Студенты → «⋮» → «Сброс пароля»), при первом входе система требует сменить его.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SiteFooter } from '@/components/site-footer';
import { KeyRound } from 'lucide-react';

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-svh w-full flex-col">
      <div className="flex w-full flex-1 items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          <Card>
          <CardHeader>
            <CardTitle>Восстановление пароля</CardTitle>
            <CardDescription>Пароль восстанавливается через преподавателя</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="flex items-start gap-3">
              <KeyRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Напишите вашему преподавателю — он выдаст временный пароль. После входа
                с временным паролем вы сразу зададите свой новый.
              </p>
            </div>
            <a
              href="/login"
              className="text-center text-sm underline-offset-4 hover:underline"
            >
              ← Вернуться ко входу
            </a>
          </CardContent>
          </Card>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
