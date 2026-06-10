import { LoginForm } from "@/components/login-form"
import { SiteFooter } from "@/components/site-footer"

export default function Page() {
  return (
    <div className="flex min-h-svh w-full flex-col">
      <div className="flex w-full flex-1 items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          <LoginForm />
        </div>
      </div>
      <SiteFooter />
    </div>
  )
}
