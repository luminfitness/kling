'use client';

import { useState, useRef, useEffect } from 'react';
import { Badge } from './Badge';

interface DropdownOption {
  value: string;
  label: string;
}

interface CustomDropdownProps {
  value: string | undefined;
  options: DropdownOption[];
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  variant?: 'equipment' | 'force' | 'mechanic' | 'limbs' | 'body' | 'difficulty' | 'default';
  autoFocus?: boolean;
  onClose?: () => void;
  embedded?: boolean; // When true, removes border/ring (used inside GridCell that already has selection styling)
}

export function CustomDropdown({
  value,
  options,
  onChange,
  placeholder = 'Select...',
  variant = 'default',
  autoFocus = false,
  onClose,
  embedded = false,
}: CustomDropdownProps) {
  const [isOpen, setIsOpen] = useState(autoFocus);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Scroll to selected item when opening
  useEffect(() => {
    if (isOpen && listRef.current && value) {
      const selectedEl = listRef.current.querySelector(`[data-value="${value}"]`);
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [isOpen, value]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        onClose?.();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        setIsOpen(false);
        onClose?.();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const currentIndex = options.findIndex((o) => o.value === value);
        let newIndex: number;
        if (e.key === 'ArrowDown') {
          newIndex = currentIndex < options.length - 1 ? currentIndex + 1 : 0;
        } else {
          newIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
        }
        onChange(options[newIndex]?.value);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, options, value, onChange, onClose]);

  const selectedOption = options.find((o) => o.value === value);

  const handleSelect = (optionValue: string | undefined) => {
    onChange(optionValue);
    setIsOpen(false);
    onClose?.();
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`
          w-full flex items-center justify-between gap-2 px-2 py-1.5 text-sm
          rounded-lg transition-all
          ${embedded
            ? 'bg-transparent'
            : `bg-white border-2 ${isOpen ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200 hover:border-gray-300'}`
          }
        `}
      >
        <span className="truncate">
          {selectedOption ? (
            variant !== 'default' ? (
              <Badge variant={variant} value={selectedOption.value} />
            ) : (
              <span className="text-gray-900">{selectedOption.label}</span>
            )
          ) : (
            <span className="text-gray-400">{placeholder}</span>
          )}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          ref={listRef}
          className="absolute z-50 mt-1 w-full min-w-[140px] max-h-60 overflow-auto bg-white border border-gray-200 rounded-xl shadow-lg py-1 animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {/* Clear option */}
          <button
            onClick={() => handleSelect(undefined)}
            className={`
              w-full text-left px-3 py-2 text-sm transition-colors
              ${!value ? 'bg-gray-50 text-gray-600' : 'text-gray-400 hover:bg-gray-50'}
            `}
          >
            —
          </button>

          {/* Options */}
          {options.map((option) => (
            <button
              key={option.value}
              data-value={option.value}
              onClick={() => handleSelect(option.value)}
              className={`
                w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2
                ${value === option.value ? 'bg-blue-50' : 'hover:bg-gray-50'}
              `}
            >
              {variant !== 'default' ? (
                <Badge variant={variant} value={option.value} />
              ) : (
                <span className="text-gray-900">{option.label}</span>
              )}
              {value === option.value && (
                <svg className="w-4 h-4 text-blue-600 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Multi-select dropdown for Mechanic field
interface MultiSelectDropdownProps {
  values: string[] | undefined;
  options: DropdownOption[];
  onChange: (values: string[] | undefined) => void;
  placeholder?: string;
  variant?: 'equipment' | 'force' | 'mechanic' | 'limbs' | 'body' | 'difficulty' | 'default';
  autoFocus?: boolean;
  onClose?: () => void;
  embedded?: boolean;
}

export function MultiSelectDropdown({
  values,
  options,
  onChange,
  placeholder = 'Select...',
  variant = 'default',
  autoFocus = false,
  onClose,
  embedded = false,
}: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(autoFocus);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Keyboard escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const toggleOption = (optionValue: string) => {
    const current = values || [];
    const updated = current.includes(optionValue)
      ? current.filter((v) => v !== optionValue)
      : [...current, optionValue];
    onChange(updated.length > 0 ? updated : undefined);
  };

  const selectedLabels = options
    .filter((o) => values?.includes(o.value))
    .map((o) => o.label);

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`
          w-full flex items-center justify-between gap-2 px-2 py-1.5 text-sm
          rounded-lg transition-all
          ${embedded
            ? 'bg-transparent'
            : `bg-white border-2 ${isOpen ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200 hover:border-gray-300'}`
          }
        `}
      >
        <span className="truncate flex items-center gap-1">
          {values && values.length > 0 ? (
            values.map((v) =>
              variant !== 'default' ? (
                <Badge key={v} variant={variant} value={v} />
              ) : (
                <span key={v} className="text-gray-900">{v}</span>
              )
            )
          ) : (
            <span className="text-gray-400">{placeholder}</span>
          )}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full min-w-[160px] bg-white border border-gray-200 rounded-xl shadow-lg py-1 animate-in fade-in slide-in-from-top-2 duration-150">
          {options.map((option) => {
            const isSelected = values?.includes(option.value);
            return (
              <button
                key={option.value}
                onClick={() => toggleOption(option.value)}
                className={`
                  w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-3
                  ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}
                `}
              >
                <div className={`
                  w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0
                  ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}
                `}>
                  {isSelected && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                {variant && variant !== 'default' ? (
                  <Badge variant={variant} value={option.value} />
                ) : (
                  <span className="text-gray-900">{option.label}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default CustomDropdown;
