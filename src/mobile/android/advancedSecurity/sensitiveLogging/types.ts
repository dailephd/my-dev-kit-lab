export type LoggingMatchKind = "log" | "timber" | "stdout" | "print-stack-trace" | "crashlytics" | "isloggable";

export type LoggingMatch = {
  kind: LoggingMatchKind;
  api: string;
  tagExpression?: string;
  messageExpression?: string;
  throwableExpression?: string;
  debugGuarded: boolean;
  offset: number;
  line: number;
};
