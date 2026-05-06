export interface NormalizedTarget {
  target: string;
  normalizedTarget: string;
  configJson: Record<string, unknown>;
}

export interface MonitorSourceShape {
  type: string;
  target: string;
  normalizedTarget: string;
  configJson: Record<string, unknown>;
}

export interface MonitorAdapter {
  type: string;
  validateTarget(input: string): Promise<NormalizedTarget>;
  describe(source: MonitorSourceShape): string;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
