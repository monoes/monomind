export type KeywordType = 'Var' | 'Let' | 'Const' | 'Function' | 'Return' | 'If' | 'Else' | 'For' | 'While' | 'Do' | 'Switch' | 'Case' | 'Break' | 'Continue' | 'Default' | 'Throw' | 'Try' | 'Catch' | 'Finally' | 'New' | 'Delete' | 'Typeof' | 'Instanceof' | 'In' | 'Of' | 'Void' | 'This' | 'Super' | 'Class' | 'Extends' | 'Import' | 'Export' | 'From' | 'As' | 'Async' | 'Await' | 'Yield' | 'Static' | 'Get' | 'Set' | 'Type' | 'Interface' | 'Enum' | 'Implements' | 'Abstract' | 'Declare' | 'Readonly' | 'Keyof' | 'Satisfies';
export type OperatorType = 'Assign' | 'Add' | 'Sub' | 'Mul' | 'Div' | 'Mod' | 'Exp' | 'Eq' | 'NEq' | 'StrictEq' | 'StrictNEq' | 'Lt' | 'Gt' | 'LtEq' | 'GtEq' | 'And' | 'Or' | 'Not' | 'BitwiseAnd' | 'BitwiseOr' | 'BitwiseXor' | 'BitwiseNot' | 'ShiftLeft' | 'ShiftRight' | 'UnsignedShiftRight' | 'NullishCoalescing' | 'OptionalChaining' | 'Spread' | 'Ternary' | 'Arrow' | 'Comma' | 'AddAssign' | 'SubAssign' | 'MulAssign' | 'DivAssign' | 'ModAssign' | 'ExpAssign' | 'AndAssign' | 'OrAssign' | 'NullishAssign' | 'BitwiseAndAssign' | 'BitwiseOrAssign' | 'BitwiseXorAssign' | 'ShiftLeftAssign' | 'ShiftRightAssign' | 'UnsignedShiftRightAssign' | 'Increment' | 'Decrement';
export type PunctuationType = 'OpenParen' | 'CloseParen' | 'OpenBrace' | 'CloseBrace' | 'OpenBracket' | 'CloseBracket' | 'Semicolon' | 'Colon' | 'Dot';
export type TokenKind = {
    kind: 'Keyword';
    kwType: KeywordType;
} | {
    kind: 'Identifier';
    name: string;
} | {
    kind: 'StringLiteral';
} | {
    kind: 'NumericLiteral';
} | {
    kind: 'BooleanLiteral';
    value: boolean;
} | {
    kind: 'NullLiteral';
} | {
    kind: 'TemplateLiteral';
} | {
    kind: 'RegExpLiteral';
} | {
    kind: 'Operator';
    opType: OperatorType;
} | {
    kind: 'Punctuation';
    punctType: PunctuationType;
};
export interface Span {
    start: number;
    end: number;
}
export interface SourceToken {
    kind: TokenKind;
    span: Span;
}
export interface FileTokens {
    tokens: SourceToken[];
    source: string;
    lineCount: number;
}
export declare function pointSpan(pos: number): Span;
export declare function emptyTokens(source: string): FileTokens;
//# sourceMappingURL=token-types.d.ts.map