import type { Metadata } from 'next';
import './globals.css';
import NavBar from '@/components/NavBar';
import AppProviders from '@/components/AppProviders';

export const metadata: Metadata = {
  title: 'Exercise Avatar Transformer',
  description: 'Transform exercise videos with your custom avatar using AI',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex h-screen overflow-hidden bg-gray-50 text-gray-900 antialiased">
        <AppProviders>
          <NavBar />
          <div className="flex-1 overflow-y-auto">
            <main className="px-6 py-6">{children}</main>
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
