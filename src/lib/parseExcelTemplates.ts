import * as XLSX from 'xlsx';
import type {
  ExerciseTemplate, Position,
  ForceType, MechanicType, LimbType, BodyType, DifficultyType,
} from '@/types';
import { MUSCLE_OPTIONS } from '@/types';

const DEFAULT_PROMPT = `The subject performs exactly ONE complete repetition of the exercise. The movement is smooth and controlled. The starting position and ending position are identical to create a seamless loop - the subject returns to the exact same pose at the end as they started. The subject's entire body is fully visible in the frame from head to feet at all times. The subject holds the equipment in the correct grip for performing the exercise. The subject's posture and form are perfect, demonstrating proper technique throughout the movement. The subject's body positioning and alignment are ideal for maximizing effectiveness and minimizing injury risk. Do not crop or cut off any part of the subject's body. The subject's facial expression remains neutral, calm, and relaxed throughout. Do not replicate or exaggerate any facial expressions from the reference video.`;

const VALID_FORCE: Record<string, ForceType> = {
  compound: 'Compound',
  isolated: 'Isolated',
};

const VALID_MECHANIC: Record<string, MechanicType> = {
  push: 'Push',
  pull: 'Pull',
};

const VALID_LIMBS: Record<string, LimbType> = {
  bilateral: 'Bilateral',
  alternating: 'Alternating',
  unilateral: 'Unilateral',
};

const VALID_BODY: Record<string, BodyType> = {
  full: 'Full',
  upper: 'Upper',
  lower: 'Lower',
};

const VALID_DIFFICULTY: Record<string, DifficultyType> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

// Column name variations that map to our fields
const COLUMN_ALIASES: Record<string, string[]> = {
  exerciseName: ['name', 'exercise name', 'exercise', 'title'],
  equipment: ['equipment', 'equipment type', 'equip'],
  position: ['position', 'avatar', 'photo', 'pose'],
  youtubeUrl: ['link', 'video link', 'url', 'youtube', 'video url', 'video'],
  customPrompt: ['prompt', 'special prompt instructions', 'instructions', 'custom prompt'],
  startTime: ['start', 'start timestamp', 'start time'],
  endTime: ['end', 'end timestamp', 'end time'],
  force: ['force', 'force type'],
  mechanic: ['mechanic', 'mechanics'],
  limbs: ['limbs', 'limb', 'limb type'],
  body: ['body', 'body type', 'body part'],
  difficulty: ['difficulty', 'level'],
  musclesTargeted: ['muscles', 'muscles targeted', 'muscle groups', 'target muscles'],
};

export interface ParseResult {
  templates: Omit<ExerciseTemplate, 'id' | 'createdAt'>[];
  errors: string[];
  recognizedColumns: string[];
  unrecognizedColumns: string[];
}

// Helper to find which field a column header maps to
function getFieldForColumn(columnName: string): string | null {
  const normalized = columnName.toLowerCase().trim();
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.includes(normalized)) {
      return field;
    }
  }
  return null;
}

// Parse tab-separated or comma-separated text into rows
export function parseTextToRows(text: string): Record<string, any>[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return []; // Need at least header + 1 row

  // Detect delimiter (tab or comma)
  const firstLine = lines[0];
  const delimiter = firstLine.includes('\t') ? '\t' : ',';

  const headers = firstLine.split(delimiter).map((h) => h.trim());
  const rows: Record<string, any>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(delimiter);
    const row: Record<string, any> = {};

    headers.forEach((header, idx) => {
      row[header] = values[idx]?.trim() || '';
    });

    rows.push(row);
  }

  return rows;
}

