export type ClipboardMatchKind = "clip-create" | "clip-set" | "legacy-set-text" | "clip-get" | "clip-clear" | "sensitive-marker";

export type ClipboardMatch = {
  kind: ClipboardMatchKind;
  api: string;
  receiver?: string;
  labelExpression?: string;
  valueExpression?: string;
  assignedVariable?: string;
  argumentExpression?: string;
  scopeId?: number;
  offset: number;
  line: number;
};
