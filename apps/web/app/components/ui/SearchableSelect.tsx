'use client';

import React,{ useEffect,useMemo,useRef,useState } from 'react';
import './searchable-select.css';

export interface Option {
  value: string | number;
  label: string;
  subLabel?: string;
}

export type SearchableSelectOption = Option;

export interface SearchableSelectProps {
  options: Option[];
  value: string | number | (string | number)[];
  onChange: (value: unknown) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
  multiple?: boolean;
  placement?: 'top' | 'bottom';
  itemLabel?: string;
  showQuickActions?: boolean;
}

function DropDownIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      stroke="currentColor"
      fill="currentColor"
      strokeWidth="0"
      viewBox="0 0 24 24"
      height={size}
      width={size}
      className={className}
      aria-hidden="true"
    >
      <path d="M12 16L6 10H18L12 16Z" />
    </svg>
  );
}

function ClearIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      stroke="currentColor"
      fill="currentColor"
      strokeWidth="0"
      viewBox="0 0 16 16"
      height={size}
      width={size}
      className={className}
      aria-hidden="true"
    >
      <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293 5.354 4.646z" />
    </svg>
  );
}

function CheckAllIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      stroke="currentColor"
      fill="currentColor"
      strokeWidth="0"
      viewBox="0 0 16 16"
      height={size}
      width={size}
      className={className}
      aria-hidden="true"
    >
      <path d="M8.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L2.324 8.384a.757.757 0 1 1 1.06-1.06l2.094 2.093L8.95 4.992a.252.252 0 0 1 .02-.022zm-.92 5.14.92.92a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 1 0-1.091-1.028L9.477 9.417l-.485-.486-.943.943zm-4.27 1.122a.75.75 0 0 1-.035-1.06l.543-.543.943.943-.543.543a.75.75 0 0 1-1.06-.035z" />
    </svg>
  );
}

function ClearCircleIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      stroke="currentColor"
      fill="currentColor"
      strokeWidth="0"
      viewBox="0 0 16 16"
      height={size}
      width={size}
      className={className}
      aria-hidden="true"
    >
      <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z" />
      <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
    </svg>
  );
}

function InboxIcon({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      stroke="currentColor"
      fill="currentColor"
      strokeWidth="0"
      viewBox="0 0 16 16"
      height={size}
      width={size}
      className={className}
      aria-hidden="true"
    >
      <path d="M4.98 4a.5.5 0 0 0-.39.188L1.54 8H6a.5.5 0 0 1 .5.5 1.5 1.5 0 1 0 3 0A.5.5 0 0 1 10 8h4.46l-3.05-3.812A.5.5 0 0 0 11.02 4H4.98zm-1.17-.437A1.5 1.5 0 0 1 4.98 3h6.04a1.5 1.5 0 0 1 1.17.563l3.7 4.625a1 1 0 0 1 .11.812l-1.5 6A1 1 0 0 1 13.52 16H2.48a1 1 0 0 1-.97-.812l-1.5-6a1 1 0 0 1 .11-.812l3.7-4.625zM1.125 9l1.25 5h11.25l1.25-5H11.5a2.5 2.5 0 0 1-5 0H1.125z" />
    </svg>
  );
}

