export interface Logger {
  error(message: string): void;
}

export const consoleLogger: Logger = {
  error(message: string) {
    console.error(message);
  },
};

export const silentLogger: Logger = {
  error() {
    return undefined;
  },
};
