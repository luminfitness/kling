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
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <AppProviders>
          <NavBar />
          <main className="mx-auto max-w-[1800px] px-4 py-6">{children}</main>
        </AppProviders>
      </body>
    </html>
  );
}
