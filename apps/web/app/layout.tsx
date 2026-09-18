import type { Metadata } from "next";
import { Open_Sans } from "next/font/google";
import { ToastProvider } from "@/app/components/ui/Toast";
import { ErrorBoundary } from "@/app/components/ui/ErrorBoundary";
import MaintenanceProvider from "@/app/components/MaintenanceProvider";
import { getSettingServer } from "@/lib/api/settings.server";
import "./globals.css";

const openSans = Open_Sans({
  variable: "--font-open-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
  preload: true,
});

export async function generateMetadata(): Promise<Metadata> {
  const appName = "ACCA - CBT";
  return {
    title: {
      template: `%s | ${appName}`,
      default: appName,
    },
    description: "Platform CBT " + appName,
    icons: {
      icon: "/favicon.ico?v=2",
      apple: "/favicon.ico?v=2",
    }
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const appConfig = await getSettingServer<{ maintenance_mode?: boolean }>('app_config');
  const isMaintenance = appConfig?.maintenance_mode || false;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.documentElement.classList.add('dark');
                } else {
                  document.documentElement.classList.remove('dark');
                }
              } catch (_) {}
            `,
          }}
        />
      </head>
      <body
        className={`${openSans.variable} antialiased`}
      >
        <ErrorBoundary>
          <ToastProvider>
            <MaintenanceProvider isMaintenance={isMaintenance}>
              {children}
            </MaintenanceProvider>
          </ToastProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
