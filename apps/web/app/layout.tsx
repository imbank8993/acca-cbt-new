import type { Metadata } from "next";
import { Open_Sans } from "next/font/google";
import { ToastProvider } from "@/app/components/ui/Toast";
import { ErrorBoundary } from "@/app/components/ui/ErrorBoundary";
import MaintenanceProvider from "@/app/components/MaintenanceProvider";
import { ExamPwaRegistration } from "@/app/components/ExamPwaRegistration";
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
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
        { url: "/icon.svg", type: "image/svg+xml" },
        { url: "/logo-icon.png", type: "image/png" },
      ],
      shortcut: "/icon.svg",
      apple: "/logo-icon.png",
    },
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
                if (localStorage.theme === 'dark' || localStorage.getItem('darkMode') === '1' || (!('theme' in localStorage) && !('darkMode' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.documentElement.classList.add('dark');
                } else {
                  document.documentElement.classList.remove('dark');
                }
              } catch (_) {}
            `,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet" />
        <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet" />
      </head>
      <body
        className={`${openSans.variable} antialiased`}
      >
        <ExamPwaRegistration />
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
