import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { getOptionalDemoSession } from "@/lib/session";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Анализ МТР", template: "%s · Анализ МТР" },
  description: "Демонстрационный прототип анализа материально-технических ресурсов",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getOptionalDemoSession();
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full">
        {session ? <AppShell displayName={session.user.displayName} login={session.user.login ?? "demo"} subjectId={session.authorization.subjectId} authorizationVersion={session.authorization.authorizationVersion} activeProjectId={session.authorization.activeProjectId} roleSelectorEnabled={process.env.DEMO_ROLE_SELECTOR === "true"} permissionKeys={[...session.authorization.permissionKeys]} roleKeys={[...session.authorization.globalRoleKeys, ...session.authorization.projectRoleKeys]}>{children}</AppShell> : children}
      </body>
    </html>
  );
}
