export function toKebabCase(value: string): string {
  return value
    .trim()
    .replace(/_/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

export function normalizeValues(input: unknown): string[] {
  if (Array.isArray(input)) {
    return Array.from(
      new Set(
        input
          .map((item) => `${item ?? ''}`.trim())
          .filter((item) => item.length > 0),
      ),
    );
  }

  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (typeof obj.value === 'string' && obj.value.trim().length > 0) {
      return [obj.value.trim()];
    }
    const values: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === '' || value === false) {
        continue;
      }
      if (typeof value === 'string' || typeof value === 'number') {
        const normalized = `${value}`.trim();
        if (normalized) {
          values.push(normalized);
        }
      } else {
        values.push(key);
      }
    }
    return Array.from(new Set(values));
  }

  if (typeof input === 'string' && input.trim()) {
    return [input.trim()];
  }

  if (typeof input === 'number') {
    return [`${input}`];
  }

  return [];
}

export function toDimensionKey(input?: string): string | undefined {
  if (!input) {
    return undefined;
  }
  return input
    .replace(/^field_/, '')
    .replace(/_target_id$/, '')
    .replace(/_value$/, '')
    .replace(/[^\w]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '')
    .toLowerCase();
}

export function humanizeDimension(input?: string): string {
  if (!input) {
    return '';
  }
  return input
    .split(/[-_]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}
