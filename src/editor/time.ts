export interface Time {
  readonly msec: number;
}

const pad2 = (value: number): string => String(value).padStart(2, '0');
const pad3 = (value: number): string => String(value).padStart(3, '0');
const mse3 = (value: string): string => value.substring(0, 3).padEnd(3, '0');

export function createTime(ms: number): Time {
  return { msec: ms };
}

export function parseTime(str: string): Time {
  const trimmed = str.trim();
  if (trimmed.length === 0) {
    return { msec: 0 };
  }

  const bracketless = trimmed.replace(/^\[|\]$/g, '').trim();
  const sign =
    bracketless.startsWith('+') || bracketless.startsWith('-')
      ? bracketless.charAt(0)
      : '';
  const normalized = sign ? bracketless.slice(1).trim() : bracketless;

  if (normalized.length === 0) {
    return { msec: 0 };
  }

  const patterns = [
    {
      regex: /^([0-9]+):([0-9]+):([0-9]+)$/,
      parser: (match: RegExpMatchArray): number => {
        const [, minutePart, secondPart, millisecondPart] = match;
        return (
          Number(minutePart) * 60 * 1000 +
          Number(secondPart) * 1000 +
          Number(mse3(millisecondPart))
        );
      },
    },
    {
      regex: /^([0-9]+):([0-9]+)(?:[,.:]([0-9]+))?$/,
      parser: (match: RegExpMatchArray): number => {
        const [, minutePart, secondPart, millisecondPart] = match;
        return (
          Number(minutePart) * 60 * 1000 +
          Number(secondPart) * 1000 +
          Number(mse3(millisecondPart ?? '0'))
        );
      },
    },
    {
      regex: /^([0-9]+)(?:[,.:]([0-9]+))$/,
      parser: (match: RegExpMatchArray): number => {
        const [, secondPart, millisecondPart] = match;
        return Number(secondPart) * 1000 + Number(mse3(millisecondPart));
      },
    },
    {
      regex: /^([0-9]+)(?:ms|msec)?$/i,
      parser: (match: RegExpMatchArray): number => {
        const [, millisecondPart] = match;
        return Number(millisecondPart);
      },
    },
  ];

  const matched = patterns.find(({ regex }) => normalized.match(regex));
  if (!matched) {
    return { msec: 0 };
  }

  const match = normalized.match(matched.regex);
  if (!match) {
    return { msec: 0 };
  }

  const magnitude = matched.parser(match);
  return { msec: sign === '-' ? -magnitude : magnitude };
}

export function formatTime(
  time: Time,
  separatorAfterSecond: '.' | ':' = '.',
  withBrackets: boolean = true,
  useCentisecond: boolean = false,
): string {
  const sign = time.msec < 0 ? '-' : '';
  const absMsec = Math.abs(time.msec);
  const minute = Math.floor(absMsec / 60000);
  const second = Math.floor((absMsec % 60000) / 1000);
  const millisecond = absMsec % 1000;
  const minuteString = sign ? String(minute) : pad2(minute);
  const secondString = pad2(second);

  const inner = useCentisecond
    ? `${minuteString}:${secondString}${separatorAfterSecond}${pad2(
        Math.floor(millisecond / 10),
      )}`
    : `${minuteString}:${secondString}${separatorAfterSecond}${pad3(millisecond)}`;

  return withBrackets ? `[${sign}${inner}]` : `${sign}${inner}`;
}

export function addTime(a: Time, b: Time): Time {
  return { msec: a.msec + b.msec };
}

export function subTime(a: Time, b: Time): Time {
  return { msec: a.msec - b.msec };
}

export function shiftTime(time: Time, offset: Time): Time {
  return { msec: time.msec + offset.msec };
}

export function compareTime(a: Time, b: Time): number {
  return a.msec - b.msec;
}