function CheckIcon({ size = 12, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      stroke="currentColor"
      fill="currentColor"
      strokeWidth="0"
      viewBox="0 0 16 16"
      height={size}
      width={size}
      className={className}
      aria-hidden="true"
    >
      <path d="M12.736 3.97a.733.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733.733 0 0 1-1.065.02L3.217 8.384a.757.757 0 0 1 0-1.06.733.733 0 0 1 1.047 0l3.052 3.093 5.4-6.425a.247.247 0 0 1 .02-.022Z" />
    </svg>
  );
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Pilih...',
  label,
  className = '',
  disabled = false,
  multiple = false,
  placement = 'bottom',
  itemLabel = 'item',
  showQuickActions = true,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setSearch('');
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSearch('');
        setIsOpen(false);
      }
    }
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const selectedOptions = useMemo(() => {
    if (multiple) {
      const values = Array.isArray(value) ? value : [];
      return options.filter((opt) => values.includes(opt.value));
    } else {
      const found = options.find((opt) => opt.value === value);
      return found ? [found] : [];
    }
  }, [options, value, multiple]);

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) || (opt.subLabel && opt.subLabel.toLowerCase().includes(q))
    );
  }, [options, search]);

  const toggle = (e: React.MouseEvent) => {
    if (disabled) return;
    if (!isOpen) {
      setIsOpen(true);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      if ((e.target as HTMLElement).tagName !== 'INPUT') {
        setSearch('');
        setIsOpen(false);
      }
    }
  };

  const pick = (opt: Option) => {
    if (multiple) {
      const currentValues = Array.isArray(value) ? value : [];
      const isSelected = currentValues.includes(opt.value);

      let newValues: (string | number)[];
      if (isSelected) {
        newValues = currentValues.filter((v) => v !== opt.value);
      } else {
        newValues = [...currentValues, opt.value];
      }

      onChange(newValues);
      inputRef.current?.focus();
    } else {
      onChange(opt.value);
      setSearch('');
      setIsOpen(false);
    }
  };

  const handleSelectAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    const allVals = options.map((o) => o.value);
    onChange(allVals);
    inputRef.current?.focus();
  };

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
    inputRef.current?.focus();
  };

  const dynamicPlaceholder = useMemo(() => {
    if (selectedOptions.length === 0) return placeholder;
    if (multiple) {
      const summary = selectedOptions.map((o) => o.label).join(', ');
      return `${selectedOptions.length} ${itemLabel} terpilih (${summary})`;
    }
    return selectedOptions[0].label;
  }, [selectedOptions, placeholder, multiple, itemLabel]);

  return (
    <div
      ref={wrapperRef}
      className={`ss ${disabled ? 'ss--disabled' : ''} ${className}`}
      aria-disabled={disabled}
    >
      {label && <label className="ss__label">{label}</label>}

      {/* Main Input & Trigger Box */}
      <div
        className={`ss__trigger ${isOpen ? 'is-open' : ''}`}
        onClick={toggle}
      >
        {multiple && selectedOptions.length > 0 && !search && (
          <span className="ss__badge">{selectedOptions.length}</span>
        )}

        <input
          ref={inputRef}
          type="text"
          className="ss__mainInput"
          placeholder={dynamicPlaceholder}
          value={search}
          disabled={disabled}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => {
            if (!isOpen) setIsOpen(true);
          }}
        />

        <div className="ss__triggerActions">
          {search && (
            <button
              type="button"
              className="ss__clearBtn"
              title="Hapus ketikan"
              onClick={(e) => {
                e.stopPropagation();
                setSearch('');
                inputRef.current?.focus();
              }}
            >
              <ClearIcon size={14} />
            </button>
          )}

          <DropDownIcon
            size={20}
            className={`ss__chev ${isOpen ? 'rot' : ''}`}
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className={`ss__drop ${placement === 'top' ? 'ss__drop--top' : ''}`} role="listbox">
          {multiple && showQuickActions && options.length > 0 && (
            <div className="ss__quickActions">
              <button
                type="button"
                className="ss__quickBtn"
                onClick={handleSelectAll}
              >
                <CheckAllIcon size={14} /> Pilih Semua
              </button>
              <span className="ss__quickDivider">|</span>
              <button
                type="button"
                className="ss__quickBtn ss__quickBtn--clear"
                onClick={handleClearAll}
              >
                <ClearCircleIcon size={14} /> Kosongkan
              </button>
            </div>
          )}

          <div className="ss__list">
            {filteredOptions.length === 0 ? (
              <div className="ss__empty">
                <InboxIcon size={24} />
                <span>Tidak ada data yang cocok</span>
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const active = multiple
                  ? (Array.isArray(value) ? value : []).includes(opt.value)
                  : opt.value === value;
                return (
                  <button
                    type="button"
                    key={opt.value}
                    className={`ss__item ${active ? 'is-active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      pick(opt);
                    }}
                  >
                    {multiple && (
                      <span className={`ss__checkbox ${active ? 'is-checked' : ''}`}>
                        {active && <CheckIcon size={12} />}
                      </span>
                    )}
                    <div className="ss__itemContent">
                      <span className="ss__itemMain">{opt.label}</span>
                      {opt.subLabel && <span className="ss__itemSub">{opt.subLabel}</span>}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SearchableSelect;
