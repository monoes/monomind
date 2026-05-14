import { z } from 'zod';
export declare const agentStepSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"agent">;
    agent: z.ZodString;
    task: z.ZodString;
    context_deps: z.ZodOptional<z.ZodArray<z.ZodString>>;
    output_key: z.ZodOptional<z.ZodString>;
    timeout_ms: z.ZodOptional<z.ZodNumber>;
    retry_policy: z.ZodOptional<z.ZodObject<{
        maxAttempts: z.ZodOptional<z.ZodNumber>;
        initialDelayMs: z.ZodOptional<z.ZodNumber>;
        backoffMultiplier: z.ZodOptional<z.ZodNumber>;
        jitterMs: z.ZodOptional<z.ZodNumber>;
        retryOn: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            UNKNOWN: "UNKNOWN";
            RATE_LIMIT: "RATE_LIMIT";
            TIMEOUT: "TIMEOUT";
            VALIDATION: "VALIDATION";
        }>>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const parallelStepSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"parallel">;
    steps: z.ZodArray<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
}, z.core.$strip>;
export declare const sequenceStepSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"sequence">;
    steps: z.ZodArray<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
}, z.core.$strip>;
export declare const conditionalStepSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"conditional">;
    condition: z.ZodString;
    if_true: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
    if_false: z.ZodOptional<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
}, z.core.$strip>;
export declare const mapReduceStepSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"map_reduce">;
    items: z.ZodString;
    map_agent: z.ZodString;
    map_task: z.ZodString;
    reduce_agent: z.ZodString;
    reduce_task: z.ZodString;
    concurrent: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const loopStepSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"loop">;
    condition: z.ZodString;
    max_iterations: z.ZodNumber;
    body: z.ZodArray<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
}, z.core.$strip>;
export declare const workflowStepSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"agent">;
    agent: z.ZodString;
    task: z.ZodString;
    context_deps: z.ZodOptional<z.ZodArray<z.ZodString>>;
    output_key: z.ZodOptional<z.ZodString>;
    timeout_ms: z.ZodOptional<z.ZodNumber>;
    retry_policy: z.ZodOptional<z.ZodObject<{
        maxAttempts: z.ZodOptional<z.ZodNumber>;
        initialDelayMs: z.ZodOptional<z.ZodNumber>;
        backoffMultiplier: z.ZodOptional<z.ZodNumber>;
        jitterMs: z.ZodOptional<z.ZodNumber>;
        retryOn: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            UNKNOWN: "UNKNOWN";
            RATE_LIMIT: "RATE_LIMIT";
            TIMEOUT: "TIMEOUT";
            VALIDATION: "VALIDATION";
        }>>>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"parallel">;
    steps: z.ZodArray<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
}, z.core.$strip>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"sequence">;
    steps: z.ZodArray<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
}, z.core.$strip>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"conditional">;
    condition: z.ZodString;
    if_true: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
    if_false: z.ZodOptional<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
}, z.core.$strip>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"map_reduce">;
    items: z.ZodString;
    map_agent: z.ZodString;
    map_task: z.ZodString;
    reduce_agent: z.ZodString;
    reduce_task: z.ZodString;
    concurrent: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"loop">;
    condition: z.ZodString;
    max_iterations: z.ZodNumber;
    body: z.ZodArray<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
}, z.core.$strip>], "type">;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export declare const workflowDefinitionSchema: z.ZodObject<{
    name: z.ZodString;
    version: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    variables: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    steps: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"agent">;
        agent: z.ZodString;
        task: z.ZodString;
        context_deps: z.ZodOptional<z.ZodArray<z.ZodString>>;
        output_key: z.ZodOptional<z.ZodString>;
        timeout_ms: z.ZodOptional<z.ZodNumber>;
        retry_policy: z.ZodOptional<z.ZodObject<{
            maxAttempts: z.ZodOptional<z.ZodNumber>;
            initialDelayMs: z.ZodOptional<z.ZodNumber>;
            backoffMultiplier: z.ZodOptional<z.ZodNumber>;
            jitterMs: z.ZodOptional<z.ZodNumber>;
            retryOn: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                UNKNOWN: "UNKNOWN";
                RATE_LIMIT: "RATE_LIMIT";
                TIMEOUT: "TIMEOUT";
                VALIDATION: "VALIDATION";
            }>>>;
        }, z.core.$strip>>;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"parallel">;
        steps: z.ZodArray<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"sequence">;
        steps: z.ZodArray<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"conditional">;
        condition: z.ZodString;
        if_true: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
        if_false: z.ZodOptional<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"map_reduce">;
        items: z.ZodString;
        map_agent: z.ZodString;
        map_task: z.ZodString;
        reduce_agent: z.ZodString;
        reduce_task: z.ZodString;
        concurrent: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"loop">;
        condition: z.ZodString;
        max_iterations: z.ZodNumber;
        body: z.ZodArray<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
    }, z.core.$strip>], "type">>;
}, z.core.$strip>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
//# sourceMappingURL=dsl-schema.d.ts.map