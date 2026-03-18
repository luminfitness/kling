'use client';

import { useState, useCallback, useRef } from 'react';

export interface CellPosition {
  row: number;
  col: number;
}

interface GridNavigationOptions {
  rowCount: number;
  colCount: number;
  editableCols: number[]; // Which column indices are editable
  onCellSelect?: (row: number, col: number) => void;
  onStartEdit?: (row: number, col: number, initialChar?: string) => void;
  onEndEdit?: (row: number, col: number, save: boolean) => void;
  onClearCell?: (row: number, col: number) => void;
}

interface GridNavigationReturn {
  selectedCell: CellPosition | null;
  editingCell: CellPosition | null;
  setSelectedCell: (cell: CellPosition | null) => void;
  setEditingCell: (cell: CellPosition | null) => void;
  isSelected: (row: number, col: number) => boolean;
  isEditing: (row: number, col: number) => boolean;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  handleCellClick: (row: number, col: number) => void;
  handleCellDoubleClick: (row: number, col: number) => void;
  startEdit: (initialChar?: string) => void;
  endEdit: (save: boolean) => void;
  clearSelection: () => void;
}

export function useGridNavigation({
  rowCount,
  colCount,
  editableCols,
  onCellSelect,
  onStartEdit,
  onEndEdit,
  onClearCell,
}: GridNavigationOptions): GridNavigationReturn {
  const [selectedCell, setSelectedCellState] = useState<CellPosition | null>(null);
  const [editingCell, setEditingCellState] = useState<CellPosition | null>(null);
  const pendingCharRef = useRef<string | null>(null);

  const setSelectedCell = useCallback((cell: CellPosition | null) => {
    setSelectedCellState(cell);
    if (cell && onCellSelect) {
      onCellSelect(cell.row, cell.col);
    }
  }, [onCellSelect]);

  const setEditingCell = useCallback((cell: CellPosition | null) => {
    setEditingCellState(cell);
  }, []);

  const isSelected = useCallback((row: number, col: number) => {
    return selectedCell?.row === row && selectedCell?.col === col;
  }, [selectedCell]);

  const isEditing = useCallback((row: number, col: number) => {
    return editingCell?.row === row && editingCell?.col === col;
  }, [editingCell]);

  const canEditColumn = useCallback((col: number) => {
    return editableCols.includes(col);
  }, [editableCols]);

  const startEdit = useCallback((initialChar?: string) => {
    if (!selectedCell) return;
    if (!canEditColumn(selectedCell.col)) return;

    pendingCharRef.current = initialChar || null;
    setEditingCell(selectedCell);
    if (onStartEdit) {
      onStartEdit(selectedCell.row, selectedCell.col, initialChar);
    }
  }, [selectedCell, canEditColumn, setEditingCell, onStartEdit]);

  const endEdit = useCallback((save: boolean) => {
    if (!editingCell) return;

    const { row, col } = editingCell;
    setEditingCell(null);
    pendingCharRef.current = null;

    if (onEndEdit) {
      onEndEdit(row, col, save);
    }
  }, [editingCell, setEditingCell, onEndEdit]);

  const clearSelection = useCallback(() => {
    if (editingCell) {
      endEdit(false);
    }
    setSelectedCell(null);
  }, [editingCell, endEdit, setSelectedCell]);

  const moveSelection = useCallback((deltaRow: number, deltaCol: number) => {
    if (!selectedCell) {
      // If nothing selected, select first cell
      setSelectedCell({ row: 0, col: 0 });
      return;
    }

    const newRow = Math.max(0, Math.min(rowCount - 1, selectedCell.row + deltaRow));
    const newCol = Math.max(0, Math.min(colCount - 1, selectedCell.col + deltaCol));

    if (newRow !== selectedCell.row || newCol !== selectedCell.col) {
      setSelectedCell({ row: newRow, col: newCol });
    }
  }, [selectedCell, rowCount, colCount, setSelectedCell]);

  const moveToNextCell = useCallback((forward: boolean) => {
    if (!selectedCell) {
      setSelectedCell({ row: 0, col: 0 });
      return;
    }

    let newCol = selectedCell.col + (forward ? 1 : -1);
    let newRow = selectedCell.row;

    // Wrap to next/previous row
    if (newCol >= colCount) {
      newCol = 0;
      newRow = Math.min(rowCount - 1, newRow + 1);
    } else if (newCol < 0) {
      newCol = colCount - 1;
      newRow = Math.max(0, newRow - 1);
    }

    setSelectedCell({ row: newRow, col: newCol });
  }, [selectedCell, rowCount, colCount, setSelectedCell]);

  const handleCellClick = useCallback((row: number, col: number) => {
    // If already editing this cell, don't interfere
    if (editingCell?.row === row && editingCell?.col === col) {
      return;
    }

    // If editing another cell, end edit first
    if (editingCell) {
      endEdit(true);
    }

    setSelectedCell({ row, col });

    // Single-click starts editing for editable columns
    if (canEditColumn(col)) {
      setEditingCell({ row, col });
      if (onStartEdit) {
        onStartEdit(row, col);
      }
    }
  }, [editingCell, endEdit, setSelectedCell, canEditColumn, setEditingCell, onStartEdit]);

  const handleCellDoubleClick = useCallback((row: number, col: number) => {
    setSelectedCell({ row, col });
    if (canEditColumn(col)) {
      setEditingCell({ row, col });
      if (onStartEdit) {
        onStartEdit(row, col);
      }
    }
  }, [canEditColumn, setSelectedCell, setEditingCell, onStartEdit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Don't handle if editing - let the input handle it
    if (editingCell) {
      if (e.key === 'Escape') {
        e.preventDefault();
        endEdit(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        endEdit(true);
        // Move down after Enter
        moveSelection(1, 0);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        endEdit(true);
        moveToNextCell(!e.shiftKey);
      }
      return;
    }

    // Navigation when not editing
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        moveSelection(-1, 0);
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveSelection(1, 0);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        moveSelection(0, -1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        moveSelection(0, 1);
        break;
      case 'Tab':
        e.preventDefault();
        moveToNextCell(!e.shiftKey);
        break;
      case 'Enter':
      case 'F2':
        e.preventDefault();
        if (selectedCell && canEditColumn(selectedCell.col)) {
          startEdit();
        }
        break;
      case 'Escape':
        e.preventDefault();
        clearSelection();
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        if (selectedCell && canEditColumn(selectedCell.col) && onClearCell) {
          onClearCell(selectedCell.row, selectedCell.col);
        }
        break;
      default:
        // Start editing on any printable character
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          if (selectedCell && canEditColumn(selectedCell.col)) {
            e.preventDefault();
            startEdit(e.key);
          }
        }
        break;
    }
  }, [editingCell, selectedCell, moveSelection, moveToNextCell, canEditColumn, startEdit, endEdit, clearSelection, onClearCell]);

  return {
    selectedCell,
    editingCell,
    setSelectedCell,
    setEditingCell,
    isSelected,
    isEditing,
    handleKeyDown,
    handleCellClick,
    handleCellDoubleClick,
    startEdit,
    endEdit,
    clearSelection,
  };
}
