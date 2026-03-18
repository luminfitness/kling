'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function QueuePage() {
  const router = useRouter();

  useEffect(() => {
    // Queue is now integrated into the main library page
    router.replace('/');
  }, [router]);

  return (
    <div className="flex h-64 items-center justify-center">
      <p className="text-sm text-gray-400">Redirecting to library...</p>
    </div>
  );
}
