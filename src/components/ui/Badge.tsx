'use client';

import type { ForceType, MechanicType, LimbType, BodyType, DifficultyType } from '@/types';

type BadgeVariant = 'equipment' | 'force' | 'mechanic' | 'limbs' | 'body' | 'difficulty' | 'source' | 'position';

const BADGE_COLORS: Record<string, Record<string, string>> = {
  equipment: {
    'Barbell': 'bg-orange-100 text-orange-700',
    'Dumbbell': 'bg-blue-100 text-blue-700',
    'Two Dumbbells': 'bg-indigo-100 text-indigo-700',
    'Kettlebell': 'bg-purple-100 text-purple-700',
    'TRX': 'bg-yellow-100 text-yellow-700',
  },
  force: {
    'Compound': 'bg-violet-100 text-violet-700',
    'Isolated': 'bg-pink-100 text-pink-700',
  },
  mechanic: {
    'Push': 'bg-teal-100 text-teal-700',
    'Pull': 'bg-cyan-100 text-cyan-700',
  },
  limbs: {
    'Bilateral': 'bg-emerald-100 text-emerald-700',
    'Alternating': 'bg-lime-100 text-lime-700',
    'Unilateral': 'bg-green-100 text-green-700',
  },
  body: {
    'Full': 'bg-blue-100 text-blue-700',
    'Upper': 'bg-sky-100 text-sky-700',
    'Lower': 'bg-indigo-100 text-indigo-700',
  },
  difficulty: {
    'Beginner': 'bg-green-100 text-green-700',
    'Intermediate': 'bg-amber-100 text-amber-700',
    'Advanced': 'bg-red-100 text-red-700',
  },
  source: {
    'YT': 'bg-red-100 text-red-700',
    'MP4': 'bg-emerald-100 text-emerald-700',
  },
  position: {
    // Default color for all positions (user-defined names)
    '_default': 'bg-teal-100 text-teal-700',
  },
};

interface BadgeProps {
  variant: BadgeVariant;
  value: string | ForceType | MechanicType | LimbType | BodyType | DifficultyType;
  className?: string;
}

export function Badge({ variant, value, className = '' }: BadgeProps) {
  // For position variant, use default color (user-defined names)
  const variantColors = BADGE_COLORS[variant];
  const colors = variantColors?.[value] || variantColors?.['_default'] || 'bg-gray-100 text-gray-600';

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${colors} ${className}`}
    >
      {value}
    </span>
  );
}

// Multi-badge for mechanic array
interface MechanicBadgesProps {
  values: MechanicType[] | undefined;
  className?: string;
}

export function MechanicBadges({ values, className = '' }: MechanicBadgesProps) {
  if (!values || values.length === 0) {
    return <span className="text-gray-400 text-sm">—</span>;
  }

  return (
    <div className={`flex gap-1 ${className}`}>
      {values.map((v) => (
        <Badge key={v} variant="mechanic" value={v} />
      ))}
    </div>
  );
}

export default Badge;
