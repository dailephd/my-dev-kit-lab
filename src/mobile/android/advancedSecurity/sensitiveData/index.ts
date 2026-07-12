export { classifySensitiveIdentifier, splitIdentifierWords, type SensitiveIdentifierClassification } from "./classifySensitiveIdentifier.js";
export { classifyDirectExpression, DIRECT_EXPRESSION_KINDS, type DirectExpressionKind, type DirectExpressionClassification } from "./classifyDirectExpression.js";
export { executableMask, lineForOffset, methodScopes, scopeAt, sameScope, type MethodScope } from "./localSourceContext.js";
