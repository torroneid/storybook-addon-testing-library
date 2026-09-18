// jest-dom og @vitest/expect fargelegg meldingane for terminalen
export const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');

export const display = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'function') {
    return `[Function ${value.name}]`;
  }
  if (typeof value === 'bigint' || typeof value === 'symbol' || value === undefined) {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/** Formats .each/.for names the way Vitest does: printf style (%s, %d, %#, …) or $variable */
export const formatName = (template: string, args: unknown[], index: number) => {
  let next = 0;
  let name = template.replace(/%[sdifjoOc#$%]/g, token => {
    switch (token) {
      case '%%':
        return '%';
      case '%#':
        return String(index);
      case '%$':
        return String(index + 1);
      case '%d':
      case '%i':
        return String(Math.trunc(Number(args[next++])));
      case '%f':
        return String(Number(args[next++]));
      case '%j':
        return JSON.stringify(args[next++]);
      case '%c':
        next++;
        return '';
      default:
        return display(args[next++]);
    }
  });
  const [first] = args;
  if (args.length === 1 && first !== null && typeof first === 'object' && !Array.isArray(first)) {
    name = name.replace(/\$([\w$]+(?:\.[\w$]+)*)/g, (whole, path: string) => {
      const value = path.split('.').reduce<unknown>((obj, key) => (obj as Record<string, unknown>)?.[key], first);
      return value === undefined && !(path in first) ? whole : display(value);
    });
  }
  return name;
};