// Main parsing function - works with both ArrayBuffer (Excel) and text (TSV/CSV)
export function parseTemplateData(
  input: ArrayBuffer | string,
  positions: Position[],
  equipmentNames: string[] = [],
): ParseResult {
  let rows: Record<string, any>[];
  let headers: string[] = [];

  if (typeof input === 'string') {
    // Parse text input (TSV/CSV)
    rows = parseTextToRows(input);
    if (rows.length > 0) {
      headers = Object.keys(rows[0]);
    }
  } else {
    // Parse Excel file
    const workbook = XLSX.read(input, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return { templates: [], errors: ['No sheets found in file'], recognizedColumns: [], unrecognizedColumns: [] };
    }

    const sheet = workbook.Sheets[sheetName];
    rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

    if (rows.length > 0) {
      headers = Object.keys(rows[0]);

      // Extract hyperlink URLs for URL-mapped columns (e.g. YouTube links)
      // sheet_to_json only returns display text; hyperlinks are in cell.l.Target
      const urlHeaders = headers.filter(h => getFieldForColumn(h) === 'youtubeUrl');
      if (urlHeaders.length > 0 && sheet['!ref']) {
        const range = XLSX.utils.decode_range(sheet['!ref']);
        for (const header of urlHeaders) {
          // Find which column index has this header
          let colIndex = -1;
          for (let c = range.s.c; c <= range.e.c; c++) {
            const cellAddr = XLSX.utils.encode_cell({ r: range.s.r, c });
            const cell = sheet[cellAddr];
            if (cell && String(cell.v).trim() === header) {
              colIndex = c;
              break;
            }
          }
          if (colIndex >= 0) {
            rows.forEach((row, i) => {
              const cellAddr = XLSX.utils.encode_cell({ r: i + 1 + range.s.r, c: colIndex });
              const cell = sheet[cellAddr];
              if (cell?.l?.Target) {
                row[header] = cell.l.Target;
              }
            });
          }
        }
      }
    }
  }

  if (rows.length === 0) {
    return { templates: [], errors: ['No data found'], recognizedColumns: [], unrecognizedColumns: [] };
  }

  // Build column mapping and track recognized/unrecognized columns
  const columnMapping: Record<string, string> = {}; // original header -> field name
  const recognizedColumns: string[] = [];
  const unrecognizedColumns: string[] = [];

  headers.forEach((header) => {
    const field = getFieldForColumn(header);
    if (field) {
      columnMapping[header] = field;
      recognizedColumns.push(header);
    } else {
      unrecognizedColumns.push(header);
    }
  });

  // Build equipment map from provided names
  const EQUIPMENT_MAP: Record<string, string> = {};
  equipmentNames.forEach((eq) => {
    EQUIPMENT_MAP[eq.toLowerCase()] = eq;
  });

  // Build position map
  const POSITION_MAP: Record<string, Position> = {};
  positions.forEach((p) => {
    POSITION_MAP[p.name.toLowerCase()] = p;
  });

  const templates: ParseResult['templates'] = [];
  const errors: string[] = [];

  // Helper to get value by field name (checking all possible column headers)
  const getValue = (row: Record<string, any>, field: string): string => {
    for (const [header, mappedField] of Object.entries(columnMapping)) {
      if (mappedField === field && row[header] !== undefined) {
        return String(row[header]).trim();
      }
    }
    return '';
  };

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // +2 because row 1 is header, data starts at 2
    const rowErrors: string[] = [];

    // --- Required field: Exercise Name ---
    const exerciseName = getValue(row, 'exerciseName');
    if (!exerciseName) {
      rowErrors.push('Missing exercise name');
    }

    // If no exercise name, skip this row
    if (rowErrors.length > 0) {
      errors.push(`Row ${rowNum}: ${rowErrors.join(', ')}`);
      return;
    }

    // --- Optional fields ---

    // Equipment (optional - leave undefined if not found or invalid)
    const equipmentRaw = getValue(row, 'equipment').toLowerCase();
    const equipmentType = equipmentRaw ? EQUIPMENT_MAP[equipmentRaw] : undefined;
    if (equipmentRaw && !equipmentType) {
      // Add warning but don't fail - just skip equipment
      errors.push(`Row ${rowNum} (${exerciseName}): Unknown equipment "${equipmentRaw}" - skipped`);
    }

    // Position (optional - leave undefined if not found)
    const positionRaw = getValue(row, 'position').toLowerCase();
    const position = positionRaw ? POSITION_MAP[positionRaw] : undefined;
    if (positionRaw && !position) {
      // Add warning but don't fail
      errors.push(`Row ${rowNum} (${exerciseName}): Unknown position "${positionRaw}" - skipped`);
    }

    // YouTube URL
    const youtubeUrl = getValue(row, 'youtubeUrl') || undefined;

    // Custom prompt
    const customPrompt = getValue(row, 'customPrompt') || DEFAULT_PROMPT;

    // Timestamps
    const startRaw = getValue(row, 'startTime');
    const startTime = startRaw !== '' ? parseFloat(startRaw) : undefined;

    const endRaw = getValue(row, 'endTime');
    const endTime = endRaw !== '' ? parseFloat(endRaw) : undefined;

    // Force
    const forceRaw = getValue(row, 'force').toLowerCase();
    const force = VALID_FORCE[forceRaw] || undefined;

    // Mechanic (comma-separated)
    const mechanicRaw = getValue(row, 'mechanic');
    const mechanic: MechanicType[] = mechanicRaw
      ? mechanicRaw
          .split(',')
          .map((m) => VALID_MECHANIC[m.trim().toLowerCase()])
          .filter((m): m is MechanicType => !!m)
      : [];

    // Limbs
    const limbsRaw = getValue(row, 'limbs').toLowerCase();
    const limbs = VALID_LIMBS[limbsRaw] || undefined;

    // Body
    const bodyRaw = getValue(row, 'body').toLowerCase();
    const body = VALID_BODY[bodyRaw] || undefined;

    // Difficulty
    const diffRaw = getValue(row, 'difficulty').toLowerCase();
    const difficulty = VALID_DIFFICULTY[diffRaw] || undefined;

    // Muscles Targeted (comma-separated)
    const musclesRaw = getValue(row, 'musclesTargeted');
    const musclesTargeted: string[] = musclesRaw
      ? musclesRaw
          .split(',')
          .map((m) => m.trim())
          .filter((m) => MUSCLE_OPTIONS.some((opt) => opt.toLowerCase() === m.toLowerCase()))
          .map((m) => MUSCLE_OPTIONS.find((opt) => opt.toLowerCase() === m.toLowerCase())!)
      : [];

    templates.push({
      exerciseName,
      equipmentType: equipmentType || '',
      youtubeUrl,
      customPrompt,
      startTime: startTime !== undefined && !isNaN(startTime) ? startTime : undefined,
      endTime: endTime !== undefined && !isNaN(endTime) ? endTime : undefined,
      positionId: position?.id || '',
      positionName: position?.name || '',
      force,
      mechanic: mechanic.length > 0 ? mechanic : undefined,
      limbs,
      body,
      difficulty,
      musclesTargeted: musclesTargeted.length > 0 ? musclesTargeted : undefined,
    });
  });

  return { templates, errors, recognizedColumns, unrecognizedColumns };
}

// Legacy function for backwards compatibility
export function parseExcelTemplates(
  data: ArrayBuffer,
  positions: Position[],
  equipmentNames: string[] = [],
): ParseResult {
  return parseTemplateData(data, positions, equipmentNames);
}
