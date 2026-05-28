export function suppressConsoleLog(maxBuffer = 500) {
  // eslint-disable-next-line no-console
  const originalLog = console.log.bind(console);
  const buffer: string[] = [];

  // eslint-disable-next-line no-console
  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    buffer.push(line);
    if (buffer.length > maxBuffer) buffer.shift();
  };

  return {
    restore: () => {
      // eslint-disable-next-line no-console
      console.log = originalLog;
    },
    getLogBuffer: () => [...buffer],
  };
}
