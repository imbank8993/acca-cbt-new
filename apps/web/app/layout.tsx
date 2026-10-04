import { ExamSubmissionSync } from '@/app/components/ExamSubmissionSync';
import { ExamPwaRegistration } from "@/app/components/ExamPwaRegistration";
import MaintenanceProvider from "@/app/components/MaintenanceProvider";
import { ErrorBoundary } from "@/app/components/ui/ErrorBoundary";
import { ToastProvider } from "@/app/components/ui/Toast";
import { getSettingServer } from "@/lib/api/settings.server";
import type { Metadata } from "next";
import { Open_Sans, Poppins } from "next/font/google";
import "./globals.css";

const openSans = Open_Sans({
  variable: "--font-open-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
  preload: true,
});

const poppins = Poppins({
  variable: "--font-poppins",
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
    <html lang="id" suppressHydrationWarning>
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="color-scheme" content="light" id="color-scheme-meta" />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" id="theme-color-light-meta" />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: dark)" id="theme-color-dark-meta" />
        <meta name="theme-color" content="#ffffff" id="theme-color-meta" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var d = localStorage.getItem('darkMode') === '1' || localStorage.theme === 'dark' || (!('theme' in localStorage) && !('darkMode' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
                if (d) {
                  document.documentElement.classList.add('dark');
                } else {
                  document.documentElement.classList.remove('dark');
                }
                var c = d ? '#000000' : '#ffffff';
                var s = d ? 'dark' : 'light';
                document.documentElement.style.backgroundColor = c;
                document.documentElement.style.colorScheme = s;
                var metas = ['theme-color-meta', 'theme-color-light-meta', 'theme-color-dark-meta'];
                for (var i = 0; i < metas.length; i++) {
                  var el = document.getElementById(metas[i]);
                  if (el) { el.content = c; el.setAttribute('content', c); }
                }
                var cs = document.getElementById('color-scheme-meta');
                if (cs) { cs.content = s; cs.setAttribute('content', s); }
              } catch (_) {}
            `,
          }}
        />
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet" />
        <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet" />
      </head>
      <body
        className={`${openSans.variable} ${poppins.variable} antialiased`}
      >
        <div className="acca-ambient-bg" aria-hidden="true" />
        <ExamPwaRegistration />
        <ErrorBoundary>
          <ToastProvider>
            <ExamSubmissionSync />
            <MaintenanceProvider isMaintenance={isMaintenance}>
              {children}
            </MaintenanceProvider>
          </ToastProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
